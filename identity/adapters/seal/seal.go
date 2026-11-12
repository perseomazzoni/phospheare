// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package seal turns a value into an opaque cookie string that only holders
// of the same keys can open. A sealed string is base64url of a version byte,
// a 12-byte nonce and the AES-256-GCM ciphertext of the value's JSON. The
// purpose string is authenticated data, so a value sealed for one cookie
// cannot be opened as another.
//
// The keys are a keyring: the first key seals, every key opens. Rotating
// without signing anyone out puts a new key first and keeps the old ones
// until the cookies they sealed have aged out; dropping a key invalidates
// every string it sealed. A keyring file holds one base64url key per line;
// blank lines and lines starting with `#` are ignored. The file is read once,
// when the sealer is made, so a change to it takes effect at the next start.
package seal

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	version  byte = 1
	keySize       = 32
	nonceLen      = 12
)

// ErrInvalid reports a sealed string that is malformed, tampered with, of
// another version, sealed for another purpose or under a key the ring does
// not hold.
var ErrInvalid = errors.New("seal: invalid sealed value")

// Sealer seals with the keyring's first key and opens with any of them.
type Sealer struct {
	aeads []cipher.AEAD
}

// New answers a sealer over keys, first key sealing, that is never written
// to disk.
func New(keys ...[]byte) (*Sealer, error) {
	if len(keys) == 0 {
		return nil, errors.New("seal: no key")
	}
	aeads := make([]cipher.AEAD, 0, len(keys))
	for i, key := range keys {
		if len(key) != keySize {
			return nil, fmt.Errorf("seal: key %d is %d bytes, want %d", i+1, len(key), keySize)
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		aeads = append(aeads, aead)
	}
	return &Sealer{aeads: aeads}, nil
}

// Load reads the keyring at path, creating one with a single random key and
// mode 0600 when the file does not exist.
func Load(path string) (*Sealer, error) {
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		key, err := NewKey()
		if err != nil {
			return nil, err
		}
		if err := writeFile(path, key+"\n"); err != nil {
			return nil, err
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	keys, err := ParseKeys(string(raw))
	if err != nil {
		return nil, fmt.Errorf("seal: %s: %w", path, err)
	}
	return New(keys...)
}

// FromText answers a sealer over a keyring's text, as its file would hold
// it, that is never written to disk.
func FromText(text string) (*Sealer, error) {
	keys, err := ParseKeys(text)
	if err != nil {
		return nil, fmt.Errorf("seal: %w", err)
	}
	return New(keys...)
}

// Seal answers v's JSON sealed for purpose under the first key.
func (s *Sealer) Seal(purpose string, v any) (string, error) {
	plain, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, nonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := append([]byte{version}, nonce...)
	out = s.aeads[0].Seal(out, nonce, plain, additional(purpose))
	return base64.RawURLEncoding.EncodeToString(out), nil
}

// Open decodes sealed into v with whichever key sealed it; any failure
// answers ErrInvalid.
func (s *Sealer) Open(purpose, sealed string, v any) error {
	raw, err := base64.RawURLEncoding.DecodeString(sealed)
	if err != nil || len(raw) < 1+nonceLen || raw[0] != version {
		return ErrInvalid
	}
	for _, aead := range s.aeads {
		plain, err := aead.Open(nil, raw[1:1+nonceLen], raw[1+nonceLen:], additional(purpose))
		if err != nil {
			continue
		}
		if json.Unmarshal(plain, v) != nil {
			return ErrInvalid
		}
		return nil
	}
	return ErrInvalid
}

func additional(purpose string) []byte {
	return append([]byte{version}, purpose...)
}

// NewKey answers a fresh random key as one keyring line.
func NewKey() (string, error) {
	key := make([]byte, keySize)
	if _, err := rand.Read(key); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(key), nil
}

// ParseKeys reads a keyring file's text, first key first.
func ParseKeys(text string) ([][]byte, error) {
	var keys [][]byte
	sc := bufio.NewScanner(strings.NewReader(text))
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(line, "="))
		if err != nil || len(key) != keySize {
			return nil, fmt.Errorf("line %d is not a %d-byte base64url key", n, keySize)
		}
		keys = append(keys, key)
	}
	// The scanner stops silently on a line it cannot hold, and the keys
	// after it would go unread.
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return nil, errors.New("it holds no key")
	}
	return keys, nil
}

// writeFile writes text next to path, flushes it to disk and only then
// renames it into place, so a crash or power loss never leaves an empty or
// half-written keyring.
func writeFile(path, text string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".new"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(text); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
