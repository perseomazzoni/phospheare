// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import "testing"

func TestNewer(t *testing.T) {
	cases := []struct {
		latest, current string
		newer, known    bool
	}{
		{"v1.4.0", "1.3.9", true, true},
		{"v1.3.0", "v1.3.0", false, true},
		{"v1.2.0", "1.10.0", false, true},
		{"v2.0.0-rc.1", "1.9.9", true, true},
		{"v1.0.0", "dev", false, false},
		// A pre-release sorts below its final release.
		{"v1.3.0", "1.3.0-rc.2", true, true},
		{"v1.3.0-rc.2", "1.3.0", false, true},
		{"v1.3.0-rc.2", "1.3.0-rc.1", true, true},
		{"v1.3.0-rc.10", "1.3.0-rc.9", true, true},
		{"v1.3.0-rc.1", "1.3.0-beta.4", true, true},
		{"v1.3.0-rc.1.1", "1.3.0-rc.1", true, true},
		{"v1.3.0-1", "1.3.0-alpha", false, true},
		{"v1.3.0+build.5", "1.3.0", false, true},
		{"v1.3.0-", "1.2.0", false, false},
	}
	for _, c := range cases {
		if n, k := Newer(c.latest, c.current); n != c.newer || k != c.known {
			t.Fatalf("Newer(%s, %s) = %v %v", c.latest, c.current, n, k)
		}
	}
}
