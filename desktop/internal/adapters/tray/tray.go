// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package tray puts the program in the notification area (Windows) or the
// system tray (Linux). The menu calls the setup page's functions and holds
// no state of its own: the setup page changes that state too, so the menu
// reads it again on every tick and redraws only the entries that changed.
// Where there is no tray, `Available` is false and the program runs in its
// terminal.
package tray

import (
	"context"
	"log/slog"
	"time"
)

// Item is one menu entry as the tray library draws it.
type Item interface {
	SetTitle(string)
	Enable()
	Disable()
	Check()
	Uncheck()
	Show()
	Hide()
}

// Menu adds entries, in order, to the tray library's menu. Each entry comes
// with the channel its clicks arrive on.
type Menu interface {
	Add(title string) (Item, <-chan struct{})
	AddCheckbox(title string, checked bool) (Item, <-chan struct{})
	AddSeparator()
}

// NetworkState is where the home network stands.
type NetworkState int

const (
	// NetworkUnset is a home network not set up on the setup page yet.
	// The menu then shows no switch for it: Setup is the way there.
	NetworkUnset NetworkState = iota
	NetworkOff
	NetworkStarting
	NetworkOn
	NetworkFailed
)

// Network is the home network as the menu shows it.
type Network struct {
	State NetworkState
	// URL is where it answers while on.
	URL string
	// Asks marks something only the person can settle on the setup page,
	// such as the certificate authority's agreement.
	Asks bool
}

// Words answers the menu's texts, by the keys of `internal/adapters/words`.
type Words interface {
	T(key string, pairs ...string) string
}

// Actions are what the menu reads and does. OpenOnPhone opens the setup
// page at the code phones scan.
type Actions struct {
	ProductName string
	// Words answers the texts in the language the settings choose. It is
	// read on every refresh, so a language chosen on the setup page shows.
	Words                    func() Words
	Open, Setup, OpenOnPhone func()
	Network                  func() Network
	StartNetwork             func() error
	StopNetwork              func() error
	// StartAtLogin is read on every refresh, so it must answer without
	// waiting on the system.
	StartAtLogin    func() (bool, error)
	SetStartAtLogin func(bool) error
	// ShowLogs shows the folder of the log files.
	ShowLogs func()
	Quit     func()
	// Log may be nil.
	Log *slog.Logger
}

// Tray is the menu, built.
type Tray struct {
	a                            Actions
	phone, status, toggle, login Item
	// ask shows while the home network asks for the person, and opens the
	// setup page.
	ask   Item
	asked <-chan struct{}
	// named are the entries whose title is only their name, in the order
	// of look.names.
	named                          [6]Item
	open, setup, switched, checked <-chan struct{}
	phoned, logs                   <-chan struct{}
	quit                           <-chan struct{}
	network                        Network
	loginOn                        bool
	// shown is what the entries show now; drawn is false until the first
	// refresh.
	shown look
	drawn bool
	// loginErr is the start-at-login error last logged, so one that lasts
	// is logged once.
	loginErr string
	// refreshed, when set, hears the end of every refresh.
	refreshed func()
}

// look is what the entries a refresh changes show.
type look struct {
	status, toggle     string
	toggleShown, phone bool
	// ask is the title of the entry that asks for the person, "" while it
	// is hidden.
	ask   string
	login bool
	// names are the titles of Open, Setup, Open on a phone, Start at login,
	// Show the log files and Quit, which change only with the language.
	names [6]string
}

// nameKeys are the texts of look.names.
var nameKeys = [6]string{"tray.open", "tray.setup", "tray.phone", "tray.login", "tray.logs", "tray.quit"}

// every is how often the menu reads the program's state again.
var every = 2 * time.Second

// Build adds the menu's entries to m and shows the current state.
func Build(m Menu, a Actions) *Tray {
	t := &Tray{a: a}
	t.named[0], t.open = m.Add("")
	t.named[1], t.setup = m.Add("")
	t.phone, t.phoned = m.Add("")
	t.named[2] = t.phone
	m.AddSeparator()
	t.status, _ = m.Add("")
	t.status.Disable()
	t.ask, t.asked = m.Add("")
	t.toggle, t.switched = m.Add("")
	t.login, t.checked = m.AddCheckbox("", false)
	t.named[3] = t.login
	m.AddSeparator()
	t.named[4], t.logs = m.Add("")
	t.named[5], t.quit = m.Add("")
	t.Refresh()
	return t
}

// Refresh shows the program's current state.
func (t *Tray) Refresh() {
	t.network = t.a.Network()
	w := t.a.Words()
	next := t.shown
	for i, k := range nameKeys {
		next.names[i] = w.T(k)
	}
	switch t.network.State {
	case NetworkUnset:
		next.status = w.T("tray.unset")
	case NetworkOff:
		next.status, next.toggle = w.T("tray.off"), w.T("tray.start")
	case NetworkStarting:
		next.status, next.toggle = w.T("tray.starting"), w.T("tray.stop")
	case NetworkOn:
		next.status, next.toggle = w.T("tray.on", "url", t.network.URL), w.T("tray.stop")
	case NetworkFailed:
		next.status, next.toggle = w.T("tray.failed"), w.T("tray.start")
	}
	next.ask = ""
	if t.network.Asks {
		next.ask = w.T("tray.asks")
	}
	next.toggleShown = t.network.State != NetworkUnset
	next.phone = t.network.State == NetworkOn
	on, err := t.a.StartAtLogin()
	if err != nil && err.Error() != t.loginErr {
		t.log().Warn("The login list could not be read.", "error", err)
	}
	t.loginErr = ""
	if err != nil {
		t.loginErr = err.Error()
	}
	t.loginOn, next.login = on, on
	t.draw(next)
	if t.refreshed != nil {
		t.refreshed()
	}
}

// draw shows next, touching only the entries that differ from what they
// show.
func (t *Tray) draw(next look) {
	was, all := t.shown, !t.drawn
	t.shown, t.drawn = next, true
	for i, name := range next.names {
		if all || name != was.names[i] {
			t.named[i].SetTitle(name)
		}
	}
	if all || next.status != was.status {
		t.status.SetTitle(next.status)
	}
	if all || next.toggle != was.toggle {
		t.toggle.SetTitle(next.toggle)
	}
	if all || next.ask != was.ask {
		if next.ask != "" {
			t.ask.SetTitle(next.ask)
		}
		showIf(t.ask, next.ask != "")
	}
	if all || next.toggleShown != was.toggleShown {
		showIf(t.toggle, next.toggleShown)
	}
	if all || next.phone != was.phone {
		showIf(t.phone, next.phone)
	}
	if all || next.login != was.login {
		if next.login {
			t.login.Check()
		} else {
			t.login.Uncheck()
		}
	}
}

func showIf(i Item, shown bool) {
	if shown {
		i.Show()
	} else {
		i.Hide()
	}
}

// Serve answers the menu's clicks and refreshes it until ctx ends.
func (t *Tray) Serve(ctx context.Context) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		case <-t.open:
			t.a.Open()
		case <-t.setup:
			t.a.Setup()
		case <-t.phoned:
			t.a.OpenOnPhone()
		case <-t.asked:
			t.a.Setup()
		case <-t.switched:
			t.switchNetwork()
		case <-t.checked:
			if err := t.a.SetStartAtLogin(!t.loginOn); err != nil {
				t.log().Warn("Start at login could not be changed.", "error", err)
				t.a.Setup()
			}
		case <-t.logs:
			t.a.ShowLogs()
		case <-t.quit:
			t.a.Quit()
			return
		}
		t.Refresh()
	}
}

// switchNetwork starts or stops the home network as the menu showed it. A
// home network that fails to start opens the setup page, which says why.
func (t *Tray) switchNetwork() {
	var err error
	switch t.network.State {
	case NetworkStarting, NetworkOn:
		err = t.a.StopNetwork()
	default:
		err = t.a.StartNetwork()
	}
	if err != nil {
		t.log().Warn("The home network could not be switched.", "error", err)
		t.a.Setup()
	}
}

func (t *Tray) log() *slog.Logger {
	if t.a.Log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return t.a.Log
}
