// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package main

import (
	"strings"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/admin"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/autostart"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/browser"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/tray"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/words"
	"github.com/perseomazzoni/phospheare/desktop/internal/application"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// trayActions wires the tray's menu to what the setup page does: the same
// home-network manager, login list and settings, and the same quit. The
// menu shows the login list's kept reading, which a change from the menu,
// the setup page or a wipe drops and a setup page load reads again.
func trayActions(local, key, systemLanguage string, store ports.ConfigStore, lan *application.Manager, login *autostart.Remembered,
	executable func() (string, error), loginArgs []string, quit func(), logf func(string, ...any)) tray.Actions {
	open := func(url string) func() {
		return func() {
			if err := browser.Open(url); err != nil {
				// The fragment holds the launch key, which the log never holds.
				logf("tray: the browser did not open %s: %v", strings.SplitN(url, "#", 2)[0], err)
			}
		}
	}
	return tray.Actions{
		ProductName: productName,
		Words: func() tray.Words {
			return words.For(domain.Language(store.Get().Language, systemLanguage), productName)
		},
		Open:         open(local + "/app"),
		Setup:        open(admin.SetupURL(local, key, "")),
		OpenOnPhone:  open(admin.SetupURL(local, key, "phones")),
		Network:      func() tray.Network { return networkOf(store.Get(), lan.Status()) },
		StartNetwork: lan.TurnOn,
		StopNetwork:  lan.TurnOff,
		StartAtLogin: login.Last,
		SetStartAtLogin: func(on bool) error {
			if on {
				exe, err := executable()
				if err != nil {
					return err
				}
				if err := login.Enable(exe, loginArgs); err != nil {
					return err
				}
			} else if err := login.Disable(); err != nil {
				return err
			}
			return store.Update(func(c *domain.Config) { c.StartAtLogin = on })
		},
		Quit: quit,
		Logf: logf,
	}
}

// networkOf answers the home network as the tray shows it.
func networkOf(cfg domain.Config, s application.Status) tray.Network {
	switch s.State {
	case application.StateRunning:
		return tray.Network{State: tray.NetworkOn, URL: s.URL, Asks: s.Terms != ""}
	case application.StateStarting:
		return tray.Network{State: tray.NetworkStarting}
	case application.StateError:
		return tray.Network{State: tray.NetworkFailed, Asks: s.Terms != ""}
	}
	if domain.Validate(cfg) != nil {
		return tray.Network{State: tray.NetworkUnset}
	}
	return tray.Network{State: tray.NetworkOff}
}
