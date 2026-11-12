// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

const (
	testClientID     = "123-test.apps.googleusercontent.com"
	testClientSecret = "test-secret"
)

// grant is what the fake Google issues for one authorization code.
type grant struct {
	sub, email, scope, nonce, challenge, redirectURI string
	aud, iss                                         string
	exp                                              time.Time
	noRefresh                                        bool
}

// fakeGoogle is Google's token and revocation endpoints. It checks the
// client secret, the redirect URI and the PKCE verifier as Google does.
type fakeGoogle struct {
	t   *testing.T
	srv *httptest.Server

	mu          sync.Mutex
	codes       map[string]grant
	refresh     map[string]string
	rotateTo    string
	refreshErr  string
	unreachable bool
	revoked     []string
	revokeErr   string
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	g := &fakeGoogle{t: t, codes: map[string]grant{}, refresh: map[string]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", g.token)
	mux.HandleFunc("POST /revoke", g.revoke)
	g.srv = httptest.NewServer(mux)
	t.Cleanup(g.srv.Close)
	return g
}

func idToken(claims map[string]any) string {
	enc := func(v any) string {
		raw, _ := json.Marshal(v)
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	return enc(map[string]string{"alg": "RS256", "typ": "JWT"}) + "." + enc(claims) + ".c2lnbmF0dXJl"
}

func oauthError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func (g *fakeGoogle) token(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.unreachable {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if r.FormValue("client_id") != testClientID || r.FormValue("client_secret") != testClientSecret {
		oauthError(w, http.StatusUnauthorized, "invalid_client")
		return
	}
	switch r.FormValue("grant_type") {
	case "authorization_code":
		gr, ok := g.codes[r.FormValue("code")]
		delete(g.codes, r.FormValue("code"))
		if !ok {
			oauthError(w, http.StatusBadRequest, "invalid_grant")
			return
		}
		if r.FormValue("redirect_uri") != gr.redirectURI {
			oauthError(w, http.StatusBadRequest, "redirect_uri_mismatch")
			return
		}
		sum := sha256.Sum256([]byte(r.FormValue("code_verifier")))
		if base64.RawURLEncoding.EncodeToString(sum[:]) != gr.challenge {
			oauthError(w, http.StatusBadRequest, "invalid_grant")
			return
		}
		aud, iss, exp := gr.aud, gr.iss, gr.exp
		if aud == "" {
			aud = testClientID
		}
		if iss == "" {
			iss = "https://accounts.google.com"
		}
		if exp.IsZero() {
			exp = time.Now().Add(time.Hour)
		}
		out := map[string]any{
			"access_token": "access-" + gr.sub,
			"expires_in":   3599,
			"scope":        gr.scope,
			"token_type":   "Bearer",
			"id_token": idToken(map[string]any{
				"iss": iss, "aud": aud, "sub": gr.sub, "exp": exp.Unix(), "nonce": gr.nonce,
				"email": gr.email, "email_verified": true, "name": "Test Writer", "picture": "https://example.test/p.png",
			}),
		}
		if !gr.noRefresh {
			rt := "refresh-" + gr.sub + "-" + gr.nonce
			g.refresh[rt] = gr.sub
			out["refresh_token"] = rt
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	case "refresh_token":
		if g.refreshErr != "" {
			oauthError(w, http.StatusBadRequest, g.refreshErr)
			return
		}
		rt := r.FormValue("refresh_token")
		sub, ok := g.refresh[rt]
		if !ok {
			oauthError(w, http.StatusBadRequest, "invalid_grant")
			return
		}
		out := map[string]any{
			"access_token": "access-refreshed-" + sub,
			"expires_in":   3599,
			"scope":        "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata",
			"token_type":   "Bearer",
		}
		if g.rotateTo != "" {
			delete(g.refresh, rt)
			g.refresh[g.rotateTo] = sub
			out["refresh_token"] = g.rotateTo
			g.rotateTo = ""
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	default:
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type")
	}
}

func (g *fakeGoogle) revoke(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.revokeErr != "" {
		oauthError(w, http.StatusBadRequest, g.revokeErr)
		return
	}
	g.revoked = append(g.revoked, r.FormValue("token"))
	delete(g.refresh, r.FormValue("token"))
	w.WriteHeader(http.StatusOK)
}

func (g *fakeGoogle) issue(code string, gr grant) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.codes[code] = gr
}
