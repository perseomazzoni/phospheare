// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !linux && !windows

package identityproc

import "os/exec"

// prepare has nothing to set here: macOS offers no parent-death signal, and
// the standard input closing with the desktop stops the child instead.
func prepare(*exec.Cmd) {}
