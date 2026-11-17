// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package logs

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"os"
	"runtime/debug"
	"strings"
)

// CrashFile is the file in the data folder where the Go runtime writes a
// crash: the panic and the stack, which it also writes to standard error,
// where a program started from a launcher keeps nothing. It is not in Dir:
// the runtime writes it as it is, with no personal value removed.
const CrashFile = "crash.txt"

// maxCrash is how much of a crash is read back. The runtime writes only the
// goroutine that failed, unless GOTRACEBACK asks for more.
const maxCrash = 256 << 10

// KeepCrashes answers the lines of the crash the last run left at path,
// then empties the file and has the runtime write the next crash there.
// The caller logs the lines through a redacting logger, so the log files
// hold them with personal values removed. An empty answer is a last run
// that did not crash.
func KeepCrashes(path string) ([]string, error) {
	last, readErr := readCrash(path)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return last, errors.Join(readErr, err)
	}
	// The runtime keeps its own copy of the descriptor.
	defer f.Close()
	return last, errors.Join(readErr, debug.SetCrashOutput(f, debug.CrashOptions{}))
}

func readCrash(path string) ([]string, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, maxCrash))
	if err != nil {
		return nil, err
	}
	var lines []string
	for line := range strings.SplitSeq(string(bytes.TrimRight(raw, "\n")), "\n") {
		if line = strings.TrimRight(line, "\r"); strings.TrimSpace(line) != "" {
			lines = append(lines, line)
		}
	}
	return lines, nil
}
