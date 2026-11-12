// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package configfile

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/vault"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// inVault answers an opener of v that records the place it was asked for.
func inVault(v ports.Vault, asked *domain.SecretPlace) OpenVault {
	return func(place domain.SecretPlace) (ports.Vault, error) {
		if asked != nil {
			*asked = place
		}
		return v, nil
	}
}

func TestOpenMissingAnswersDefaults(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "config.json"), inVault(vault.Memory(), nil))
	if err != nil {
		t.Fatal(err)
	}
	c := s.Get()
	if c.Port != domain.DefaultPort || c.LAN.Port != domain.DefaultLANPort || c.LAN.DeSEC.Linked() || c.LAN.AutoStart || c.Google.Configured() {
		t.Fatalf("defaults %+v", c)
	}
}

func TestTheFirstOpenRecordsWhereTheSecretsAreKept(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	var asked domain.SecretPlace
	v := vault.Memory()
	if _, err := Open(path, inVault(v, &asked)); err != nil {
		t.Fatal(err)
	}
	if asked != domain.SecretsUnchosen {
		t.Fatalf("first open asked for %q", asked)
	}
	if _, err := Open(path, inVault(v, &asked)); err != nil {
		t.Fatal(err)
	}
	if asked != v.Place() {
		t.Fatalf("second open asked for %q, want %q", asked, v.Place())
	}
}

func TestTheSecretsGoToTheVaultAndNeverToTheFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "host", "config.json")
	v := vault.Memory()
	s, err := Open(path, inVault(v, nil))
	if err != nil {
		t.Fatal(err)
	}
	err = s.Update(func(c *domain.Config) {
		c.Google = domain.Google{ClientID: "id.apps.googleusercontent.com", ClientSecret: "google-secret"}
		c.LAN.DeSEC = domain.DeSEC{Name: "rossi", Token: "desec-token", PendingPassword: "desec-password"}
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"google-secret", "desec-token", "desec-password"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("config.json holds %s:\n%s", secret, raw)
		}
	}
	if !strings.Contains(string(raw), `"rossi"`) {
		t.Fatalf("config.json lost the name:\n%s", raw)
	}
	if info, _ := os.Stat(path); runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", info.Mode().Perm())
	}

	again, err := Open(path, inVault(v, nil))
	if err != nil {
		t.Fatal(err)
	}
	c := again.Get()
	if c.Google.ClientSecret != "google-secret" || c.LAN.DeSEC.Token != "desec-token" ||
		c.LAN.DeSEC.PendingPassword != "desec-password" || c.LAN.Hostname() != "rossi.dedyn.io" {
		t.Fatalf("reloaded %+v", c)
	}

	if err := again.Update(func(c *domain.Config) { c.LAN.DeSEC.PendingPassword = "" }); err != nil {
		t.Fatal(err)
	}
	if got, _ := v.Get(domain.SecretDeSECPassword); got != "" {
		t.Fatalf("the cleared password is still kept: %q", got)
	}
}

// failing is a vault that refuses every write.
type failing struct{ ports.Vault }

func (failing) Set(string, string) error { return errors.New("refused") }

func TestAVaultThatRefusesKeepsTheOldSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	s, err := Open(path, inVault(failing{vault.Memory()}, nil))
	if err != nil {
		t.Fatal(err)
	}
	err = s.Update(func(c *domain.Config) { c.Google = domain.Google{ClientID: "id", ClientSecret: "secret"} })
	if err == nil {
		t.Fatal("the update succeeded")
	}
	if s.Get().Google.ClientID != "" {
		t.Fatalf("kept %+v", s.Get().Google)
	}
}

// failingAt is a vault whose nth write refuses.
type failingAt struct {
	ports.Vault
	n, calls int
}

func (f *failingAt) Set(name, value string) error {
	f.calls++
	if f.calls == f.n {
		return errors.New("refused")
	}
	return f.Vault.Set(name, value)
}

func TestAFailedLaterWritePutsTheEarlierOnesBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	v := vault.Memory()
	first, err := Open(path, inVault(v, nil))
	if err != nil {
		t.Fatal(err)
	}
	// A deSEC signup in progress: the password waits for the token.
	if err := first.Update(func(c *domain.Config) { c.LAN.DeSEC.PendingPassword = "pw" }); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path, inVault(&failingAt{Vault: v, n: 2}, nil))
	if err != nil {
		t.Fatal(err)
	}
	// The signup's end: the token is kept and the password cleared, in one
	// update. The second write, the clearing, fails.
	err = s.Update(func(c *domain.Config) {
		c.LAN.DeSEC.Token = "token"
		c.LAN.DeSEC.PendingPassword = ""
	})
	if err == nil {
		t.Fatal("the update succeeded")
	}
	if got, _ := v.Get(domain.SecretDeSECToken); got != "" {
		t.Fatalf("the token stayed kept after the failed update: %q", got)
	}
	if got, _ := v.Get(domain.SecretDeSECPassword); got != "pw" {
		t.Fatalf("the pending password is gone: %q", got)
	}
	if cfg := s.Get(); cfg.LAN.DeSEC.Token != "" || cfg.LAN.DeSEC.PendingPassword != "pw" {
		t.Fatalf("memory moved: %+v", cfg.LAN.DeSEC)
	}
}

// refusingCalls is a vault whose writes with the listed call numbers refuse.
type refusingCalls struct {
	ports.Vault
	refuse map[int]bool
	calls  int
}

func (f *refusingCalls) Set(name, value string) error {
	f.calls++
	if f.refuse[f.calls] {
		return errors.New("refused")
	}
	return f.Vault.Set(name, value)
}

func TestAFailedPutBackDoesNotStopTheNext(t *testing.T) {
	v := vault.Memory()
	// Writes 1 and 2 keep the client secret and the token; write 3, the
	// password, refuses. Put-back 4, the client secret, refuses too.
	s, err := Open(filepath.Join(t.TempDir(), "config.json"),
		inVault(&refusingCalls{Vault: v, refuse: map[int]bool{3: true, 4: true}}, nil))
	if err != nil {
		t.Fatal(err)
	}
	err = s.Update(func(c *domain.Config) {
		c.Google.ClientSecret = "secret"
		c.LAN.DeSEC.Token = "token"
		c.LAN.DeSEC.PendingPassword = "pw"
	})
	if err == nil {
		t.Fatal("the update succeeded")
	}
	if got, _ := v.Get(domain.SecretDeSECToken); got != "" {
		t.Fatalf("the token was not put back after the client secret's put-back failed: %q", got)
	}
	if !strings.Contains(err.Error(), domain.SecretGoogleClient+" could not be put back") {
		t.Fatalf("the error does not name the failed put-back: %v", err)
	}
	if strings.Contains(err.Error(), domain.SecretDeSECToken+" could not") {
		t.Fatalf("the error names a put-back that landed: %v", err)
	}
}

func TestNoUpdateMovesTheSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	v := vault.Memory()
	s, _ := Open(path, inVault(v, nil))
	if err := s.Update(func(c *domain.Config) { *c = domain.Defaults() }); err != nil {
		t.Fatal(err)
	}
	if s.Get().Secrets != v.Place() {
		t.Fatalf("place %q", s.Get().Secrets)
	}
}

func TestAVaultThatDoesNotOpenStopsTheOpen(t *testing.T) {
	refused := func(domain.SecretPlace) (ports.Vault, error) { return nil, errors.New("no store") }
	if _, err := Open(filepath.Join(t.TempDir(), "config.json"), refused); err == nil {
		t.Fatal("opened without a vault")
	}
}

func TestGetAnswersACopy(t *testing.T) {
	s := Memory(domain.Config{})
	c := s.Get()
	c.Port = 1
	if s.Get().Port != domain.DefaultPort {
		t.Fatal("Get exposes the stored value")
	}
}
