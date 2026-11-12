// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"net/http"
	"strings"
	"testing"
)

func connectionCookie(t *testing.T, b *browser, id string) *http.Cookie {
	t.Helper()
	c := b.lastSet["phospheare_g_"+id]
	if c == nil {
		t.Fatalf("no phospheare_g_%s cookie", id)
	}
	return c
}

func TestDriveFlowSealsRefreshTokenIntoConnectionCookie(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	scopes := strings.Fields(q.Get("scope"))
	want := []string{"openid", "email", "profile", "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.appdata"}
	if strings.Join(scopes, " ") != strings.Join(want, " ") || q.Get("access_type") != "offline" || q.Get("prompt") != "consent" || q.Get("include_granted_scopes") != "true" {
		t.Fatalf("authorize query %v", q)
	}
	e.consent(b, q, "code", grant{sub: "sub-a", email: "a@example.test", scope: driveScope})
	rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("finish: %d %s", rec.Code, rec.Body.String())
	}
	out := decode(t, rec)
	conn := out["connection"].(map[string]any)
	id := conn["connectionId"].(string)
	if len(id) < 22 || conn["sub"] != "sub-a" || conn["email"] != "a@example.test" || len(conn["scopes"].([]any)) != 5 {
		t.Fatalf("connection %v", conn)
	}
	if out["accessToken"] != "access-sub-a" || out["expiresIn"].(float64) != 3599 {
		t.Fatalf("finish %v", out)
	}
	if strings.Contains(rec.Body.String(), "refresh-") {
		t.Fatal("finish answers the refresh token")
	}
	c := connectionCookie(t, b, id)
	if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/identity/google" || c.MaxAge != 400*24*3600 {
		t.Fatalf("connection cookie %+v", c)
	}
	if strings.Contains(c.Value, "refresh-") || strings.Contains(c.Value, "sub-a") {
		t.Fatal("the connection cookie is not sealed")
	}
}

func TestDriveFlowAccountMismatchStoresNothing(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	page := e.consent(b, q, "code", grant{sub: "sub-other", email: "other@example.test", scope: driveScope})
	if !strings.Contains(page.Body.String(), `data-status="failed"`) {
		t.Fatalf("callback page: %s", page.Body.String())
	}
	rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil)
	expectProblem(t, rec, http.StatusConflict, "account-mismatch")
	for _, c := range rec.Result().Cookies() {
		if strings.HasPrefix(c.Name, "phospheare_g_") {
			t.Fatal("an account mismatch set a connection cookie")
		}
	}
	if len(b.flowCookies()) != 0 {
		t.Fatal("the refused flow stays in the browser")
	}
}

func TestDriveFlowScopeMissing(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	e.consent(b, q, "code", grant{sub: "sub-a", scope: "openid email profile https://www.googleapis.com/auth/drive.file"})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "scope-missing")
}

func TestDriveFlowWithoutRefreshTokenFails(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	e.consent(b, q, "code", grant{sub: "sub-a", scope: driveScope, noRefresh: true})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-failed")
}

// ── Token refresh ────────────────────────────────────────────────────────────

func TestTokenRefresh(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	delete(b.lastSet, "phospheare_g_"+id)
	rec := b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id})
	if rec.Code != http.StatusOK {
		t.Fatalf("token: %d %s", rec.Code, rec.Body.String())
	}
	out := decode(t, rec)
	if out["accessToken"] != "access-refreshed-sub-a" || out["expiresIn"].(float64) != 3599 || !strings.Contains(out["scope"].(string), "drive.appdata") {
		t.Fatalf("token %v", out)
	}
	if _, reset := b.lastSet["phospheare_g_"+id]; reset {
		t.Fatal("a refresh without a new refresh token reset the cookie")
	}
}

func TestTokenRefreshResealsRotatedRefreshToken(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	before := b.cookies["phospheare_g_"+id]
	e.google.rotateTo = "refresh-rotated"
	if rec := b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}); rec.Code != http.StatusOK {
		t.Fatalf("token: %d %s", rec.Code, rec.Body.String())
	}
	if b.cookies["phospheare_g_"+id] == before {
		t.Fatal("the rotated refresh token was not resealed")
	}
	// The old refresh token is gone at the fake, so this succeeds only with
	// the resealed one.
	if rec := b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}); rec.Code != http.StatusOK {
		t.Fatalf("token after rotation: %d %s", rec.Code, rec.Body.String())
	}
}

func TestTokenInvalidGrantClearsCookie(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	e.google.refreshErr = "invalid_grant"
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}), http.StatusConflict, "grant-invalid")
	if c := connectionCookie(t, b, id); c.MaxAge >= 0 || c.Path != "/identity/google" {
		t.Fatalf("cookie not cleared: %+v", c)
	}
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}), http.StatusNotFound, "no-connection")
}

func TestTokenRefusesAnotherWriter(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	b.openSession("writer-b")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}), http.StatusForbidden, "writer-mismatch")
	if _, ok := b.cookies["phospheare_g_"+id]; !ok {
		t.Fatal("a writer mismatch cleared the other writer's connection")
	}
}

func TestTokenRefusesWithoutSession(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	b.request(http.MethodDelete, "/identity/session", nil)
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}), http.StatusUnauthorized, "no-session")
}

func TestTokenRefusesUnknownOrTamperedConnection(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": "AAAAAAAAAAAAAAAAAAAAAAAA"}), http.StatusNotFound, "no-connection")
	v := []byte(b.cookies["phospheare_g_"+id])
	v[10] ^= 1
	b.cookies["phospheare_g_"+id] = string(v)
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}), http.StatusNotFound, "no-connection")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": "bad id"}), http.StatusBadRequest, "bad-request")
}

func TestTokenCookieUnderAnotherNameDoesNotOpen(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	other := "BBBBBBBBBBBBBBBBBBBBBBBB"
	b.cookies["phospheare_g_"+other] = b.cookies["phospheare_g_"+id]
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": other}), http.StatusNotFound, "no-connection")
}

func TestTokenGoogleUnreachable(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	e.google.unreachable = true
	rec := b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id})
	p := expectProblem(t, rec, http.StatusBadGateway, "google-unreachable")
	if p["retryAfterSeconds"].(float64) <= 0 || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("no retry advice: %v", p)
	}
	if _, ok := b.cookies["phospheare_g_"+id]; !ok {
		t.Fatal("an outage cleared the connection")
	}
}

// ── Disconnect ───────────────────────────────────────────────────────────────

func TestDisconnectWithRevoke(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	rec := b.request(http.MethodDelete, "/identity/google/connections/"+id, map[string]bool{"revoke": true})
	if rec.Code != http.StatusOK || decode(t, rec)["revokedAtGoogle"] != true {
		t.Fatalf("disconnect: %d %s", rec.Code, rec.Body.String())
	}
	if len(e.google.revoked) != 1 || !strings.HasPrefix(e.google.revoked[0], "refresh-sub-a") {
		t.Fatalf("revoked %v", e.google.revoked)
	}
	if c := connectionCookie(t, b, id); c.MaxAge >= 0 {
		t.Fatal("the cookie stays")
	}
}

func TestDisconnectRevokeTreatsInvalidTokenAsRevoked(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	e.google.revokeErr = "invalid_token"
	rec := b.request(http.MethodDelete, "/identity/google/connections/"+id, map[string]bool{"revoke": true})
	if rec.Code != http.StatusOK || decode(t, rec)["revokedAtGoogle"] != true {
		t.Fatalf("disconnect: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDisconnectWithoutRevokeOnlyClearsCookie(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	b.request(http.MethodDelete, "/identity/session", nil)
	rec := b.request(http.MethodDelete, "/identity/google/connections/"+id, map[string]bool{"revoke": false})
	if rec.Code != http.StatusOK || decode(t, rec)["revokedAtGoogle"] != false || len(e.google.revoked) != 0 {
		t.Fatalf("disconnect: %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := b.cookies["phospheare_g_"+id]; ok {
		t.Fatal("the cookie stays")
	}
}

func TestDisconnectClearsCookieWhenGoogleCannotRevoke(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	e.google.revokeErr = "server_error"
	rec := b.request(http.MethodDelete, "/identity/google/connections/"+id, map[string]bool{"revoke": true})
	if rec.Code != http.StatusOK || decode(t, rec)["revokedAtGoogle"] != false {
		t.Fatalf("disconnect: %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := b.cookies["phospheare_g_"+id]; ok {
		t.Fatal("unconfirmed remote revocation retained the local credential")
	}
}

func TestDisconnectRevokeRefusesAnotherWriter(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	b.openSession("writer-b")
	expectProblem(t, b.request(http.MethodDelete, "/identity/google/connections/"+id, map[string]bool{"revoke": true}), http.StatusForbidden, "writer-mismatch")
	if len(e.google.revoked) != 0 {
		t.Fatal("another writer revoked the grant")
	}
}
