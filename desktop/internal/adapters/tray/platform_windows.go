// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package tray

import (
	_ "embed"

	"golang.org/x/sys/windows/registry"
)

// nightIcon and dayIcon are the figure as the notification area takes it,
// `.ico` files that `tools/winres -tray` writes: a light figure for a dark
// taskbar, and a dark one for a light taskbar.
var (
	//go:embed icon/tray-night.ico
	nightIcon []byte
	//go:embed icon/tray-day.ico
	dayIcon []byte
)

// icon answers the figure for the taskbar's current theme, which Windows
// keeps in `SystemUsesLightTheme`; without that value the taskbar is dark.
func icon() []byte {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE)
	if err != nil {
		return nightIcon
	}
	defer k.Close()
	if light, _, err := k.GetIntegerValue("SystemUsesLightTheme"); err == nil && light == 1 {
		return dayIcon
	}
	return nightIcon
}

// Available is true: every Windows desktop has a notification area.
func Available() bool { return true }
