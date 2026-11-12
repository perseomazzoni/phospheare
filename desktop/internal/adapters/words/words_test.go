// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package words

import (
	"regexp"
	"slices"
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

var (
	placeholder = regexp.MustCompile(`\{\w+\}`)
	tag         = regexp.MustCompile(`</?\w+`)
)

// Every language has every key of the first, and no other; each text names
// the same values and opens the same tags as the first language's.
func TestEveryLanguageHasTheSameTexts(t *testing.T) {
	base := tables[domain.Languages[0]]
	for _, lang := range domain.Languages[1:] {
		other := tables[lang]
		for k, v := range base {
			o, ok := other[k]
			if !ok {
				t.Errorf("%s.json lacks %q", lang, k)
				continue
			}
			if o == "" {
				t.Errorf("%s.json: %q is empty", lang, k)
			}
			if !sameSet(placeholder.FindAllString(v, -1), placeholder.FindAllString(o, -1)) {
				t.Errorf("%s.json: %q names other values than %s.json", lang, k, domain.Languages[0])
			}
			if !sameSet(tag.FindAllString(v, -1), tag.FindAllString(o, -1)) {
				t.Errorf("%s.json: %q has other markup than %s.json", lang, k, domain.Languages[0])
			}
		}
		for k := range other {
			if _, ok := base[k]; !ok {
				t.Errorf("%s.json has %q, which %s.json lacks", lang, k, domain.Languages[0])
			}
		}
	}
}

func sameSet(a, b []string) bool {
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(slices.Compact(a), slices.Compact(b))
}

func TestTFillsValuesAndTheProduct(t *testing.T) {
	w := For("en", "Phospheare")
	if got := w.T("tray.on", "url", "https://x.dedyn.io"); got != "Home network: on at https://x.dedyn.io" {
		t.Fatalf("tray.on: %q", got)
	}
	if got := w.T("tray.quit"); got != "Quit Phospheare" {
		t.Fatalf("tray.quit: %q", got)
	}
	if got := w.T("tray.quit", "product", "&lt;P&gt;"); got != "Quit &lt;P&gt;" {
		t.Fatalf("a given product: %q", got)
	}
	if got := w.T("no.such.key"); got != "no.such.key" {
		t.Fatalf("missing key: %q", got)
	}
}

func TestForFallsBackToTheFirstLanguage(t *testing.T) {
	if got := For("fr", "P").Lang(); got != domain.Languages[0] {
		t.Fatalf("For(fr) = %q", got)
	}
	if got := For("it", "P").T("tray.quit"); got != "Esci da P" {
		t.Fatalf("it tray.quit: %q", got)
	}
}

func TestRawKeepsThePlaceholders(t *testing.T) {
	raw := For("en", "P").Raw("script.")
	if raw["title"] != "{product} settings" {
		t.Fatalf("script.title: %q", raw["title"])
	}
	if _, ok := raw["tray.quit"]; ok {
		t.Fatal("Raw kept a key outside its prefix")
	}
}
