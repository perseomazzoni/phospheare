// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package google

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/perseomazzoni/phospheare/identity/domain"
)

const checkURI = "http://localhost:47821/identity/google/callback"

// fakeAuth answers the authorization endpoint the way Google does: a
// redirect to its sign-in page, or to its error page when refused is set.
func fakeAuth(refused *string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if *refused == "" {
			http.Redirect(w, r, "https://accounts.google.com/v3/signin/identifier?x=1", http.StatusFound)
			return
		}
		msg := append([]byte{0x0a, byte(len(*refused))}, *refused...)
		msg = append(msg, 0x12, 0x03, 'a', 'b', 'c')
		q := url.Values{"authError": {base64.StdEncoding.EncodeToString(msg)}}
		http.Redirect(w, r, "https://accounts.google.com/signin/oauth/error?"+q.Encode(), http.StatusFound)
	}))
}

func TestCheckClassifiesGoogleAnswers(t *testing.T) {
	refused := ""
	auth := fakeAuth(&refused)
	defer auth.Close()
	answer := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if answer == "" {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": answer})
	}))
	defer srv.Close()
	c := NewClient(Endpoints{Auth: auth.URL, Token: srv.URL})
	want := map[string]CheckResult{
		"invalid_grant":         CheckOK,
		"invalid_client":        CheckWrongCredentials,
		"unauthorized_client":   CheckWrongCredentials,
		"redirect_uri_mismatch": CheckRedirectMismatch,
		"something_else":        CheckUnexpected,
		"":                      CheckUnreachable,
	}
	for a, w := range want {
		answer = a
		if got, _ := c.Check(context.Background(), domain.Credentials{ClientID: "id", ClientSecret: "secret"}, checkURI); got != w {
			t.Fatalf("%q: %s, want %s", a, got, w)
		}
	}
}

// The token endpoint accepts any address for a code that does not exist, so
// the authorization endpoint's refusal decides.
func TestCheckFindsWhatTheAuthorizationEndpointRefuses(t *testing.T) {
	refused := ""
	auth := fakeAuth(&refused)
	defer auth.Close()
	token := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
	}))
	defer token.Close()
	c := NewClient(Endpoints{Auth: auth.URL, Token: token.URL})
	want := map[string]CheckResult{
		"redirect_uri_mismatch": CheckRedirectMismatch,
		"invalid_client":        CheckWrongCredentials,
		"deleted_client":        CheckWrongCredentials,
		"admin_policy_enforced": CheckUnexpected,
	}
	for r, w := range want {
		refused = r
		got, detail := c.Check(context.Background(), domain.Credentials{ClientID: "id", ClientSecret: "secret"}, checkURI)
		if got != w || detail != r {
			t.Fatalf("%q: %s %q, want %s", r, got, detail, w)
		}
	}
}

// An answer the authorization endpoint gives that is neither its sign-in
// page nor its error redirect says nothing about the client, so the check
// cannot report it as accepted.
func TestCheckCannotTellFromAnUnknownAuthorizeAnswer(t *testing.T) {
	token := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
	}))
	defer token.Close()
	answers := map[string]http.HandlerFunc{
		"400 page":         func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusBadRequest) },
		"404 page":         func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) },
		"redirect nowhere": func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusFound) },
		"unreadable refusal": func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://accounts.google.com/signin/oauth/error?authError=!!!", http.StatusFound)
		},
	}
	for name, answer := range answers {
		auth := httptest.NewServer(answer)
		c := NewClient(Endpoints{Auth: auth.URL, Token: token.URL})
		got, _ := c.Check(context.Background(), domain.Credentials{ClientID: "id", ClientSecret: "secret"}, checkURI)
		auth.Close()
		if got != CheckUnexpected {
			t.Fatalf("%s: %s, want %s", name, got, CheckUnexpected)
		}
	}
	page := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("<html>sign in</html>")) }))
	defer page.Close()
	if got, _ := NewClient(Endpoints{Auth: page.URL, Token: token.URL}).Check(context.Background(), domain.Credentials{ClientID: "id", ClientSecret: "secret"}, checkURI); got != CheckOK {
		t.Fatalf("a sign-in page served directly: %s, want ok", got)
	}
}

func TestAuthErrorCodeRefusesWhatItCannotRead(t *testing.T) {
	for _, s := range []string{"", "!!!", base64.StdEncoding.EncodeToString([]byte{0x12, 0x01, 'a'}), base64.StdEncoding.EncodeToString([]byte{0x0a, 0x09, 'a'})} {
		if got := authErrorCode(s); got != "unknown" {
			t.Fatalf("%q: %q, want unknown", s, got)
		}
	}
}
