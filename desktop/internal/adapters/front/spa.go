// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package front

import (
	"crypto/sha256"
	"encoding/base64"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"
)

func init() {
	for ext, typ := range map[string]string{
		".webmanifest": "application/manifest+json",
		".mjs":         "text/javascript; charset=utf-8",
		".wasm":        "application/wasm",
		".woff2":       "font/woff2",
		".svg":         "image/svg+xml",
	} {
		_ = mime.AddExtensionType(ext, typ)
	}
}

// spa serves the built application. A path without an extension that names
// no file is a client route and gets `index.html`; a missing path with an
// extension is a 404, so a stale asset reference fails visibly. Files under
// `/assets/` carry content hashes in their names and are cached for a year;
// everything else revalidates.
type spa struct {
	fsys      fs.FS
	immutable bool
	etags     sync.Map
}

func newSPA(fsys fs.FS, immutable bool) *spa {
	return &spa{fsys: fsys, immutable: immutable}
}

func (s *spa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	f, info, err := s.open(name)
	if err != nil && path.Ext(name) == "" {
		name = "index.html"
		f, info, err = s.open(name)
	}
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	rs, ok := f.(io.ReadSeeker)
	if !ok {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", cacheAssets)
	} else {
		w.Header().Set("Cache-Control", cacheOther)
	}
	modtime := info.ModTime()
	if s.immutable {
		if tag, err := s.etag(name, rs); err == nil {
			w.Header().Set("ETag", tag)
		}
		modtime = time.Time{}
	}
	http.ServeContent(w, r, path.Base(name), modtime, rs)
}

// open answers the file name, following a directory to its `index.html`.
func (s *spa) open(name string) (fs.File, fs.FileInfo, error) {
	f, err := s.fsys.Open(name)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	if info.IsDir() {
		f.Close()
		if name == "." {
			return nil, nil, fs.ErrNotExist
		}
		return s.open(path.Join(name, "index.html"))
	}
	return f, info, nil
}

func (s *spa) etag(name string, rs io.ReadSeeker) (string, error) {
	if v, ok := s.etags.Load(name); ok {
		return v.(string), nil
	}
	h := sha256.New()
	if _, err := io.Copy(h, rs); err != nil {
		return "", err
	}
	if _, err := rs.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	tag := `"` + base64.RawURLEncoding.EncodeToString(h.Sum(nil)[:12]) + `"`
	s.etags.Store(name, tag)
	return tag, nil
}
