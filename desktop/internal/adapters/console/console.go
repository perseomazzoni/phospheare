// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package console decides where the program's words go. On macOS and Linux
// they go to the terminal. The Windows build has no console window, so there
// its messages and its log go to `desktop.log` in the data folder, and to a
// terminal as well when one was attached at start. A failure to start that
// no terminal shows is shown in a message box.
package console

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
)

// LogName is the log file in the data folder.
const LogName = "desktop.log"

// MaxLog is the size past which the log moves to `desktop.log.1`, replacing
// the copy there, so the log never holds more than twice this.
const MaxLog = 1 << 20

// Console is where the program writes.
type Console struct {
	// Out takes what the program tells the user, Log its log.
	Out, Log io.Writer
	// Terminal takes what must never reach the log file; it is nil when no
	// terminal shows the program's words.
	Terminal io.Writer
	file     *rotating
}

// Open answers the console of a program whose data folder is dataDir.
func Open(dataDir string) (*Console, error) { return open(dataDir, toFile) }

func open(dataDir string, toFile bool) (*Console, error) {
	if !toFile {
		return &Console{Out: os.Stdout, Log: os.Stderr, Terminal: os.Stdout}, nil
	}
	f, err := openRotating(filepath.Join(dataDir, LogName), MaxLog)
	if err != nil {
		return nil, err
	}
	c := &Console{Out: f, Log: f, file: f}
	if usable(os.Stdout) {
		c.Out = io.MultiWriter(f, os.Stdout)
		c.Terminal = os.Stdout
	}
	if usable(os.Stderr) {
		c.Log = io.MultiWriter(f, os.Stderr)
	}
	return c, nil
}

// Close closes the log file, if there is one.
func (c *Console) Close() error {
	if c.file == nil {
		return nil
	}
	return c.file.Close()
}

// Fail tells the user the program cannot start: on its standard error and,
// when that reaches no terminal, in a message box titled title.
func Fail(title, message string) {
	fmt.Fprintln(os.Stderr, message)
	if !usable(os.Stderr) {
		messageBox(title, message)
	}
}

// rotating is a log file that moves aside once it outgrows max.
type rotating struct {
	mu   sync.Mutex
	path string
	max  int64
	f    *os.File
	size int64
}

func openRotating(path string, max int64) (*rotating, error) {
	r := &rotating{path: path, max: max}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *rotating) open() error { return r.openWith(os.O_APPEND) }

func (r *rotating) openWith(mode int) error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|mode, 0o600)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	r.f, r.size = f, st.Size()
	return nil
}

func (r *rotating) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.size > 0 && r.size+int64(len(p)) > r.max {
		_ = r.f.Close()
		// When the full log cannot move aside, as when another program
		// holds it open on Windows, it starts over instead: kept, it would
		// stay full and every line would try again.
		mode := os.O_APPEND
		if err := os.Rename(r.path, r.path+".1"); err != nil {
			mode = os.O_TRUNC
		}
		if err := r.openWith(mode); err != nil {
			return 0, err
		}
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

func (r *rotating) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.f.Close()
}
