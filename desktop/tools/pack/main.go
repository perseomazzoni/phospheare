// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Command pack writes a release archive of one folder, so `build.sh` needs
// only Go on the build machine.
//
//	go run ./tools/pack -o once-dark-studio-desktop-1.0.0-linux-amd64.tar.gz <folder>
//
// The output's extension picks the format: `.zip` or `.tar.gz`. The archive
// holds the folder itself as its single top-level entry. The two programs,
// `once-dark-studio-desktop` and the `identity` service it starts, are
// stored with mode 0755 so they run after extraction; every other file is
// stored with mode 0644.
package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// stamp is the time every entry carries: `SOURCE_DATE_EPOCH` when the build
// sets it, so two builds of one tag give byte-equal archives, else now.
func stamp() time.Time {
	if epoch, err := strconv.ParseInt(os.Getenv("SOURCE_DATE_EPOCH"), 10, 64); err == nil {
		return time.Unix(epoch, 0).UTC()
	}
	return time.Now()
}

func main() {
	out := flag.String("o", "", "archive to write (.zip or .tar.gz)")
	flag.Parse()
	if *out == "" || flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: pack -o <archive.zip|archive.tar.gz> <folder>")
		os.Exit(2)
	}
	if err := pack(*out, flag.Arg(0)); err != nil {
		fmt.Fprintln(os.Stderr, "pack:", err)
		os.Exit(1)
	}
}

var programs = map[string]bool{"once-dark-studio-desktop": true, "identity": true}

type entry struct {
	name string
	path string
	mode int64
}

func entries(dir string) ([]entry, error) {
	base := filepath.Base(dir)
	var out []entry
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		mode := int64(0o644)
		if programs[d.Name()] {
			mode = 0o755
		}
		out = append(out, entry{name: path.Join(base, filepath.ToSlash(rel)), path: p, mode: mode})
		return nil
	})
	return out, err
}

func pack(out, dir string) error {
	list, err := entries(dir)
	if err != nil {
		return err
	}
	f, err := os.Create(out)
	if err != nil {
		return err
	}
	defer f.Close()
	switch {
	case strings.HasSuffix(out, ".zip"):
		err = writeZip(f, list)
	case strings.HasSuffix(out, ".tar.gz"):
		err = writeTarGz(f, list)
	default:
		err = fmt.Errorf("unknown archive type %s", out)
	}
	if err != nil {
		return err
	}
	return f.Close()
}

func writeZip(w io.Writer, list []entry) error {
	zw := zip.NewWriter(w)
	at := stamp()
	for _, e := range list {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate, Modified: at}
		h.SetMode(fs.FileMode(e.mode))
		dst, err := zw.CreateHeader(h)
		if err != nil {
			return err
		}
		if err := copyFile(dst, e.path); err != nil {
			return err
		}
	}
	return zw.Close()
}

func writeTarGz(w io.Writer, list []entry) error {
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	at := stamp()
	for _, e := range list {
		info, err := os.Stat(e.path)
		if err != nil {
			return err
		}
		if err := tw.WriteHeader(&tar.Header{Name: e.name, Mode: e.mode, Size: info.Size(), ModTime: at, Typeflag: tar.TypeReg}); err != nil {
			return err
		}
		if err := copyFile(tw, e.path); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

func copyFile(dst io.Writer, p string) error {
	src, err := os.Open(p)
	if err != nil {
		return err
	}
	defer src.Close()
	_, err = io.Copy(dst, src)
	return err
}
