// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package browser

import (
	"strings"
	"testing"
)

func TestCommand(t *testing.T) {
	const u = "http://localhost:47821/app"
	for goos, want := range map[string]string{
		"windows": "rundll32 url.dll,FileProtocolHandler " + u,
		"darwin":  "open " + u,
		"linux":   "xdg-open " + u,
	} {
		name, args := Command(goos, u)
		if got := name + " " + strings.Join(args, " "); got != want {
			t.Fatalf("%s: %q", goos, got)
		}
	}
}
