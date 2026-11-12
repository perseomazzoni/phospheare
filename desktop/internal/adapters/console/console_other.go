// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !windows

package console

import "os"

// toFile is unset: the program runs in a terminal.
const toFile = false

func usable(*os.File) bool { return true }

func messageBox(string, string) {}
