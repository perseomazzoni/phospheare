// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package main

import (
	"path/filepath"
	"slices"
	"testing"
)

func TestParseFlags(t *testing.T) {
	o, err := parseFlags([]string{"--port", "5000", "--no-browser", "--data-dir", "/d"})
	if err != nil || o.port != 5000 || !o.noBrowser || o.dataDir != "/d" || o.dev || o.acmeDirectory == "" {
		t.Fatalf("%+v %v", o, err)
	}
	if _, err := parseFlags([]string{"--dev"}); err == nil {
		t.Fatal("--dev without --dev-origin was accepted")
	}
	o, err = parseFlags([]string{"--dev", "--dev-origin", "http://localhost:5173"})
	if err != nil || !o.dev || o.devOrigin != "http://localhost:5173" {
		t.Fatalf("%+v %v", o, err)
	}
}

// The login entry repeats the port and data folder the running copy was
// given, the folder made absolute, and nothing when neither was.
func TestLoginArgsRepeatWhereTheCopyRuns(t *testing.T) {
	if got := loginArgs(options{}, "/home/rossi/.config/once-dark-studio-desktop"); got != nil {
		t.Fatalf("defaults: %q", got)
	}
	abs, _ := filepath.Abs("studio-data")
	got := loginArgs(options{port: 47900, dataDir: "studio-data"}, "studio-data")
	if want := []string{"--port", "47900", "--data-dir", abs}; !slices.Equal(got, want) {
		t.Fatalf("%q, want %q", got, want)
	}
}
