// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build linux

package autostart

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func desktopPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "autostart", "once-dark-studio-desktop.desktop"), nil
}

// quoteExec quotes an argument for a desktop entry's Exec key.
func quoteExec(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "`", "\\`", `$`, `\$`, `%`, `%%`)
	return `"` + r.Replace(s) + `"`
}

func enable(exe string, args []string) error {
	p, err := desktopPath()
	if err != nil {
		return err
	}
	line := quoteExec(exe)
	for _, a := range args {
		line += " " + quoteExec(a)
	}
	body := "[Desktop Entry]\nType=Application\nName=" + Name + "\nExec=" + line +
		" --no-browser\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, []byte(body), 0o644)
}

func disable() error {
	p, err := desktopPath()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func enabled() (bool, error) {
	p, err := desktopPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(p)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}
