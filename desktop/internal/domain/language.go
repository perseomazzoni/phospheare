// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import "strings"

// Languages are the languages the setup page and the tray menu are written
// in. The first is the one shown when the system's language is none of them.
var Languages = []string{"en", "it"}

// KnownLanguage answers whether lang is one of Languages.
func KnownLanguage(lang string) bool {
	for _, l := range Languages {
		if l == lang {
			return true
		}
	}
	return false
}

// Language answers the language to show: chosen when it is one of
// Languages, otherwise the system's when it is one, otherwise the first.
// system is a locale as the system writes it, such as "it-IT" or
// "it_IT.UTF-8".
func Language(chosen, system string) string {
	if KnownLanguage(chosen) {
		return chosen
	}
	base := strings.ToLower(system)
	if i := strings.IndexAny(base, "-_.@"); i >= 0 {
		base = base[:i]
	}
	if KnownLanguage(base) {
		return base
	}
	return Languages[0]
}
