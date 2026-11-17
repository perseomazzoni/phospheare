// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package logs

import (
	"net/netip"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// The placeholders a removed value leaves, so a reader sees where it was.
const (
	AsAddress  = "[address]"
	AsEmail    = "[email]"
	AsName     = "[name]"
	AsHome     = "[home]"
	AsUser     = "[user]"
	AsComputer = "[computer]"
	AsSecret   = "[secret]"
)

// Known is a personal value the program knows, such as the home folder or
// the home network's name, and the placeholder it leaves.
type Known struct {
	Value, As string
	// Word matches the value only as a whole word, for a short value such
	// as a user name that can sit inside other words.
	Word bool
}

// minWord is the shortest whole-word value removed: a shorter one would
// cut ordinary words out of every line.
const minWord = 3

// Redactor removes personal data from a finished line. It is the safety
// net behind the call sites, which write no personal value themselves:
// it removes the values Known answers, then the value of every query
// parameter that can carry a secret, every email address, every deSEC name
// and every IP address but loopback, as the browser's log does
// (`web/src/log/domain/redact.ts`).
type Redactor struct {
	// Known answers the values the program knows now; it may be nil.
	Known func() []Known

	mu    sync.Mutex
	key   string
	known []knownRE
}

type knownRE struct {
	re *regexp.Regexp
	as string
	// word keeps only the matches that stand as whole words.
	word bool
}

// replace answers line with each match of k replaced. For a whole-word
// value, a match with a letter, a digit or an underscore on either side is
// part of another word and stays. The check is by rune, so a name that
// starts or ends with an accented letter, as "José" does, is matched too;
// RE2's \b knows only ASCII letters.
func (k knownRE) replace(line string) string {
	if !k.word {
		return k.re.ReplaceAllLiteralString(line, k.as)
	}
	var out strings.Builder
	last := 0
	for _, m := range k.re.FindAllStringIndex(line, -1) {
		before, _ := utf8.DecodeLastRuneInString(line[:m[0]])
		after, _ := utf8.DecodeRuneInString(line[m[1]:])
		if m[0] > 0 && wordRune(before) || m[1] < len(line) && wordRune(after) {
			continue
		}
		out.WriteString(line[last:m[0]])
		out.WriteString(k.as)
		last = m[1]
	}
	out.WriteString(line[last:])
	return out.String()
}

func wordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}

var (
	// The value of a query parameter that can carry a secret.
	secretParamRE = regexp.MustCompile(`(?i)([?&#](?:code|state|token|access_token|id_token|refresh_token|key|k)=)[^&#\s"]+`)
	emailRE       = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`)
	// deSEC's free names, which the home network uses.
	dedynRE = regexp.MustCompile(`(?i)\b(?:[a-z0-9_-]+\.)+dedyn\.io\b`)
	ipv4RE  = regexp.MustCompile(`\b\d{1,3}(?:\.\d{1,3}){3}\b`)
	// A run of hex groups and colons, with an optional zone; what parses
	// as an address is one, what does not (a time) stays.
	ipv6RE = regexp.MustCompile(`[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?:%[0-9A-Za-z._-]+)?`)
)

// Line answers line with every personal value replaced.
func (r *Redactor) Line(line string) string {
	for _, k := range r.compiled() {
		line = k.replace(line)
	}
	line = secretParamRE.ReplaceAllString(line, "${1}"+AsSecret)
	line = emailRE.ReplaceAllLiteralString(line, AsEmail)
	line = dedynRE.ReplaceAllLiteralString(line, AsName)
	line = ipv4(line)
	return ipv6RE.ReplaceAllStringFunc(line, address)
}

// ipv4 answers line with each IPv4 address replaced. Four numbers after a
// product's name and a slash are its version, as a user agent writes
// "Chrome/131.0.0.0", and stay. RE2 has no look-behind, so the two bytes
// before each match are read here.
func ipv4(line string) string {
	var out strings.Builder
	last := 0
	for _, m := range ipv4RE.FindAllStringIndex(line, -1) {
		if m[0] >= 2 && line[m[0]-1] == '/' && isASCIILetter(line[m[0]-2]) {
			continue
		}
		out.WriteString(line[last:m[0]])
		out.WriteString(address(line[m[0]:m[1]]))
		last = m[1]
	}
	out.WriteString(line[last:])
	return out.String()
}

func isASCIILetter(b byte) bool {
	return 'a' <= b && b <= 'z' || 'A' <= b && b <= 'Z'
}

// address replaces s when it is an IP address other than loopback or the
// unspecified address, which name no person's device.
func address(s string) string {
	a, err := netip.ParseAddr(s)
	if err != nil {
		return s
	}
	if a = a.Unmap(); a.IsLoopback() || a.IsUnspecified() {
		return s
	}
	return AsAddress
}

// compiled answers the expressions for the values Known answers now,
// longest first so a home folder goes before the user name inside it.
func (r *Redactor) compiled() []knownRE {
	if r == nil || r.Known == nil {
		return nil
	}
	var list []Known
	for _, k := range r.Known() {
		k.Value = strings.TrimSpace(k.Value)
		if k.Value == "" || k.Word && len(k.Value) < minWord {
			continue
		}
		list = append(list, k)
		// A field that holds a space is quoted, which doubles each
		// backslash of a Windows path; the quoted form goes too.
		if q := strconv.Quote(k.Value); q[1:len(q)-1] != k.Value {
			list = append(list, Known{Value: q[1 : len(q)-1], As: k.As, Word: k.Word})
		}
	}
	slices.SortFunc(list, func(a, b Known) int { return len(b.Value) - len(a.Value) })
	var key strings.Builder
	for _, k := range list {
		key.WriteString(k.Value + "\x00" + k.As + "\x00")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if key.String() == r.key && r.known != nil {
		return r.known
	}
	known := make([]knownRE, 0, len(list))
	for _, k := range list {
		re := regexp.MustCompile(`(?i)` + regexp.QuoteMeta(k.Value))
		known = append(known, knownRE{re: re, as: k.As, word: k.Word})
	}
	r.key, r.known = key.String(), known
	return known
}
