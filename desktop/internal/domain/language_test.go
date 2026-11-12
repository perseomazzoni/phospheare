// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import "testing"

func TestLanguageFollowsTheChoiceThenTheSystem(t *testing.T) {
	for _, c := range []struct{ chosen, system, want string }{
		{"", "it-IT", "it"},
		{"", "it_IT.UTF-8", "it"},
		{"", "IT", "it"},
		{"", "de-DE", "en"},
		{"", "", "en"},
		{"", "C", "en"},
		{"en", "it-IT", "en"},
		{"it", "en-US", "it"},
		{"fr", "it-IT", "it"},
	} {
		if got := Language(c.chosen, c.system); got != c.want {
			t.Errorf("Language(%q, %q) = %q, want %q", c.chosen, c.system, got, c.want)
		}
	}
}
