// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !windows && !darwin && !linux

package vault

import "errors"

func system(string) (systemStore, error) {
	return nil, errors.New("this system has no password store the program can use")
}
