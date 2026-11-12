// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"strconv"
	"strings"
)

// Newer reports whether release tag latest is newer than current. known is
// false when either is not a `major.minor.patch` version, as for a
// development build. A pre-release (`1.2.0-rc.1`) sorts below its final
// release, so a copy running it is told when the release is out.
func Newer(latest, current string) (newer, known bool) {
	l, ok1 := parse(latest)
	c, ok2 := parse(current)
	if !ok1 || !ok2 {
		return false, false
	}
	for i := range l.core {
		if l.core[i] != c.core[i] {
			return l.core[i] > c.core[i], true
		}
	}
	return comparePre(l.pre, c.pre) > 0, true
}

type version struct {
	core [3]int
	// pre is the pre-release's dot-separated identifiers, empty for a
	// release.
	pre []string
}

func parse(v string) (version, bool) {
	var out version
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexByte(v, '+'); i >= 0 {
		v = v[:i]
	}
	if i := strings.IndexByte(v, '-'); i >= 0 {
		if i == len(v)-1 {
			return out, false
		}
		out.pre = strings.Split(v[i+1:], ".")
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false
		}
		out.core[i] = n
	}
	return out, true
}

// comparePre orders two pre-releases of the same version as Semantic
// Versioning does: none is above any; otherwise identifier by identifier,
// numbers by value and below words, which compare as text, and a shorter
// list below a longer one it begins.
func comparePre(a, b []string) int {
	switch {
	case len(a) == 0 && len(b) == 0:
		return 0
	case len(a) == 0:
		return 1
	case len(b) == 0:
		return -1
	}
	for i := 0; i < len(a) && i < len(b); i++ {
		x, xErr := strconv.Atoi(a[i])
		y, yErr := strconv.Atoi(b[i])
		switch {
		case xErr == nil && yErr == nil:
			if x != y {
				return compareInt(x, y)
			}
		case xErr == nil:
			return -1
		case yErr == nil:
			return 1
		default:
			if c := strings.Compare(a[i], b[i]); c != 0 {
				return c
			}
		}
	}
	return compareInt(len(a), len(b))
}

func compareInt(x, y int) int {
	switch {
	case x < y:
		return -1
	case x > y:
		return 1
	}
	return 0
}
