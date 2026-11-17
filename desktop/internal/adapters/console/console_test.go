// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package console

import (
	"io"
	"os"
	"testing"
)

// The test runs with standard streams that reach somewhere, as a terminal
// or a pipe does; a start with none is the Windows build's alone.
func TestATerminalTakesThePersonsWords(t *testing.T) {
	c := Open()
	if c.Out != os.Stdout || c.Terminal != os.Stdout || c.Errors != os.Stderr {
		t.Fatalf("console %+v", c)
	}
	if c.Out == io.Discard {
		t.Fatal("a terminal's words are discarded")
	}
}
