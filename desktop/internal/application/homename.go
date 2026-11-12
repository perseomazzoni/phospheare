// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package application

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// ActivationWindow is how long deSEC's activation link works.
const ActivationWindow = 12 * time.Hour

// Name states the setup page tells apart.
const (
	NameNone    = "none"
	NameWaiting = "waiting"
	NameExpired = "expired"
	NameLinked  = "linked"
)

// NameState is what the setup page shows about the home network's name.
type NameState struct {
	State     string    `json:"state"`
	Domain    string    `json:"domain,omitempty"`
	Email     string    `json:"email,omitempty"`
	Requested time.Time `json:"requested,omitzero"`
	// Problem is why the last check failed; the page keeps asking.
	Problem string `json:"problem,omitempty"`
}

// HomeName gives the home network its free name at deSEC: it creates the
// account, waits for the activation link, makes the token the certificate
// needs and then forgets the account's password.
type HomeName struct {
	Config  ports.ConfigStore
	Account ports.NameAccount
	Now     func() time.Time
	// LoginGap is the shortest time between two logins while the link is
	// unused, 10 seconds when zero, however many pages ask.
	LoginGap time.Duration
	Logf     func(format string, args ...any)

	mu        sync.Mutex
	lastLogin time.Time
}

func (h *HomeName) now() time.Time {
	if h.Now != nil {
		return h.Now()
	}
	return time.Now()
}

func (h *HomeName) logf(format string, args ...any) {
	if h.Logf != nil {
		h.Logf(format, args...)
	}
}

var errHasName = errors.New("This computer already has a name. Choose Use another name first.")

// State answers the name's state from the settings alone.
func (h *HomeName) State() NameState {
	return h.stateOf(h.Config.Get().LAN.DeSEC)
}

func (h *HomeName) stateOf(d domain.DeSEC) NameState {
	s := NameState{State: NameNone, Domain: d.Domain(), Email: d.Email}
	switch {
	case d.Linked():
		s.State = NameLinked
	case d.Waiting():
		s.State, s.Requested = NameWaiting, d.Requested
		if h.now().After(d.Requested.Add(ActivationWindow)) {
			s.State = NameExpired
		}
	}
	return s
}

// Register creates the deSEC account for name with email and password, the
// password the page showed and the person saved. The password is kept
// until the token exists. Accepted is the person's agreement to deSEC's
// terms and to the limits of its free names; without it deSEC is asked
// nothing.
func (h *HomeName) Register(ctx context.Context, email, name, password string, accepted bool) error {
	email = strings.TrimSpace(email)
	label, ok := domain.NameLabel(name)
	if !domain.ValidEmail(email) {
		return &ports.Refusal{Field: "email", Message: "Enter your email address, such as name@example.com."}
	}
	if !ok {
		return &ports.Refusal{Field: "name", Message: "Use only letters, digits and hyphens."}
	}
	if password == "" {
		return errors.New("The password is missing; reload the page.")
	}
	if h.Config.Get().LAN.DeSEC.Linked() {
		return errHasName
	}
	if !accepted {
		return &ports.Refusal{Field: "accepted", Message: "Confirm that the limits of the free name are fine for you."}
	}
	d := domain.DeSEC{Name: label, Email: email, PendingPassword: password, Requested: h.now()}
	if err := h.Account.Register(ctx, email, password, d.Domain()); err != nil {
		return err
	}
	h.mu.Lock()
	h.lastLogin = time.Time{}
	h.mu.Unlock()
	return h.Config.Update(func(c *domain.Config) { c.LAN.DeSEC = d })
}

// Check asks deSEC whether the activation link was used. Once it was, it
// makes the token and forgets the password; linked reports that this call
// did so, since the identity service then needs the new origin.
func (h *HomeName) Check(ctx context.Context) (state NameState, linked bool, err error) {
	d := h.Config.Get().LAN.DeSEC
	if !d.Waiting() {
		return h.stateOf(d), false, nil
	}
	gap := h.LoginGap
	if gap == 0 {
		gap = 10 * time.Second
	}
	h.mu.Lock()
	if h.now().Sub(h.lastLogin) < gap {
		h.mu.Unlock()
		return h.stateOf(d), false, nil
	}
	h.lastLogin = h.now()
	h.mu.Unlock()

	login, err := h.Account.Login(ctx, d.Email, d.PendingPassword)
	if errors.Is(err, ports.ErrNotActivated) {
		return h.stateOf(d), false, nil
	}
	if err != nil {
		return h.stateOf(d), false, err
	}
	token, narrowed, err := h.Account.MakeToken(ctx, login, d.Domain())
	if lerr := h.Account.Logout(ctx, login); lerr != nil {
		h.logf("deSEC: the login could not be ended: %v", lerr)
	}
	if err != nil {
		return h.stateOf(d), false, err
	}
	err = h.Config.Update(func(c *domain.Config) {
		if c.LAN.DeSEC.Name == d.Name {
			c.LAN.DeSEC = domain.DeSEC{Name: d.Name, Email: d.Email, Token: token}
		}
	})
	if err != nil {
		return h.stateOf(d), false, err
	}
	h.logf("deSEC: %s is ready; its token writes only this name's records: %v", d.Domain(), narrowed)
	return h.State(), true, nil
}

// Link uses a name and a token made on desec.io, for a person who already
// has a deSEC account.
func (h *HomeName) Link(ctx context.Context, name, token string) error {
	label, ok := domain.NameLabel(name)
	token = strings.TrimSpace(token)
	if !ok {
		return &ports.Refusal{Field: "name", Message: "Enter the name from desec.io, the one ending in .dedyn.io."}
	}
	if token == "" {
		return &ports.Refusal{Field: "token", Message: "Paste the token made on desec.io."}
	}
	if h.Config.Get().LAN.DeSEC.Linked() {
		return errHasName
	}
	d := domain.DeSEC{Name: label, Token: token}
	if err := h.Account.Owns(ctx, token, d.Domain()); err != nil {
		return err
	}
	return h.Config.Update(func(c *domain.Config) { c.LAN.DeSEC = d })
}

// Unlink forgets the name, the token, any password still kept and the
// certificate authority's agreement accepted for the name. The account and
// the name stay at deSEC.
func (h *HomeName) Unlink() error {
	return h.Config.Update(func(c *domain.Config) { c.LAN.DeSEC, c.LAN.CertTerms = domain.DeSEC{}, "" })
}
