// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !windows

package identityproc

import "os/exec"

// adopt has nothing to do outside Windows: prepare already ties the child's
// life to the desktop's where the system allows it.
func adopt(*exec.Cmd) error { return nil }
