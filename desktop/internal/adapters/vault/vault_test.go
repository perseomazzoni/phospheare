// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package vault

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// fakeSystem is a system store that answers when err is nil.
type fakeSystem struct {
	memory
	err error
}

func (f fakeSystem) check() error { return f.err }

func withSystem(t *testing.T, err error) memory {
	t.Helper()
	kept := memory{}
	before := openSystem
	openSystem = func(string) (systemStore, error) { return fakeSystem{memory: kept, err: err}, nil }
	t.Cleanup(func() { openSystem = before })
	return kept
}

func TestTheFirstStartTakesTheSystemStoreWhenItAnswers(t *testing.T) {
	kept := withSystem(t, nil)
	v, err := Open(t.TempDir(), domain.SecretsUnchosen)
	if err != nil {
		t.Fatal(err)
	}
	if v.Place() != domain.SecretsInSystem {
		t.Fatalf("place %q", v.Place())
	}
	if err := v.Set(domain.SecretSealKeys, "keys"); err != nil || kept[domain.SecretSealKeys] != "keys" {
		t.Fatalf("kept %v, %v", kept, err)
	}
}

func TestTheFirstStartTakesTheFileWhenNoStoreAnswers(t *testing.T) {
	withSystem(t, errors.New("no service"))
	v, err := Open(t.TempDir(), domain.SecretsUnchosen)
	if err != nil {
		t.Fatal(err)
	}
	if v.Place() != domain.SecretsInFile {
		t.Fatalf("place %q", v.Place())
	}
}

func TestASetupInTheSystemStoreStopsWhenItDoesNotAnswer(t *testing.T) {
	withSystem(t, errors.New("no service"))
	if _, err := Open(t.TempDir(), domain.SecretsInSystem); !errors.Is(err, ErrNoStore) {
		t.Fatalf("err %v", err)
	}
}

func TestAnUnknownPlaceIsRefused(t *testing.T) {
	if _, err := Open(t.TempDir(), "elsewhere"); err == nil || !strings.Contains(err.Error(), "elsewhere") {
		t.Fatalf("err %v", err)
	}
}

func TestTheFileTakesASecretAfterANullFile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "secrets.json"), []byte("null\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	v, err := Open(dir, domain.SecretsInFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := v.Set(domain.SecretDeSECToken, "token"); err != nil {
		t.Fatal(err)
	}
	if got, _ := v.Get(domain.SecretDeSECToken); got != "token" {
		t.Fatalf("kept %q", got)
	}
}

func TestTheFileKeepsAndRemovesSecretsPrivately(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	v, err := Open(dir, domain.SecretsInFile)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := v.Get(domain.SecretGoogleClient); got != "" || err != nil {
		t.Fatalf("before: %q, %v", got, err)
	}
	if err := v.Set(domain.SecretGoogleClient, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := v.Set(domain.SecretDeSECToken, "token"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "secrets.json"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v", info.Mode().Perm())
	}
	again, _ := Open(dir, domain.SecretsInFile)
	if got, _ := again.Get(domain.SecretGoogleClient); got != "secret" {
		t.Fatalf("reopened %q", got)
	}
	if err := again.Set(domain.SecretGoogleClient, ""); err != nil {
		t.Fatal(err)
	}
	if got, _ := again.Get(domain.SecretGoogleClient); got != "" {
		t.Fatalf("removed, still %q", got)
	}
	if got, _ := again.Get(domain.SecretDeSECToken); got != "token" {
		t.Fatalf("the other secret went too: %q", got)
	}
	if err := again.Set("never-kept", ""); err != nil {
		t.Fatalf("removing nothing: %v", err)
	}
}

// TestTheSystemStoreKeepsASecret runs against the real store of the system
// it runs on, and skips where none answers, as on a computer without a
// desktop.
func TestTheSystemStoreKeepsASecret(t *testing.T) {
	s, err := system(t.TempDir())
	if err == nil {
		err = s.check()
	}
	if err != nil {
		t.Skipf("no system store: %v", err)
	}
	const name = "vault-test"
	t.Cleanup(func() { _ = s.remove(name) })
	value := "-----BEGIN EC PRIVATE KEY-----\nline\n-----END EC PRIVATE KEY-----\n"
	if err := s.set(name, value); err != nil {
		t.Fatal(err)
	}
	if got, err := s.get(name); got != value || err != nil {
		t.Fatalf("got %q, %v", got, err)
	}
	if err := s.set(name, "replaced"); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.get(name); got != "replaced" {
		t.Fatalf("replaced: %q", got)
	}
	if err := s.remove(name); err != nil {
		t.Fatal(err)
	}
	if got, err := s.get(name); got != "" || err != nil {
		t.Fatalf("removed: %q, %v", got, err)
	}
	if err := s.remove(name); err != nil {
		t.Fatalf("removing nothing: %v", err)
	}
}
