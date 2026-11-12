// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"bytes"
	"net/http"
	"strings"
	"testing"

	"github.com/perseomazzoni/phospheare/identity/adapters/seal"
	"github.com/perseomazzoni/phospheare/identity/domain"
)

// Pins the kept credentials: a key sealed in its own cookie opens
// only for its writer's session with the proof, never for another writer or
// after the keys are replaced, and never shows up in the logs.

const (
	keyPath  = "/identity/credentials/openrouter.key"
	openPath = keyPath + "/open"
	orKey    = "sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

func keptCookie(writerID string) string {
	return "phospheare_k_" + domain.CredentialSlot(writerID, "openrouter.key")
}

func (b *browser) keep(value string) {
	b.t.Helper()
	if rec := b.request(http.MethodPut, keyPath, map[string]string{"value": value}); rec.Code != http.StatusNoContent {
		b.t.Fatalf("keep: %d %s", rec.Code, rec.Body.String())
	}
}

func TestKeptKeyOpensForItsWriter(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	b.keep(orKey)
	c := b.lastSet[keptCookie("writer-a")]
	if c == nil || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/identity/credentials" {
		t.Fatalf("cookie %+v", c)
	}
	if strings.Contains(c.Value, "sk-or") || strings.Contains(c.Name, "writer-a") {
		t.Fatal("the cookie shows the key or the writer in clear")
	}
	rec := b.request(http.MethodPost, openPath, nil)
	if rec.Code != http.StatusOK || decode(t, rec)["value"] != orKey {
		t.Fatalf("open: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(e.logs.String(), orKey) || strings.Contains(e.logs.String(), c.Value) {
		t.Fatal("the logs carry the key or its cookie")
	}
}

func TestKeptKeyNeedsTheSessionAndItsProof(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	expectProblem(t, b.request(http.MethodPut, keyPath, map[string]string{"value": orKey}), http.StatusUnauthorized, "no-session")
	b.openSession("writer-a")
	b.keep(orKey)
	x := b.thief()
	x.proof = "not-the-proof"
	expectProblem(t, x.request(http.MethodPost, openPath, nil), http.StatusUnauthorized, "no-session")
	expectProblem(t, x.request(http.MethodPut, keyPath, map[string]string{"value": "sk-or-other"}), http.StatusUnauthorized, "no-session")
}

func TestTwoWritersInOneBrowserKeepTheirOwn(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	b.keep(orKey)
	b.openSession("writer-b")
	expectProblem(t, b.request(http.MethodPost, openPath, nil), http.StatusNotFound, "no-credential")
	b.keep("sk-or-b")
	b.openSession("writer-a")
	if got := decode(t, b.request(http.MethodPost, openPath, nil))["value"]; got != orKey {
		t.Fatalf("writer-a opened %v", got)
	}
}

func TestACookieMovedToAnotherWriterOpensNothing(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	b.keep(orKey)
	sealed := b.cookies[keptCookie("writer-a")]
	b.openSession("writer-b")
	b.cookies[keptCookie("writer-b")] = sealed
	expectProblem(t, b.request(http.MethodPost, openPath, nil), http.StatusNotFound, "no-credential")
	if _, kept := b.cookies[keptCookie("writer-b")]; kept {
		t.Fatal("the moved cookie was not cleared")
	}
}

func TestReplacedKeysForgetKeptKeys(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	b.keep(orKey)
	other, err := seal.New(bytes.Repeat([]byte{8}, 32))
	if err != nil {
		t.Fatal(err)
	}
	h := *e.host
	h.Sealer = other
	b.h = h.Handler(e.l)
	b.openSession("writer-a")
	expectProblem(t, b.request(http.MethodPost, openPath, nil), http.StatusNotFound, "no-credential")
	if _, kept := b.cookies[keptCookie("writer-a")]; kept {
		t.Fatal("a cookie under old keys was not cleared")
	}
}

func TestForgetClearsWithoutASession(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	b.keep(orKey)
	b.request(http.MethodDelete, "/identity/session", nil)
	b.proof = ""
	if rec := b.request(http.MethodDelete, keyPath, map[string]string{"writerId": "writer-a"}); rec.Code != http.StatusNoContent {
		t.Fatalf("forget: %d %s", rec.Code, rec.Body.String())
	}
	if _, kept := b.cookies[keptCookie("writer-a")]; kept {
		t.Fatal("forget kept the cookie")
	}
	expectProblem(t, b.request(http.MethodDelete, keyPath, map[string]string{"writerId": "bad writer"}), http.StatusBadRequest, "bad-request")
}

func TestKeptCredentialRefusals(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	for _, value := range []string{"", "has space", "tab\tkey", "città", strings.Repeat("k", 513)} {
		expectProblem(t, b.request(http.MethodPut, keyPath, map[string]string{"value": value}), http.StatusBadRequest, "bad-request")
	}
	b.keep(strings.Repeat("k", 512))
	expectProblem(t, b.request(http.MethodPut, "/identity/credentials/google.token", map[string]string{"value": orKey}), http.StatusNotFound, "not-found")
	expectProblem(t, b.request(http.MethodPost, "/identity/credentials/other/open", nil), http.StatusNotFound, "not-found")
	expectProblem(t, b.request(http.MethodPost, openPath, nil, "Sec-Fetch-Site", "cross-site"), http.StatusForbidden, "csrf-refused")
	expectProblem(t, b.request(http.MethodPut, keyPath, map[string]string{"value": orKey}, "Origin", "https://evil.example"), http.StatusForbidden, "csrf-refused")
}
