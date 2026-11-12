// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package seal

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type payload struct {
	Writer string `json:"writer"`
	Token  string `json:"token"`
}

func TestRoundTrip(t *testing.T) {
	s, err := New(bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := s.Seal("phospheare_g", payload{"w1", "refresh-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "refresh") || strings.ContainsAny(sealed, "+/=") {
		t.Fatalf("sealed value %q leaks or is not base64url", sealed)
	}
	var got payload
	if err := s.Open("phospheare_g", sealed, &got); err != nil || got != (payload{"w1", "refresh-secret"}) {
		t.Fatalf("open: %v %+v", err, got)
	}
}

func TestTamperIsRejected(t *testing.T) {
	s, _ := New(bytes.Repeat([]byte{1}, 32))
	sealed, _ := s.Seal("phospheare_g", payload{"w1", "t"})
	raw, _ := base64.RawURLEncoding.DecodeString(sealed)
	for i := range raw {
		bad := append([]byte(nil), raw...)
		bad[i] ^= 0x01
		var got payload
		if err := s.Open("phospheare_g", base64.RawURLEncoding.EncodeToString(bad), &got); !errors.Is(err, ErrInvalid) {
			t.Fatalf("flipping byte %d: %v", i, err)
		}
	}
	var got payload
	for _, v := range []string{"", "!!", sealed[:10], sealed + "A"} {
		if err := s.Open("phospheare_g", v, &got); !errors.Is(err, ErrInvalid) {
			t.Fatalf("%q: %v", v, err)
		}
	}
}

func TestPurposeIsBound(t *testing.T) {
	s, _ := New(bytes.Repeat([]byte{1}, 32))
	sealed, _ := s.Seal("phospheare_session", payload{"w1", ""})
	var got payload
	if err := s.Open("phospheare_g", sealed, &got); !errors.Is(err, ErrInvalid) {
		t.Fatalf("a session value opened as a connection: %v", err)
	}
}

func TestOtherKeyIsRejected(t *testing.T) {
	a, _ := New(bytes.Repeat([]byte{1}, 32))
	b, _ := New(bytes.Repeat([]byte{2}, 32))
	sealed, _ := a.Seal("p", payload{"w", "t"})
	var got payload
	if err := b.Open("p", sealed, &got); !errors.Is(err, ErrInvalid) {
		t.Fatalf("another key opened it: %v", err)
	}
}

func TestLoadCreatesAKeyringOnceAndKeepsIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "data", "seal.keys")
	s, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || len(s.aeads) != 1 {
		t.Fatalf("keyring file: %v %v, %d keys", err, info, len(s.aeads))
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode %v", info.Mode().Perm())
	}
	first, _ := os.ReadFile(path)
	sealed, _ := s.Seal("p", payload{"w", "t"})
	again, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	var got payload
	if err := again.Open("p", sealed, &got); err != nil {
		t.Fatalf("a reloaded key does not open: %v", err)
	}
	if kept, _ := os.ReadFile(path); !bytes.Equal(first, kept) {
		t.Fatal("a second load replaced the keyring")
	}
}

func TestLoadRefusesShortKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "seal.keys")
	_ = os.WriteFile(path, []byte("c2hvcnQ\n"), 0o600)
	if _, err := Load(path); err == nil {
		t.Fatal("a short key loaded")
	}
}

func TestOlderKeysStillOpenAndOnlyTheFirstSeals(t *testing.T) {
	oldKey, newKey := bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32)
	before, _ := New(oldKey)
	sealedBefore, _ := before.Seal("p", payload{"w", "old"})
	ring, err := New(newKey, oldKey)
	if err != nil {
		t.Fatal(err)
	}
	var got payload
	if err := ring.Open("p", sealedBefore, &got); err != nil || got.Token != "old" {
		t.Fatalf("an older key no longer opens: %v", err)
	}
	sealedAfter, _ := ring.Seal("p", payload{"w", "new"})
	if err := before.Open("p", sealedAfter, &got); !errors.Is(err, ErrInvalid) {
		t.Fatal("the ring sealed with an older key")
	}
	onlyNew, _ := New(newKey)
	if err := onlyNew.Open("p", sealedAfter, &got); err != nil {
		t.Fatalf("the first key did not seal: %v", err)
	}
}

func TestLoadReadsEveryKeyOfTheFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "seal.keys")
	first, _ := NewKey()
	_ = os.WriteFile(path, []byte(first+"\n"), 0o600)
	before, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	sealed, _ := before.Seal("p", payload{"w", "t"})
	second, _ := NewKey()
	_ = os.WriteFile(path, []byte("# rotated\n"+second+"\n\n"+first+"\n"), 0o600)
	s, err := Load(path)
	if err != nil || len(s.aeads) != 2 {
		t.Fatalf("load: %v", err)
	}
	var got payload
	if err := s.Open("p", sealed, &got); err != nil {
		t.Fatalf("the kept key no longer opens: %v", err)
	}
}

func TestParseKeysRefusesALineItCannotRead(t *testing.T) {
	first, _ := NewKey()
	// A line past the scanner's buffer stops it; without the check, the
	// keyring would read as the first key alone.
	if _, err := ParseKeys(first + "\n" + strings.Repeat("a", 70000) + "\n"); err == nil {
		t.Fatal("a keyring with an unreadable line parsed")
	}
}

func TestLoadRefusesAnEmptyKeyring(t *testing.T) {
	empty := filepath.Join(t.TempDir(), "empty")
	_ = os.WriteFile(empty, []byte("# no key yet\n"), 0o600)
	if _, err := Load(empty); err == nil {
		t.Fatal("an empty keyring opened")
	}
}
