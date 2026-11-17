// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package browser opens a URL in the user's default browser, and a folder
// in the file manager.
package browser

import (
	"os/exec"
	"runtime"
)

// Command answers the program and arguments that open url on goos.
func Command(goos, url string) (string, []string) {
	switch goos {
	case "windows":
		return "rundll32", []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		return "open", []string{url}
	default:
		return "xdg-open", []string{url}
	}
}

// FolderCommand answers the program and arguments that show dir in the
// file manager of goos.
func FolderCommand(goos, dir string) (string, []string) {
	if goos == "windows" {
		return "explorer", []string{dir}
	}
	return Command(goos, dir)
}

// Open starts the default browser at url without waiting for it.
func Open(url string) error {
	return start(Command(runtime.GOOS, url))
}

// OpenFolder shows dir in the file manager without waiting for it.
func OpenFolder(dir string) error {
	return start(FolderCommand(runtime.GOOS, dir))
}

func start(name string, args []string) error {
	cmd := exec.Command(name, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
