// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package vault

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/durable"
)

// file is `secrets.json` in the data folder: every secret by name, in one
// file with mode 0600. Only the person's account keeps others out of it.
type file struct{ dir string }

func (f file) path() string { return filepath.Join(f.dir, "secrets.json") }

func (f file) read() (map[string]string, error) {
	all := map[string]string{}
	raw, err := os.ReadFile(f.path())
	switch {
	case errors.Is(err, os.ErrNotExist):
		return all, nil
	case err != nil:
		return nil, err
	}
	if err := json.Unmarshal(raw, &all); err != nil {
		return nil, err
	}
	// A file that holds `null` unmarshals to a nil map, which a set would
	// panic on.
	if all == nil {
		all = map[string]string{}
	}
	return all, nil
}

func (f file) write(all map[string]string) error {
	raw, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(f.dir, 0o700); err != nil {
		return err
	}
	return durable.WriteFile(f.path(), append(raw, '\n'), 0o600)
}

func (f file) get(name string) (string, error) {
	all, err := f.read()
	return all[name], err
}

func (f file) set(name, value string) error {
	all, err := f.read()
	if err != nil {
		return err
	}
	all[name] = value
	return f.write(all)
}

func (f file) remove(name string) error {
	all, err := f.read()
	if err != nil {
		return err
	}
	if _, ok := all[name]; !ok {
		return nil
	}
	delete(all, name)
	return f.write(all)
}
