// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package vault

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/godbus/dbus/v5"
)

// The Secret Service (`GNOME` Keyring, KWallet, `KeePassXC`) keeps each secret
// as an item of the default collection, found by its attributes:
// application, data folder and name. The session is "plain": the value
// travels unencrypted over the person's own session bus, which only their
// programs reach, and the service encrypts what it stores with their login.
// A locked collection asks the person to unlock it, in the desktop's own
// prompt.

const (
	secretsBus      = "org.freedesktop.secrets"
	secretsPath     = dbus.ObjectPath("/org/freedesktop/secrets")
	serviceIface    = "org.freedesktop.Secret.Service"
	collectionIface = "org.freedesktop.Secret.Collection"
	itemIface       = "org.freedesktop.Secret.Item"
	promptIface     = "org.freedesktop.Secret.Prompt"
	// noPrompt is the path a call answers when it needs no prompt.
	noPrompt = dbus.ObjectPath("/")
	// callTimeout bounds a call; promptTimeout bounds the person's answer.
	callTimeout   = 10 * time.Second
	promptTimeout = 2 * time.Minute
)

// secret is the Secret Service's Secret structure.
type secret struct {
	Session     dbus.ObjectPath
	Parameters  []byte
	Value       []byte
	ContentType string
}

type secretService struct {
	dir string

	mu         sync.Mutex
	conn       *dbus.Conn
	session    dbus.ObjectPath
	collection dbus.ObjectPath
}

func system(dataDir string) (systemStore, error) {
	return &secretService{dir: dataDir}, nil
}

func (s *secretService) check() error {
	_, err := s.open()
	return err
}

// open connects once, then answers the connection with the default
// collection unlocked.
func (s *secretService) open() (*dbus.Conn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn == nil {
		conn, err := dbus.ConnectSessionBus()
		if err != nil {
			return nil, fmt.Errorf("no session bus: %w", err)
		}
		var out dbus.Variant
		var session, collection dbus.ObjectPath
		svc := conn.Object(secretsBus, secretsPath)
		if err := call(svc, serviceIface+".OpenSession", "plain", dbus.MakeVariant("")).Store(&out, &session); err != nil {
			conn.Close()
			return nil, fmt.Errorf("no Secret Service: %w", err)
		}
		if err := call(svc, serviceIface+".ReadAlias", "default").Store(&collection); err != nil {
			conn.Close()
			return nil, err
		}
		if collection == noPrompt {
			conn.Close()
			return nil, errors.New("the Secret Service has no default keyring")
		}
		s.conn, s.session, s.collection = conn, session, collection
	}
	if err := s.unlock(s.collection); err != nil {
		return nil, err
	}
	return s.conn, nil
}

func call(obj dbus.BusObject, method string, args ...any) *dbus.Call {
	ctx, cancel := context.WithTimeout(context.Background(), callTimeout)
	defer cancel()
	return obj.CallWithContext(ctx, method, 0, args...)
}

// unlock unlocks paths, asking the person when the service needs to.
func (s *secretService) unlock(paths ...dbus.ObjectPath) error {
	var unlocked []dbus.ObjectPath
	var prompt dbus.ObjectPath
	if err := call(s.conn.Object(secretsBus, secretsPath), serviceIface+".Unlock", paths).Store(&unlocked, &prompt); err != nil {
		return err
	}
	return s.prompt(prompt)
}

// prompt shows the service's prompt, when there is one, and waits for the
// person's answer.
func (s *secretService) prompt(path dbus.ObjectPath) error {
	if path == noPrompt {
		return nil
	}
	match := []dbus.MatchOption{
		dbus.WithMatchObjectPath(path),
		dbus.WithMatchInterface(promptIface),
		dbus.WithMatchMember("Completed"),
	}
	if err := s.conn.AddMatchSignal(match...); err != nil {
		return err
	}
	defer s.conn.RemoveMatchSignal(match...)
	signals := make(chan *dbus.Signal, 4)
	s.conn.Signal(signals)
	defer s.conn.RemoveSignal(signals)
	if err := call(s.conn.Object(secretsBus, path), promptIface+".Prompt", "").Err; err != nil {
		return err
	}
	timeout := time.After(promptTimeout)
	for {
		select {
		case sig := <-signals:
			if sig.Path != path || sig.Name != promptIface+".Completed" || len(sig.Body) == 0 {
				continue
			}
			if dismissed, _ := sig.Body[0].(bool); dismissed {
				return errors.New("the keyring stayed locked")
			}
			return nil
		case <-timeout:
			return errors.New("the keyring was not unlocked in time")
		}
	}
}

func (s *secretService) attributes(name string) map[string]string {
	return map[string]string{"application": product, "folder": s.dir, "name": name}
}

func (s *secretService) find(name string) ([]dbus.ObjectPath, error) {
	conn, err := s.open()
	if err != nil {
		return nil, err
	}
	var items []dbus.ObjectPath
	err = call(conn.Object(secretsBus, s.collection), collectionIface+".SearchItems", s.attributes(name)).Store(&items)
	return items, err
}

func (s *secretService) get(name string) (string, error) {
	items, err := s.find(name)
	if err != nil || len(items) == 0 {
		return "", err
	}
	if err := s.unlock(items[0]); err != nil {
		return "", err
	}
	var got secret
	if err := call(s.conn.Object(secretsBus, items[0]), itemIface+".GetSecret", s.session).Store(&got); err != nil {
		return "", err
	}
	return string(got.Value), nil
}

func (s *secretService) set(name, value string) error {
	conn, err := s.open()
	if err != nil {
		return err
	}
	props := map[string]dbus.Variant{
		itemIface + ".Label":      dbus.MakeVariant(product + " " + name),
		itemIface + ".Attributes": dbus.MakeVariant(s.attributes(name)),
	}
	kept := secret{Session: s.session, Value: []byte(value), ContentType: "text/plain"}
	var item, prompt dbus.ObjectPath
	if err := call(conn.Object(secretsBus, s.collection), collectionIface+".CreateItem", props, kept, true).Store(&item, &prompt); err != nil {
		return err
	}
	return s.prompt(prompt)
}

func (s *secretService) remove(name string) error {
	items, err := s.find(name)
	if err != nil {
		return err
	}
	for _, item := range items {
		var prompt dbus.ObjectPath
		if err := call(s.conn.Object(secretsBus, item), itemIface+".Delete").Store(&prompt); err != nil {
			return err
		}
		if err := s.prompt(prompt); err != nil {
			return err
		}
	}
	return nil
}
