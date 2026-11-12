// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package web

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestEmbeddedHasIndex(t *testing.T) {
	if _, err := fs.Stat(Embedded(), "index.html"); err != nil {
		t.Fatal(err)
	}
}

func TestFromDiskNeedsIndex(t *testing.T) {
	dir := t.TempDir()
	if _, err := FromDisk(dir); err == nil {
		t.Fatal("a folder without index.html was accepted")
	}
	_ = os.WriteFile(filepath.Join(dir, "index.html"), []byte("x"), 0o644)
	if _, err := FromDisk(dir); err != nil {
		t.Fatal(err)
	}
}
