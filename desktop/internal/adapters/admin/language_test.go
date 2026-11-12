// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package admin

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/words"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// pageWords answers the texts the rendered page carries for its script.
func pageWords(t *testing.T, html string) map[string]string {
	t.Helper()
	m := regexp.MustCompile(`(?s)<script type="application/json" id="words">(.*?)</script>`).FindStringSubmatch(html)
	if m == nil {
		t.Fatal("the page carries no texts for its script")
	}
	var out map[string]string
	if err := json.Unmarshal([]byte(m[1]), &out); err != nil {
		t.Fatalf("the script's texts: %v", err)
	}
	return out
}

func TestThePageFollowsTheSystemLanguageUntilOneIsChosen(t *testing.T) {
	f := newFixture(t)
	f.a.SystemLanguage = "it_IT.UTF-8"
	html := f.call(http.MethodGet, "/desktop/setup/", nil).Body.String()
	if !strings.Contains(html, `<html lang="it">`) || !strings.Contains(html, "Altre impostazioni") {
		t.Fatal("the page is not in the system's language")
	}
	if !strings.Contains(html, `<option value="" selected>Lingua del sistema (Italiano)</option>`) {
		t.Fatal("the language list does not show the system's language as chosen")
	}
	if pageWords(t, html)["title"] != "Impostazioni di {product}" {
		t.Fatal("the script's texts are not in the system's language")
	}

	if rec := f.call(http.MethodPut, "/desktop/setup/api/language", map[string]string{"language": "en"}); rec.Code != http.StatusNoContent {
		t.Fatalf("choose en: %d %s", rec.Code, rec.Body.String())
	}
	if f.a.Config.Get().Language != "en" {
		t.Fatal("the choice was not saved")
	}
	html = f.call(http.MethodGet, "/desktop/setup/", nil).Body.String()
	if !strings.Contains(html, `<html lang="en">`) || !strings.Contains(html, `<option value="en" selected>English</option>`) {
		t.Fatal("the chosen language is not shown")
	}

	if rec := f.call(http.MethodPut, "/desktop/setup/api/language", map[string]string{"language": ""}); rec.Code != http.StatusNoContent {
		t.Fatalf("back to the system's: %d", rec.Code)
	}
	if html = f.call(http.MethodGet, "/desktop/setup/", nil).Body.String(); !strings.Contains(html, `<html lang="it">`) {
		t.Fatal("clearing the choice does not follow the system again")
	}
}

func TestTheLanguageMustBeOneListed(t *testing.T) {
	f := newFixture(t)
	rec := f.call(http.MethodPut, "/desktop/setup/api/language", map[string]string{"language": "fr"})
	if rec.Code != http.StatusBadRequest || f.a.Config.Get().Language != "" {
		t.Fatalf("an unknown language: %d %q", rec.Code, f.a.Config.Get().Language)
	}
	if rec := f.call(http.MethodPut, "/desktop/setup/api/language", map[string]string{"language": "it"}, KeyHeader, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("a choice without the key: %d", rec.Code)
	}
}

func TestTheAPIAnswersInTheChosenLanguage(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPut, "/desktop/setup/api/language", map[string]string{"language": "it"})
	rec := f.call(http.MethodPost, "/desktop/setup/api/quit", nil, KeyHeader, "wrong")
	if got := body(t, rec)["title"]; !strings.HasPrefix(got.(string), "Da questa pagina non puoi cambiare") {
		t.Fatalf("a refusal in Italian: %q", got)
	}
}

// The product's name is escaped into the page's markup.
func TestThePageEscapesTheProductName(t *testing.T) {
	f := newFixture(t)
	f.a.ProductName = `<b>&P`
	html := f.call(http.MethodGet, "/desktop/setup/", nil).Body.String()
	if strings.Contains(html, "<b>&P") || !strings.Contains(html, "&lt;b&gt;&amp;P") {
		t.Fatal("the product's name reached the page unescaped")
	}
}

var (
	pageKey = regexp.MustCompile(`\{\{\.(?:T|Plain) "([\w.]+)"\}\}`)
	// A script key is named in a call of w, or as a dotted literal handed to
	// it later; `setup.` names the values the tab keeps.
	scriptKey = regexp.MustCompile(`\bw\("(\w+)"|"([a-z]\w*(?:\.\w+)+)"`)
)

// Every text the page and its script name exists, in every language, and
// the script has no text it never names.
func TestEveryKeyThePageNamesHasATextInEveryLanguage(t *testing.T) {
	tpl, _ := static.ReadFile("static/index.html")
	js, _ := static.ReadFile("static/admin.js")
	pageKeys := pageKey.FindAllStringSubmatch(string(tpl), -1)
	scriptKeys := scriptKey.FindAllStringSubmatch(string(js), -1)
	if len(pageKeys) < 100 || len(scriptKeys) < 100 {
		t.Fatalf("found %d page keys and %d script keys", len(pageKeys), len(scriptKeys))
	}
	for _, lang := range domain.Languages {
		w := words.For(lang, "P")
		for _, k := range pageKeys {
			if !w.Has(k[1]) {
				t.Errorf("%s: the page names %q, which has no text", lang, k[1])
			}
		}
		named := map[string]bool{}
		for _, k := range scriptKeys {
			key := k[1] + k[2]
			if strings.HasPrefix(key, "setup.") {
				continue
			}
			named[key] = true
			if !w.Has("script." + key) {
				t.Errorf("%s: admin.js names %q, which has no text", lang, key)
			}
		}
		for key := range w.Raw("script.") {
			if !named[key] {
				t.Errorf("%s: script.%s is named nowhere in admin.js", lang, key)
			}
		}
	}
}

func TestThePageSaysWhereTheSecretsAreKept(t *testing.T) {
	for _, lang := range domain.Languages {
		w := words.For(lang, "P")
		for _, key := range []string{"page.secrets.windows", "page.secrets.darwin", "page.secrets.linux", "page.secrets.file"} {
			if !w.Has(key) {
				t.Errorf("%s: no text for %s", lang, key)
			}
		}
	}
	if got := secretsKey(domain.SecretsInFile); got != "page.secrets.file" {
		t.Fatalf("file: %s", got)
	}
	f := newFixture(t)
	html := f.call(http.MethodGet, "/desktop/setup/", nil).Body.String()
	if !strings.Contains(html, "only your user account can open") {
		t.Fatal("the page does not say where the secrets are kept")
	}
}
