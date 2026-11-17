// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package console decides where the program's words for a person in a
// terminal go. The log does not go here: it goes to its file in every
// case (internal/adapters/logs). The Windows build has no console window,
// so there a terminal shows the program's words only when one was attached
// at start, and a failure to start that no terminal shows is shown in a
// message box.
package console

import (
	"fmt"
	"io"
	"os"
)

// Console is where the program writes for a terminal.
type Console struct {
	// Out takes what the program tells the person; it discards the words
	// when no terminal shows them.
	Out io.Writer
	// Terminal and Errors are the terminal's output and error streams, or
	// nil when no terminal shows the program's words. Terminal also takes
	// what must never reach the log file, such as the setup page's key.
	Terminal, Errors io.Writer
}

// Open answers the program's console.
func Open() *Console {
	c := &Console{Out: io.Discard}
	if usable(os.Stdout) {
		c.Out, c.Terminal = os.Stdout, os.Stdout
	}
	if usable(os.Stderr) {
		c.Errors = os.Stderr
	}
	return c
}

// Fail tells the person the program cannot start: on its standard error
// and, when that reaches no terminal, in a message box titled title.
func Fail(title, message string) {
	fmt.Fprintln(os.Stderr, message)
	if !usable(os.Stderr) {
		messageBox(title, message)
	}
}
