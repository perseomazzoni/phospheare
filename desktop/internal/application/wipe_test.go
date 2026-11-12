// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package application

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

type wipeIdentity struct{ signOuts, forgets int }

func (f *wipeIdentity) Restart() error         { return nil }
func (f *wipeIdentity) SignOutBrowsers() error { f.signOuts++; return nil }
func (f *wipeIdentity) ForgetKeys() error      { f.forgets++; return nil }

type wipeCerts struct{ forgets int }

func (f *wipeCerts) Forget() error { f.forgets++; return nil }
func (f *wipeIdentity) CheckGoogle(context.Context) ([]domain.GoogleCheck, error) {
	return nil, nil
}

type wipeLAN struct {
	stops int
	err   error
}

func (f *wipeLAN) Stop() error { f.stops++; return f.err }

type wipeAutostart struct{ on bool }

func (f *wipeAutostart) Enable(string, []string) error { f.on = true; return nil }
func (f *wipeAutostart) Disable() error                { f.on = false; return nil }
func (f *wipeAutostart) Enabled() (bool, error)        { return f.on, nil }

// setUp is a configuration with everything the setup page sets.
func setUp() domain.Config {
	return domain.Config{
		Google: domain.Google{ClientID: "1234-abcd.apps.googleusercontent.com", ClientSecret: "very-secret"},
		Port:   47900,
		LAN: domain.LAN{
			Port: 48000, Address: "192.168.1.20", AutoStart: true, ACMEDirectory: "https://acme.test/dir",
			DeSEC: domain.DeSEC{Name: "rossi-studio", Email: "a@b.test", Token: "token", Requested: time.Now()},
		},
		StartAtLogin: true,
	}
}

func newWipe() (*Wipe, *memConfig, *wipeIdentity, *wipeLAN, *wipeAutostart) {
	store, id, lan, auto := &memConfig{cfg: setUp()}, &wipeIdentity{}, &wipeLAN{}, &wipeAutostart{on: true}
	return &Wipe{Config: store, Identity: id, LAN: lan, Certs: &wipeCerts{}, Autostart: auto}, store, id, lan, auto
}

func TestWipeGoogleKeepsTheRest(t *testing.T) {
	w, store, id, lan, auto := newWipe()
	if err := w.Google(); err != nil {
		t.Fatal(err)
	}
	want := setUp()
	want.Google = domain.Google{}
	got := store.Get()
	got.LAN.DeSEC.Requested = want.LAN.DeSEC.Requested
	if got != want {
		t.Fatalf("config %+v, want %+v", got, want)
	}
	if id.signOuts != 1 || id.forgets != 0 || lan.stops != 0 || !auto.on || w.Certs.(*wipeCerts).forgets != 0 {
		t.Fatalf("sign-outs %d, forgets %d, stops %d, autostart %v", id.signOuts, id.forgets, lan.stops, auto.on)
	}
}

func TestWipeEverythingLeavesAFirstRun(t *testing.T) {
	w, store, id, lan, auto := newWipe()
	if err := w.Everything(); err != nil {
		t.Fatal(err)
	}
	want := domain.Defaults()
	want.Port = 47900
	want.LAN.ACMEDirectory = "https://acme.test/dir"
	if got := store.Get(); got != want {
		t.Fatalf("config %+v, want %+v", got, want)
	}
	// The keys go, rather than being replaced: the vault keeps nothing.
	if id.forgets != 1 || id.signOuts != 0 || lan.stops != 1 || auto.on || w.Certs.(*wipeCerts).forgets != 1 {
		t.Fatalf("forgets %d, sign-outs %d, stops %d, autostart %v, certificate forgets %d",
			id.forgets, id.signOuts, lan.stops, auto.on, w.Certs.(*wipeCerts).forgets)
	}
}

func TestWipeEverythingStopsWhereItFails(t *testing.T) {
	w, store, id, lan, _ := newWipe()
	lan.err = errors.New("busy")
	if err := w.Everything(); err == nil {
		t.Fatal("a wipe whose listener did not stop succeeded")
	}
	if store.Get().Google.ClientID == "" || id.forgets != 0 || w.Certs.(*wipeCerts).forgets != 0 {
		t.Fatal("a failed wipe went on")
	}
}
