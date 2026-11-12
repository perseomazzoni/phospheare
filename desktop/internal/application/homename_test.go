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
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// fakeAccount is deSEC's account side in memory.
type fakeAccount struct {
	registered     []string
	active         bool
	logins         int
	loggedOut      int
	makeErr        error
	owns           error
	email, pw, dom string
}

func (f *fakeAccount) Register(_ context.Context, email, password, domain string) error {
	f.registered = append(f.registered, domain)
	f.email, f.pw, f.dom = email, password, domain
	return nil
}

func (f *fakeAccount) Login(_ context.Context, email, password string) (string, error) {
	f.logins++
	if !f.active {
		return "", ports.ErrNotActivated
	}
	if email != f.email || password != f.pw {
		return "", errors.New("wrong login")
	}
	return "login", nil
}

func (f *fakeAccount) MakeToken(_ context.Context, login, domain string) (string, bool, error) {
	if login != "login" || domain != f.dom {
		return "", false, errors.New("wrong token request")
	}
	return "long-lived", true, f.makeErr
}

func (f *fakeAccount) Logout(context.Context, string) error { f.loggedOut++; return nil }

func (f *fakeAccount) Owns(context.Context, string, string) error { return f.owns }

func newHomeName() (*HomeName, *fakeAccount, *memConfig, *time.Time) {
	now := time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)
	acc, store := &fakeAccount{}, &memConfig{cfg: domain.Defaults()}
	return &HomeName{Config: store, Account: acc, Now: func() time.Time { return now }}, acc, store, &now
}

func TestHomeNameSignUp(t *testing.T) {
	h, acc, store, now := newHomeName()
	ctx := context.Background()
	if err := h.Register(ctx, " name@example.com ", "Rossi-Studio", "pass-word", true); err != nil {
		t.Fatal(err)
	}
	d := store.Get().LAN.DeSEC
	if d.Name != "rossi-studio" || d.Email != "name@example.com" || d.PendingPassword != "pass-word" || acc.registered[0] != "rossi-studio.dedyn.io" {
		t.Fatalf("%+v %v", d, acc.registered)
	}
	if s, linked, err := h.Check(ctx); err != nil || linked || s.State != NameWaiting {
		t.Fatalf("%+v %v %v", s, linked, err)
	}
	// A second page asking at once does not log in again.
	h.Check(ctx)
	if acc.logins != 1 {
		t.Fatalf("logins %d", acc.logins)
	}
	acc.active = true
	*now = now.Add(11 * time.Second)
	s, linked, err := h.Check(ctx)
	if err != nil || !linked || s.State != NameLinked || s.Domain != "rossi-studio.dedyn.io" {
		t.Fatalf("%+v %v %v", s, linked, err)
	}
	d = store.Get().LAN.DeSEC
	if d.Token != "long-lived" || d.PendingPassword != "" || !d.Requested.IsZero() || acc.loggedOut != 1 {
		t.Fatalf("the password must be forgotten once the token exists: %+v", d)
	}
	if err := h.Register(ctx, "name@example.com", "other", "pw", true); err == nil {
		t.Fatal("a linked name must be unlinked before another is registered")
	}
	if err := h.Unlink(); err != nil || store.Get().LAN.DeSEC != (domain.DeSEC{}) || h.State().State != NameNone {
		t.Fatal("unlink keeps something")
	}
}

func TestHomeNameKeepsThePasswordWhenTheTokenFails(t *testing.T) {
	h, acc, store, _ := newHomeName()
	ctx := context.Background()
	h.Register(ctx, "name@example.com", "rossi", "pw", true)
	acc.active, acc.makeErr = true, errors.New("deSEC cannot be reached")
	if _, linked, err := h.Check(ctx); err == nil || linked {
		t.Fatal("a failed token must be reported")
	}
	if d := store.Get().LAN.DeSEC; d.PendingPassword != "pw" || d.Token != "" || acc.loggedOut != 1 {
		t.Fatalf("%+v", d)
	}
}

func TestHomeNameLinkExpires(t *testing.T) {
	h, _, _, now := newHomeName()
	h.Register(context.Background(), "name@example.com", "rossi", "pw", true)
	*now = now.Add(ActivationWindow + time.Minute)
	if s, _, _ := h.Check(context.Background()); s.State != NameExpired {
		t.Fatal(s)
	}
}

func TestHomeNameRefusesBadInput(t *testing.T) {
	h, acc, _, _ := newHomeName()
	ctx := context.Background()
	var r *ports.Refusal
	if err := h.Register(ctx, "not-an-email", "rossi", "pw", true); !errors.As(err, &r) || r.Field != "email" {
		t.Fatal(err)
	}
	if err := h.Register(ctx, "name@example.com", "rossi_studio", "pw", true); !errors.As(err, &r) || r.Field != "name" {
		t.Fatal(err)
	}
	if len(acc.registered) != 0 {
		t.Fatal("bad input must not reach deSEC")
	}
}

func TestHomeNameLinksAnExistingAccount(t *testing.T) {
	h, acc, store, _ := newHomeName()
	ctx := context.Background()
	acc.owns = &ports.Refusal{Field: "name", Message: "no such name"}
	if err := h.Link(ctx, "rossi.dedyn.io", "tok"); err == nil || store.Get().LAN.DeSEC.Linked() {
		t.Fatal("a token that does not own the name must not link")
	}
	acc.owns = nil
	if err := h.Link(ctx, "rossi.dedyn.io", " tok "); err != nil {
		t.Fatal(err)
	}
	if d := store.Get().LAN.DeSEC; d.Name != "rossi" || d.Token != "tok" || store.Get().LAN.Hostname() != "rossi.dedyn.io" {
		t.Fatalf("%+v", d)
	}
}

// Without the person's agreement deSEC is asked nothing and nothing is kept.
func TestHomeNameAsksDeSECNothingWithoutAgreement(t *testing.T) {
	h, acc, store, _ := newHomeName()
	var r *ports.Refusal
	err := h.Register(context.Background(), "name@example.com", "rossi", "pw", false)
	if !errors.As(err, &r) || r.Field != "accepted" {
		t.Fatal(err)
	}
	if len(acc.registered) != 0 || store.Get().LAN.DeSEC != (domain.DeSEC{}) {
		t.Fatalf("registered %v, kept %+v", acc.registered, store.Get().LAN.DeSEC)
	}
}

// Another name is another certificate: the accepted agreement goes with the
// name.
func TestUnlinkForgetsTheAcceptedAgreement(t *testing.T) {
	h, _, store, _ := newHomeName()
	_ = store.Update(func(c *domain.Config) {
		c.LAN.DeSEC, c.LAN.CertTerms = domain.DeSEC{Name: "rossi", Token: "t"}, "https://example.test/terms"
	})
	if err := h.Unlink(); err != nil || store.Get().LAN.CertTerms != "" {
		t.Fatalf("unlink keeps %q: %v", store.Get().LAN.CertTerms, err)
	}
}
