// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package locale

import (
	"os"
	"os/exec"
)

// system answers the POSIX variables' locale, and otherwise the first of
// the user's languages in System Settings: a program started at login
// receives no `LANG`.
func system() string {
	if v := fromEnv(os.Getenv); v != "" {
		return v
	}
	out, err := exec.Command("/usr/bin/defaults", "read", "-g", "AppleLanguages").Output()
	if err != nil {
		return ""
	}
	return firstAppleLanguage(string(out))
}
