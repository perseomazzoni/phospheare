// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package tray

import (
	_ "embed"

	"github.com/godbus/dbus/v5"
)

// pngIcon is the figure as a StatusNotifierItem host takes it, a PNG that
// `tools/winres -tray` writes. It is the light figure: the host tells no
// theme, and panels are mostly dark.
//
//go:embed icon/tray.png
var pngIcon []byte

func icon() []byte { return pngIcon }

// watcher is the D-Bus name of the tray host every StatusNotifierItem
// registers with.
const watcher = "org.kde.StatusNotifierWatcher"

// Available reports whether the session has a tray host. Most desktops
// have one; `GNOME` without the `AppIndicator` extension, and a session
// with no desktop, have none, and the tray library would show nothing there
// without saying so.
func Available() bool {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return false
	}
	defer conn.Close()
	var owned bool
	err = conn.BusObject().Call("org.freedesktop.DBus.NameHasOwner", 0, watcher).Store(&owned)
	return err == nil && owned
}
