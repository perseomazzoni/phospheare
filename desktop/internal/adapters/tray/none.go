// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !windows && !linux

package tray

// Available is false: on macOS the menu bar needs cgo and an app bundle,
// which this build has neither of, so the program keeps its terminal.
func Available() bool { return false }

// Run calls body: there is no tray to show.
func Run(_ Actions, body func()) { body() }
