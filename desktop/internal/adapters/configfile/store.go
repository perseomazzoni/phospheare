// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package configfile keeps the desktop's settings in `config.json` in the
// data folder. The settings' secrets, the Google client secret, the deSEC
// token and, until that token exists, the deSEC account's password, are
// kept in the vault (ports.Vault) instead, and never reach the file. The
// file still has mode 0600: it names the Google client and the home
// network.
package configfile

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/durable"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// DefaultDir answers the per-user data folder: `once-dark-studio-desktop`
// under the operating system's configuration folder.
func DefaultDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "once-dark-studio-desktop"), nil
}

// Store is the configuration in memory, written through to its file and
// its vault.
type Store struct {
	mu    sync.Mutex
	path  string
	vault ports.Vault
	cfg   domain.Config
}

// OpenVault opens the vault where the settings keep their secrets, given
// where the setup recorded them.
type OpenVault func(domain.SecretPlace) (ports.Vault, error)

// Open reads path, answering the defaults when the file does not exist,
// and fills the secrets from the vault openVault answers. The first start
// records where that vault keeps them.
func Open(path string, openVault OpenVault) (*Store, error) {
	cfg := domain.Defaults()
	raw, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return nil, err
	default:
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return nil, err
		}
	}
	domain.Normalize(&cfg)
	vault, err := openVault(cfg.Secrets)
	if err != nil {
		return nil, err
	}
	for name, field := range secrets(&cfg) {
		if *field, err = vault.Get(name); err != nil {
			return nil, err
		}
	}
	if cfg.Secrets != vault.Place() {
		cfg.Secrets = vault.Place()
		if err := write(path, cfg); err != nil {
			return nil, err
		}
	}
	return &Store{path: path, vault: vault, cfg: cfg}, nil
}

// Memory answers a store that is never written, for tests.
func Memory(cfg domain.Config) *Store {
	domain.Normalize(&cfg)
	return &Store{cfg: cfg}
}

// Get answers a copy of the configuration.
func (s *Store) Get() domain.Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

// Update applies change, keeps the secrets it changed in the vault, in a
// fixed order, and writes the file. The change is kept in memory only when
// every write succeeds. When one fails, the secrets written before it are
// put back to their old values, so the vault agrees with memory again. Each
// put-back is tried whatever the one before did, and each that fails too is
// named in the error. Where the secrets are kept is the store's, so no change
// moves it.
func (s *Store) Update(change func(*domain.Config)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.cfg
	change(&next)
	domain.Normalize(&next)
	next.Secrets = s.cfg.Secrets
	var written []string
	was, now := secrets(&s.cfg), secrets(&next)
	putBack := func(err error) error {
		errs := []error{err}
		for _, name := range written {
			if back := s.vault.Set(name, *was[name]); back != nil {
				errs = append(errs, fmt.Errorf("%s could not be put back: %w", name, back))
			}
		}
		return errors.Join(errs...)
	}
	if s.vault != nil {
		for _, name := range secretNames {
			if *now[name] == *was[name] {
				continue
			}
			if err := s.vault.Set(name, *now[name]); err != nil {
				return putBack(err)
			}
			written = append(written, name)
		}
	}
	if s.path != "" {
		if err := write(s.path, next); err != nil {
			return putBack(err)
		}
	}
	s.cfg = next
	return nil
}

// secretNames is the order the secrets are written in: the deSEC token
// before the pending password it replaces, so a failure between the two
// leaves the password, never the token alone with the password gone.
var secretNames = []string{domain.SecretGoogleClient, domain.SecretDeSECToken, domain.SecretDeSECPassword}

// secrets answers the settings' secrets by the names the vault keeps them
// under.
func secrets(c *domain.Config) map[string]*string {
	return map[string]*string{
		domain.SecretGoogleClient:  &c.Google.ClientSecret,
		domain.SecretDeSECToken:    &c.LAN.DeSEC.Token,
		domain.SecretDeSECPassword: &c.LAN.DeSEC.PendingPassword,
	}
}

func write(path string, cfg domain.Config) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return durable.WriteFile(path, append(raw, '\n'), 0o600)
}
