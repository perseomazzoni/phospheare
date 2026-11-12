// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package locale

import "testing"

func TestFromEnvSkipsTheLocalesThatNameNoLanguage(t *testing.T) {
	for _, c := range []struct {
		env  map[string]string
		want string
	}{
		{map[string]string{"LANG": "it_IT.UTF-8"}, "it_IT.UTF-8"},
		{map[string]string{"LC_ALL": "C", "LANG": "it_IT.UTF-8"}, "it_IT.UTF-8"},
		{map[string]string{"LC_ALL": "C.UTF-8", "LC_MESSAGES": "en_GB.UTF-8"}, "en_GB.UTF-8"},
		{map[string]string{"LC_ALL": "de_DE", "LANG": "it_IT"}, "de_DE"},
		{map[string]string{"LANG": "POSIX"}, ""},
		{map[string]string{}, ""},
	} {
		if got := fromEnv(func(k string) string { return c.env[k] }); got != c.want {
			t.Errorf("fromEnv(%v) = %q, want %q", c.env, got, c.want)
		}
	}
}

func TestFirstAppleLanguageReadsTheDefaultsList(t *testing.T) {
	for out, want := range map[string]string{
		"(\n    \"it-IT\",\n    \"en-US\"\n)\n": "it-IT",
		"(\n    \"en-GB\"\n)\n":                 "en-GB",
		"(\n    it-IT,\n    en-US\n)\n":         "it-IT",
		"":                                      "",
	} {
		if got := firstAppleLanguage(out); got != want {
			t.Errorf("firstAppleLanguage(%q) = %q, want %q", out, got, want)
		}
	}
}
