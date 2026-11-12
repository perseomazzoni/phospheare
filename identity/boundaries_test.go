// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package identity_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// imports answers every import of every Go file under dir, tests included,
// keyed by file.
func imports(t *testing.T, dir string) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			out[path] = append(out[path], p)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// standard reports an import path of the standard library, whose first
// element never holds a dot.
func standard(p string) bool {
	return !strings.Contains(strings.SplitN(p, "/", 2)[0], ".")
}

// The identity service deploys on its own; the desktop bundles it, never
// the other way round.
func TestIdentityNeverImportsDesktop(t *testing.T) {
	for file, list := range imports(t, ".") {
		for _, p := range list {
			if strings.HasPrefix(p, "github.com/perseomazzoni/phospheare/desktop") {
				t.Errorf("%s imports %s", file, p)
			}
		}
	}
}

func TestDomainImportsOnlyTheStandardLibrary(t *testing.T) {
	for file, list := range imports(t, "domain") {
		for _, p := range list {
			if !standard(p) {
				t.Errorf("%s imports %s", file, p)
			}
		}
	}
}

func TestPortsImportOnlyTheDomain(t *testing.T) {
	for file, list := range imports(t, "ports") {
		for _, p := range list {
			if !standard(p) && p != "github.com/perseomazzoni/phospheare/identity/domain" {
				t.Errorf("%s imports %s", file, p)
			}
		}
	}
}

func TestApplicationImportsOnlyDomainAndPorts(t *testing.T) {
	for file, list := range imports(t, "application") {
		for _, p := range list {
			if !standard(p) && p != "github.com/perseomazzoni/phospheare/identity/domain" && p != "github.com/perseomazzoni/phospheare/identity/ports" {
				t.Errorf("%s imports %s", file, p)
			}
		}
	}
}
