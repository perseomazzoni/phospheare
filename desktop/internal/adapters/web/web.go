// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package web holds the built single-page application the desktop program
// serves. A release build copies `web/dist` into `webdist` before compiling;
// the tracked tree holds only a placeholder `index.html`, so the module
// builds without the SPA.
package web

import (
	"embed"
	"io/fs"
	"os"
)

//go:embed all:webdist
var embedded embed.FS

// Embedded answers the SPA compiled into the executable, rooted at its
// `index.html`.
func Embedded() fs.FS {
	sub, err := fs.Sub(embedded, "webdist")
	if err != nil {
		panic(err)
	}
	return sub
}

// FromDisk answers the SPA in dir, for development against a fresh
// `web/dist`; it fails when dir holds no `index.html`.
func FromDisk(dir string) (fs.FS, error) {
	fsys := os.DirFS(dir)
	if _, err := fs.Stat(fsys, "index.html"); err != nil {
		return nil, err
	}
	return fsys, nil
}
