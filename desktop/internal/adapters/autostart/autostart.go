// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package autostart registers the host to start when the user logs in, with
// `--no-browser` so a login does not open a window, and the arguments the
// running copy was given that decide where it runs, such as its port and
// data folder. Each operating system has its own per-user mechanism, and
// none needs administrator rights.
package autostart

import (
	"sync"

	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// Name is the entry's name in the operating system's login list.
const Name = "once-dark-studio-desktop"

// System is the operating system's login list.
type System struct{}

// Enable registers exe to start at login with args.
func (System) Enable(exe string, args []string) error { return enable(exe, args) }

// Disable removes the registration.
func (System) Disable() error { return disable() }

// Enabled reports whether a registration exists.
func (System) Enabled() (bool, error) { return enabled() }

// Remembered is a login list that keeps its last reading, for the tray,
// which asks on every refresh. A failed reading is not kept, so a one-off
// failure leaves the next Last to read again rather than the tray unticked
// until a change.
type Remembered struct {
	List ports.Autostart

	mu    sync.Mutex
	known bool
	on    bool
}

var _ ports.Autostart = (*Remembered)(nil)

// Enable registers exe to start at login with args and drops the kept
// reading, so the reading after a change is fresh.
func (r *Remembered) Enable(exe string, args []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.known = false
	return r.List.Enable(exe, args)
}

// Disable removes the registration and drops the kept reading.
func (r *Remembered) Disable() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.known = false
	return r.List.Disable()
}

// Enabled reads the list and keeps the answer.
func (r *Remembered) Enabled() (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.read()
}

// Last answers the kept reading, reading the list when none is kept.
func (r *Remembered) Last() (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.known {
		return r.on, nil
	}
	return r.read()
}

func (r *Remembered) read() (bool, error) {
	on, err := r.List.Enabled()
	r.on, r.known = on, err == nil
	return on, err
}
