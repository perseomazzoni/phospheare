// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package locale reads the language the system shows its own interface in,
// which the setup page and the tray menu follow until a language is chosen.
package locale

import (
	"regexp"
	"strings"
)

// System answers the system's interface language as the system writes it,
// such as "it-IT" or "it_IT.UTF-8", or "" when it cannot tell.
func System() string { return system() }

// fromEnv answers the locale the POSIX variables name, in the order a
// program's messages follow them. "C" and "POSIX" name no language.
func fromEnv(getenv func(string) string) string {
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		v := getenv(k)
		if v == "" || v == "C" || v == "POSIX" || strings.HasPrefix(v, "C.") {
			continue
		}
		return v
	}
	return ""
}

var quoted = regexp.MustCompile(`"([^"]+)"|([A-Za-z]{2}[-_][A-Za-z0-9]+)`)

// firstAppleLanguage answers the first language of the list that
// `defaults read -g AppleLanguages` prints, such as `("it-IT", "en-US")`.
func firstAppleLanguage(out string) string {
	m := quoted.FindStringSubmatch(out)
	if m == nil {
		return ""
	}
	if m[1] != "" {
		return m[1]
	}
	return m[2]
}
