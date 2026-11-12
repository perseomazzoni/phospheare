// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package durable replaces a file whole. The new content goes to a
// temporary file beside it, reaches the disk, and only then takes the
// file's name, so a crash or power loss leaves either the old file or the
// new one, never an empty or partial one.
package durable

import "os"

// WriteFile replaces path with data, created with perm.
func WriteFile(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".new"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
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
