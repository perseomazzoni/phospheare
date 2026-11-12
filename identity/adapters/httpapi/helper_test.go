// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins the `/identity/` contract of `docs/identity-contract.md` against a fake
// Google token endpoint: sessions, both flow purposes, the refusals that
// keep a grant from attaching to the wrong writer, refresh and revocation.
package httpapi_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/seal"
	"github.com/perseomazzoni/phospheare/identity/domain"
)

// ── Sessions ─────────────────────────────────────────────────────────────────

func TestSessionOpensWithSealedHttpOnlyStrictCookie(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	c := b.lastSet["phospheare_session"]
	if c == nil || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/identity" || c.MaxAge != 30*24*3600 || c.Secure {
		t.Fatalf("session cookie %+v", c)
	}
	if strings.Contains(c.Value, "writer-a") {
		t.Fatal("the session cookie is not sealed")
	}
	rec := b.request(http.MethodGet, "/identity/session", nil)
	if rec.Code != http.StatusOK || decode(t, rec)["writerId"] != "writer-a" {
		t.Fatalf("get session: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSessionReopenForSameWriterKeepsSid(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	first := b.cookies["phospheare_session"]
	delete(b.lastSet, "phospheare_session")
	b.openSession("writer-a")
	if _, set := b.lastSet["phospheare_session"]; set || b.cookies["phospheare_session"] != first {
		t.Fatal("reopening for the same writer changed the session")
	}
	b.openSession("writer-b")
	if b.cookies["phospheare_session"] == first {
		t.Fatal("another writer kept the old session")
	}
}

func TestSessionReopenKeepsAnotherTabsFlow(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	b.openSession("writer-a")
	e.consent(b, q, "code-1", grant{sub: "sub-a", email: "a@example.test", scope: "openid email profile"})
	rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish after same-writer reopen: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSessionCloseClearsCookie(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	rec := b.request(http.MethodDelete, "/identity/session", nil)
	if rec.Code != http.StatusNoContent || b.lastSet["phospheare_session"].MaxAge >= 0 {
		t.Fatalf("close: %d %+v", rec.Code, b.lastSet["phospheare_session"])
	}
	expectNoSession(t, b.request(http.MethodGet, "/identity/session", nil))
}

func TestSessionRefusesMalformedWriterID(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	for _, id := range []string{"", "has space", strings.Repeat("x", 129)} {
		expectProblem(t, b.request(http.MethodPost, "/identity/session", map[string]string{"writerId": id}), http.StatusBadRequest, "bad-request")
	}
}

func TestSessionFromAnotherKeyIsNoSession(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	other, err := seal.New(bytes.Repeat([]byte{8}, 32))
	if err != nil {
		t.Fatal(err)
	}
	h := *e.host
	h.Sealer = other
	b.h = h.Handler(e.l)
	expectNoSession(t, b.request(http.MethodGet, "/identity/session", nil))
}

// ── Identity flow ────────────────────────────────────────────────────────────

func TestIdentityFlow(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a", "loginHint": "a@example.test"})

	if q.Get("client_id") != testClientID || q.Get("response_type") != "code" || q.Get("scope") != "openid email profile" ||
		q.Get("code_challenge_method") != "S256" || len(q.Get("code_challenge")) != 43 || q.Get("nonce") == "" ||
		q.Get("state") == "" || q.Get("include_granted_scopes") != "true" || q.Get("login_hint") != "a@example.test" ||
		q.Get("redirect_uri") != localOrigin+"/identity/google/callback" || q.Has("access_type") || q.Get("prompt") != "select_account" {
		t.Fatalf("authorize query %v", q)
	}
	flowName := "phospheare_flow_" + flowID
	fc := b.lastSet[flowName]
	if fc == nil || !fc.HttpOnly || fc.SameSite != http.SameSiteLaxMode || fc.Path != "/identity/google" || fc.MaxAge != 600 || fc.Secure {
		t.Fatalf("flow cookie %+v", fc)
	}
	if strings.Contains(fc.Value, flowID) || strings.Contains(fc.Value, q.Get("nonce")) {
		t.Fatal("the flow cookie is not sealed")
	}

	page := e.consent(b, q, "secret-code-1", grant{sub: "sub-a", email: "a@example.test", scope: "openid email profile"})
	body := page.Body.String()
	if page.Code != http.StatusOK || !strings.Contains(body, `data-flow="`+flowID+`"`) || !strings.Contains(body, `data-status="done"`) {
		t.Fatalf("callback page: %d %s", page.Code, body)
	}
	if strings.Contains(body, "secret-code-1") || strings.Contains(body, "access-") || strings.Contains(body, "refresh-") {
		t.Fatal("the callback page carries a code or a token")
	}
	csp := page.Header().Get("Content-Security-Policy")
	script := regexp.MustCompile(`(?s)<script>(.*)</script>`).FindStringSubmatch(body)[1]
	sum := sha256.Sum256([]byte(script))
	if !strings.Contains(csp, "script-src 'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'") || !strings.Contains(csp, "default-src 'none'") {
		t.Fatalf("callback CSP %q does not pin the script", csp)
	}
	if page.Header().Get("Cross-Origin-Opener-Policy") != "" {
		t.Fatal("the callback page sets COOP")
	}
	if c := b.lastSet[flowName]; c.MaxAge <= 0 || c.Value == fc.Value {
		t.Fatalf("the callback did not seal its outcome into the flow cookie: %+v", c)
	}

	rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish: %d %s", rec.Code, rec.Body.String())
	}
	id := decode(t, rec)["identity"].(map[string]any)
	want := map[string]any{"iss": "https://accounts.google.com", "sub": "sub-a", "email": "a@example.test",
		"emailVerified": true, "name": "Test Writer", "picture": "https://example.test/p.png"}
	for k, v := range want {
		if id[k] != v {
			t.Fatalf("identity %s = %v, want %v", k, id[k], v)
		}
	}
	for name := range b.cookies {
		if strings.HasPrefix(name, "phospheare_g_") {
			t.Fatal("an identity flow set a connection cookie")
		}
	}
	if b.lastSet[flowName].MaxAge >= 0 || len(b.flowCookies()) != 0 {
		t.Fatal("finish leaves the flow cookie")
	}
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusGone, "flow-expired")
}

func TestIdentityFlowRefusesBadIDTokens(t *testing.T) {
	cases := map[string]grant{
		"audience": {aud: "someone-else.apps.googleusercontent.com"},
		"issuer":   {iss: "https://evil.example.test"},
		"expired":  {exp: time.Now().Add(-10 * time.Minute)},
	}
	for name, gr := range cases {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			b := e.browser()
			b.openSession("writer-a")
			flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
			gr.sub, gr.email, gr.scope = "sub-a", "a@example.test", "openid email profile"
			page := e.consent(b, q, "code", gr)
			if !strings.Contains(page.Body.String(), `data-status="failed"`) {
				t.Fatalf("callback page: %s", page.Body.String())
			}
			expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-failed")
		})
	}
}

func TestIdentityFlowRefusesWrongNonce(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	q.Set("nonce", "another-nonce")
	e.consent(b, q, "code", grant{sub: "sub-a", scope: "openid email profile"})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-failed")
}

func TestIdentityFlowWithExpectedSubRefusesOtherAccount(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a", "expectedSub": "sub-a"})
	e.consent(b, q, "code", grant{sub: "sub-b", scope: "openid email profile"})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "account-mismatch")
}

// ── Flow refusals ────────────────────────────────────────────────────────────

func TestBeginRefusesWithoutSessionOrForAnotherWriter(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "identity", "writerId": "writer-a"}), http.StatusUnauthorized, "no-session")
	b.openSession("writer-a")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "identity", "writerId": "writer-b"}), http.StatusForbidden, "writer-mismatch")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "drive", "writerId": "writer-a"}), http.StatusBadRequest, "bad-request")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "calendar", "writerId": "writer-a"}), http.StatusBadRequest, "bad-request")
}

func TestBeginRefusesWhenGoogleIsNotConfigured(t *testing.T) {
	e := newEnv(t)
	e.client = domain.Credentials{}
	b := e.browser()
	b.openSession("writer-a")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "identity", "writerId": "writer-a"}), http.StatusServiceUnavailable, "google-not-configured")
}

func TestFinishBeforeCallbackIsPendingAndKeepsFlow(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-pending")
	e.consent(b, q, "code", grant{sub: "sub-a", scope: "openid email profile"})
	if rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil); rec.Code != http.StatusOK {
		t.Fatalf("finish: %d %s", rec.Code, rec.Body.String())
	}
}

func TestLateFinishAfterSessionClosedIsSessionMismatch(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	e.consent(b, q, "code", grant{sub: "sub-a", scope: driveScope})
	b.request(http.MethodDelete, "/identity/session", nil)
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-session-mismatch")
	b.openSession("writer-a")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusGone, "flow-expired")
	for name := range b.cookies {
		if strings.HasPrefix(name, "phospheare_g_") {
			t.Fatal("a late finish set a connection cookie")
		}
	}
}

func TestLateFinishAfterWriterChangedIsSessionMismatch(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	e.consent(b, q, "code", grant{sub: "sub-a", scope: driveScope})
	b.openSession("writer-b")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-session-mismatch")
	if len(b.flowCookies()) != 0 {
		t.Fatal("a refused flow keeps its tokens")
	}
}

func TestCallbackInAnotherBrowserSettlesNothing(t *testing.T) {
	e := newEnv(t)
	starter := e.browser()
	starter.openSession("writer-a")
	flowID, q := starter.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	// The redirect lands in another browser, which holds no flow cookie: a
	// login CSRF attempt, or a link opened elsewhere.
	other := e.browser()
	page := e.consent(other, q, "code", grant{sub: "sub-a", scope: "openid email profile"})
	if !strings.Contains(page.Body.String(), `data-status="expired"`) || !strings.Contains(page.Body.String(), `data-flow=""`) {
		t.Fatalf("callback page: %s", page.Body.String())
	}
	if len(other.flowCookies()) != 0 || len(e.google.codes) != 1 {
		t.Fatal("a browser without the flow settled it")
	}
	expectProblem(t, starter.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-pending")
}

func TestCallbackForUnknownStateIsExpired(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	page := b.request(http.MethodGet, "/identity/google/callback?state=nope&code=x", nil)
	if !strings.Contains(page.Body.String(), `data-status="expired"`) {
		t.Fatalf("callback page: %s", page.Body.String())
	}
}

func TestCallbackWithGoogleErrorFailsTheFlow(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	page := b.request(http.MethodGet, "/identity/google/callback?"+url.Values{"state": {q.Get("state")}, "error": {"server_error"}}.Encode(), nil)
	if !strings.Contains(page.Body.String(), `data-status="failed"`) {
		t.Fatalf("callback page: %s", page.Body.String())
	}
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-failed")
}

func TestFinishOfUnknownFlowIsFlowExpired(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/unknown/finish", nil), http.StatusGone, "flow-expired")
}

// ── Stateless flows ──────────────────────────────────────────────────────────

func TestAnyReplicaWithTheKeysAnswers(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	replica := e.replica()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	// Google's redirect reaches another instance; finish returns to the
	// first.
	b.h = replica
	if page := e.consent(b, q, "code", grant{sub: "sub-a", email: "a@example.test", scope: driveScope}); !strings.Contains(page.Body.String(), `data-status="done"`) {
		t.Fatalf("callback on the replica: %s", page.Body.String())
	}
	b.h = e.h
	rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish: %d %s", rec.Code, rec.Body.String())
	}
	id := decode(t, rec)["connection"].(map[string]any)["connectionId"].(string)
	b.h = replica
	if rec := b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}); rec.Code != http.StatusOK {
		t.Fatalf("token on the replica: %d %s", rec.Code, rec.Body.String())
	}
}

func TestExpiredFlowCookieIsFlowExpired(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	// The browser still sends the cookie; the sealed creation time decides.
	e.skew = 10 * time.Minute
	page := e.consent(b, q, "code", grant{sub: "sub-a", scope: "openid email profile"})
	if !strings.Contains(page.Body.String(), `data-status="expired"`) || len(e.google.codes) != 1 {
		t.Fatalf("callback page: %s", page.Body.String())
	}
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusGone, "flow-expired")
	if len(b.flowCookies()) != 0 {
		t.Fatal("an expired flow cookie stays")
	}
}

func TestTwoFlowsInOneBrowserStayApart(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	first, q1 := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	second, q2 := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	if first == second || len(b.flowCookies()) != 2 {
		t.Fatalf("flows %s %s, cookies %v", first, second, b.flowCookies())
	}
	e.consent(b, q2, "code-2", grant{sub: "sub-b", scope: "openid email profile"})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+first+"/finish", nil), http.StatusConflict, "flow-pending")
	e.consent(b, q1, "code-1", grant{sub: "sub-a", scope: "openid email profile"})
	for flowID, sub := range map[string]string{first: "sub-a", second: "sub-b"} {
		rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil)
		if rec.Code != http.StatusOK || decode(t, rec)["identity"].(map[string]any)["sub"] != sub {
			t.Fatalf("finish %s: %d %s", flowID, rec.Code, rec.Body.String())
		}
	}
}

func TestFlowCookieUnderAnotherIDOpensNothing(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	first, _ := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	second, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	// One flow's sealed value copied under the other's name.
	b.cookies["phospheare_flow_"+second] = b.cookies["phospheare_flow_"+first]
	page := e.consent(b, q, "code", grant{sub: "sub-a", scope: "openid email profile"})
	if !strings.Contains(page.Body.String(), `data-status="expired"`) {
		t.Fatalf("callback page: %s", page.Body.String())
	}
}
