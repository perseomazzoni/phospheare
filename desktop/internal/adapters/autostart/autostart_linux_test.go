// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build linux

package autostart

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopEntryRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	s := System{}
	if on, err := s.Enabled(); err != nil || on {
		t.Fatalf("initially %v %v", on, err)
	}
	if err := s.Enable("/opt/Phospheare Desktop/once-dark-studio-desktop", nil); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "autostart", "once-dark-studio-desktop.desktop"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `Exec="/opt/Phospheare Desktop/once-dark-studio-desktop" --no-browser`) {
		t.Fatalf("entry:\n%s", raw)
	}
	if on, _ := s.Enabled(); !on {
		t.Fatal("not enabled")
	}
	if err := s.Disable(); err != nil {
		t.Fatal(err)
	}
	if on, _ := s.Enabled(); on {
		t.Fatal("still enabled")
	}
	if err := s.Disable(); err != nil {
		t.Fatalf("a second disable: %v", err)
	}
}

// The login entry starts the program the way the running copy was started:
// on its port and with its data folder.
func TestDesktopEntryCarriesTheArguments(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	if err := (System{}).Enable("/opt/studio/once-dark-studio-desktop", []string{"--port", "47900", "--data-dir", "/home/rossi/Studio $data"}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "autostart", "once-dark-studio-desktop.desktop"))
	if err != nil {
		t.Fatal(err)
	}
	want := `Exec="/opt/studio/once-dark-studio-desktop" "--port" "47900" "--data-dir" "/home/rossi/Studio \$data" --no-browser`
	if !strings.Contains(string(raw), want) {
		t.Fatalf("entry:\n%s", raw)
	}
}
