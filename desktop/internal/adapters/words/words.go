// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package words holds the text of the desktop program's own interface, the
// setup page, its API's messages and the tray menu, with one file per
// language of domain.Languages. Every file has the keys `en.json` has; a
// test fails the build otherwise. A text names a value as `{name}`, and
// the product's name as `{product}`. A page text may hold markup, so a
// value put into one is escaped by the caller.
package words

import (
	"embed"
	"encoding/json"
	"strings"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

//go:embed *.json
var files embed.FS

var tables = func() map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, lang := range domain.Languages {
		raw, err := files.ReadFile(lang + ".json")
		if err != nil {
			panic("words: " + lang + ".json is missing")
		}
		t := map[string]string{}
		if err := json.Unmarshal(raw, &t); err != nil {
			panic("words: " + lang + ".json: " + err.Error())
		}
		out[lang] = t
	}
	return out
}()

// Words is one language's text, with the product's name.
type Words struct {
	lang    string
	product string
}

// For answers lang's text, or the first language's when lang is unknown.
func For(lang, product string) Words {
	if _, ok := tables[lang]; !ok {
		lang = domain.Languages[0]
	}
	return Words{lang: lang, product: product}
}

// Lang answers the language, one of domain.Languages.
func (w Words) Lang() string { return w.lang }

// T answers key's text with its values filled in: pairs alternate a name
// and its value, and `{product}` is the product's name unless pairs give
// it. A key no file has answers itself.
func (w Words) T(key string, pairs ...string) string {
	text, ok := tables[w.lang][key]
	if !ok {
		return key
	}
	args := make([]string, 0, len(pairs)+2)
	for i := 0; i+1 < len(pairs); i += 2 {
		args = append(args, "{"+pairs[i]+"}", pairs[i+1])
	}
	args = append(args, "{product}", w.product)
	return strings.NewReplacer(args...).Replace(text)
}

// Has answers whether key has a text.
func (w Words) Has(key string) bool {
	_, ok := tables[w.lang][key]
	return ok
}

// Raw answers every text whose key starts with prefix, keyed by the rest
// of the key, with nothing filled in.
func (w Words) Raw(prefix string) map[string]string {
	out := map[string]string{}
	for k, v := range tables[w.lang] {
		if rest, ok := strings.CutPrefix(k, prefix); ok {
			out[rest] = v
		}
	}
	return out
}
