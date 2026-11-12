// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package vault keeps the desktop's secrets in the system's own store,
// locked with the person's login: Windows Credential Manager, the macOS
// Keychain or the Secret Service on Linux. Where none answers at the first
// start, they go to `secrets.json` in the data folder (`file.go`).
// Each data folder has items of its own, so two setups (`--data-dir`) never
// share a secret.
//
// It keeps the secrets from a copy of the data folder, a backup and a
// roaming profile. It does not keep them from a program that runs as the
// same person while they are logged in: on every system such a program can
// ask the store as this one does.
package vault

import (
	"errors"
	"fmt"
	"sync"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// product names the items in the system's store.
const product = "once-dark-studio-desktop"

// store is one place the secrets can be kept.
type store interface {
	get(name string) (string, error)
	set(name, value string) error
	// remove answers nil when nothing is kept under name.
	remove(name string) error
}

// systemStore is a system's own store; check answers nil once it answers.
type systemStore interface {
	store
	check() error
}

// openSystem answers the system's store for a data folder. Tests replace
// it.
var openSystem = system

// Vault is the secrets of one data folder.
type Vault struct {
	mu    sync.Mutex
	place domain.SecretPlace
	store store
}

var _ ports.Vault = (*Vault)(nil)

// Open answers the vault of dataDir. place is the setup's recorded choice:
// unchosen takes the system's store when it answers and the file when it
// does not; the system's store fails when it does not answer, so a store
// that is missing for one start never leaves the setup with an empty file.
func Open(dataDir string, place domain.SecretPlace) (*Vault, error) {
	switch place {
	case domain.SecretsInFile:
		return &Vault{place: place, store: file{dir: dataDir}}, nil
	case domain.SecretsInSystem, domain.SecretsUnchosen:
		sys, err := openSystem(dataDir)
		if err == nil {
			err = sys.check()
		}
		switch {
		case err == nil:
			return &Vault{place: domain.SecretsInSystem, store: sys}, nil
		case place == domain.SecretsInSystem:
			return nil, fmt.Errorf("%w: %v", ErrNoStore, err)
		}
		return &Vault{place: domain.SecretsInFile, store: file{dir: dataDir}}, nil
	}
	return nil, fmt.Errorf("config.json keeps the secrets in %q, which is no place this program knows", place)
}

// ErrNoStore is Open's answer when the setup keeps its secrets in the
// system's store and that store does not answer.
var ErrNoStore = errors.New("the system's password store did not answer")

// Memory answers a vault that is never written, for tests.
func Memory() *Vault {
	return &Vault{place: domain.SecretsInFile, store: memory{}}
}

// Place answers where the secrets are kept.
func (v *Vault) Place() domain.SecretPlace { return v.place }

// Get answers the secret kept under name, or "".
func (v *Vault) Get(name string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.store.get(name)
}

// Set keeps value under name; "" removes the secret.
func (v *Vault) Set(name, value string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if value == "" {
		return v.store.remove(name)
	}
	return v.store.set(name, value)
}

type memory map[string]string

func (m memory) get(name string) (string, error) { return m[name], nil }
func (m memory) set(name, value string) error    { m[name] = value; return nil }
func (m memory) remove(name string) error        { delete(m, name); return nil }
