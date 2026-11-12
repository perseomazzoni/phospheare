// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package console

import (
	"os"

	"golang.org/x/sys/windows"
)

// toFile is set: the program is linked without a console (`-H windowsgui`).
const toFile = true

// usable reports whether f reaches somewhere: a console, a pipe or a file.
// Started from Explorer, the program has no standard handles at all.
func usable(f *os.File) bool {
	if f == nil {
		return false
	}
	h := windows.Handle(f.Fd())
	if h == 0 || h == windows.InvalidHandle {
		return false
	}
	t, err := windows.GetFileType(h)
	return err == nil && t != windows.FILE_TYPE_UNKNOWN
}

func messageBox(title, message string) {
	t, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	m, err := windows.UTF16PtrFromString(message)
	if err != nil {
		return
	}
	_, _ = windows.MessageBox(0, m, t, windows.MB_OK|windows.MB_ICONERROR|windows.MB_SETFOREGROUND)
}
