// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package console

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestATerminalConsoleWritesNoFile(t *testing.T) {
	dir := t.TempDir()
	c, err := open(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if c.Out != os.Stdout || c.Log != os.Stderr {
		t.Fatal("a terminal console does not write to the terminal")
	}
	if _, err := os.Stat(filepath.Join(dir, LogName)); !os.IsNotExist(err) {
		t.Fatalf("a terminal console wrote a log file: %v", err)
	}
}

func TestAFileConsoleAppendsToTheLog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, LogName)
	if err := os.WriteFile(path, []byte("earlier\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := open(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintln(c.Out, "told")
	fmt.Fprintln(c.Log, "logged")
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "earlier\ntold\nlogged\n" {
		t.Fatalf("log %q", got)
	}
}

func TestTheLogMovesAsideOnceFull(t *testing.T) {
	path := filepath.Join(t.TempDir(), LogName)
	r, err := openRotating(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{"first\n", "second\n", "third\n"} {
		if _, err := r.Write([]byte(line)); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(path)
	older, _ := os.ReadFile(path + ".1")
	if string(current) != "third\n" || string(older) != "second\n" {
		t.Fatalf("current %q, older %q", current, older)
	}
}

// A full log that cannot move aside starts over rather than growing.
func TestAFullLogThatCannotMoveStartsOver(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, LogName)
	// A folder with a file in it cannot be replaced by a rename.
	if err := os.MkdirAll(filepath.Join(path+".1", "held"), 0o700); err != nil {
		t.Fatal(err)
	}
	r, err := openRotating(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{"first\n", "second\n", "third\n"} {
		if _, err := r.Write([]byte(line)); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	if current, _ := os.ReadFile(path); string(current) != "third\n" {
		t.Fatalf("current %q", current)
	}
}

func TestATerminalTakesWhatTheLogMustNot(t *testing.T) {
	c, err := open(t.TempDir(), false)
	if err != nil {
		t.Fatal(err)
	}
	if c.Terminal != os.Stdout {
		t.Fatal("a terminal console has no terminal")
	}
}

func TestALineLongerThanTheCapStillLands(t *testing.T) {
	path := filepath.Join(t.TempDir(), LogName)
	r, err := openRotating(path, 4)
	if err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("x", 10)
	if _, err := r.Write([]byte(long)); err != nil {
		t.Fatal(err)
	}
	r.Close()
	if got, _ := os.ReadFile(path); string(got) != long {
		t.Fatalf("log %q", got)
	}
}
