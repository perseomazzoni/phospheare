// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const (
	testVerifier  = "verifier-0123456789012345678901234567890123456789"
	homeCallback  = "https://casa.dedyn.io:47843" + callbackPath
	localCallback = "http://localhost:47831" + callbackPath
)

func startGoogle(t *testing.T, answer string) (*httptest.Server, *http.Client) {
	t.Helper()
	g := newFakeGoogle()
	g.answer = answer
	mux := http.NewServeMux()
	g.routes(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return srv, client
}

// authorize asks the sign-in page as the identity service's check does, and
// answers the refusal code, or "" for the page.
func authorize(t *testing.T, srv *httptest.Server, c *http.Client, clientID, redirect string) string {
	t.Helper()
	resp, err := c.Get(srv.URL + "/google/auth?" + url.Values{"client_id": {clientID}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {"openid"}}.Encode())
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return ""
	}
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if !strings.HasSuffix(loc.Path, "/signin/oauth/error") {
		t.Fatalf("status %d, location %q", resp.StatusCode, loc)
	}
	raw, err := base64.StdEncoding.DecodeString(loc.Query().Get("authError"))
	if err != nil || len(raw) < 2 || raw[0] != 0x0a || int(raw[1]) != len(raw)-2 {
		t.Fatalf("authError %q does not read", loc.Query().Get("authError"))
	}
	return string(raw[2:])
}

func TestTheSignInPageRefusesAsGoogleDoes(t *testing.T) {
	cases := []struct {
		answer, clientID, redirect, want string
	}{
		{"works", testClientID, homeCallback, ""},
		{"works", "other.apps.googleusercontent.com", localCallback, "invalid_client"},
		{"credentials", testClientID, localCallback, "deleted_client"},
		{"addresses", testClientID, localCallback, "redirect_uri_mismatch"},
		{"phones", testClientID, localCallback, ""},
		{"phones", testClientID, homeCallback, "redirect_uri_mismatch"},
	}
	for _, c := range cases {
		srv, client := startGoogle(t, c.answer)
		if got := authorize(t, srv, client, c.clientID, c.redirect); got != c.want {
			t.Errorf("%s, %s: refusal %q, want %q", c.answer, c.redirect, got, c.want)
		}
	}
}

func postForm(t *testing.T, c *http.Client, u string, form url.Values) (int, map[string]any) {
	t.Helper()
	resp, err := c.PostForm(u, form)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	body, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(body, &out)
	return resp.StatusCode, out
}

// The identity service's check redeems a code that does not exist: a
// client that works gets invalid_grant, a wrong secret invalid_client.
func TestTheTokenEndpointAnswersTheCheck(t *testing.T) {
	srv, client := startGoogle(t, "works")
	form := url.Values{"grant_type": {"authorization_code"}, "code": {"none"}, "code_verifier": {testVerifier},
		"redirect_uri": {localCallback}, "client_id": {testClientID}, "client_secret": {testClientSecret}}
	if status, out := postForm(t, client, srv.URL+"/google/token", form); status != 400 || out["error"] != "invalid_grant" {
		t.Errorf("unknown code: %d %v", status, out)
	}
	form.Set("client_secret", "wrong")
	if status, out := postForm(t, client, srv.URL+"/google/token", form); status != 401 || out["error"] != "invalid_client" {
		t.Errorf("wrong secret: %d %v", status, out)
	}
}

// signIn walks the consent page and the token endpoint as the trial
// sign-in does, and answers the token answer.
func signIn(t *testing.T, srv *httptest.Server, c *http.Client) map[string]any {
	t.Helper()
	sum := sha256.Sum256([]byte(testVerifier))
	scope := "openid email profile " + driveFile + " " + driveAppdata
	resp, err := c.PostForm(srv.URL+"/google/approve", url.Values{
		"choice": {"allow"}, "client_id": {testClientID}, "redirect_uri": {localCallback}, "state": {"flow-1"},
		"nonce": {"nonce-1"}, "scope": {scope}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])},
	})
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	back, _ := url.Parse(resp.Header.Get("Location"))
	if back.Path != callbackPath || back.Query().Get("state") != "flow-1" || back.Query().Get("code") == "" {
		t.Fatalf("approve went to %q", back)
	}
	status, out := postForm(t, c, srv.URL+"/google/token", url.Values{"grant_type": {"authorization_code"},
		"code": {back.Query().Get("code")}, "code_verifier": {testVerifier}, "redirect_uri": {localCallback},
		"client_id": {testClientID}, "client_secret": {testClientSecret}})
	if status != 200 {
		t.Fatalf("token: %d %v", status, out)
	}
	return out
}

func driveReason(t *testing.T, srv *httptest.Server, c *http.Client, token string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/google/drive/v3/files?spaces=appDataFolder", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Error struct {
			Errors []struct{ Reason string } `json:"errors"`
		} `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	if len(out.Error.Errors) > 0 {
		return resp.StatusCode, out.Error.Errors[0].Reason
	}
	return resp.StatusCode, ""
}

func TestATrialSignInWorks(t *testing.T) {
	srv, client := startGoogle(t, "works")
	out := signIn(t, srv, client)
	parts := strings.Split(out["id_token"].(string), ".")
	if len(parts) != 3 {
		t.Fatalf("id_token has %d parts", len(parts))
	}
	raw, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]any
	json.Unmarshal(raw, &claims)
	if claims["aud"] != testClientID || claims["nonce"] != "nonce-1" || claims["iss"] != "https://accounts.google.com" || claims["email"] != writerEmail {
		t.Errorf("claims = %v", claims)
	}
	if status, reason := driveReason(t, srv, client, out["access_token"].(string)); status != 200 {
		t.Errorf("drive: %d %s", status, reason)
	}
}

func TestTheDriveAnswers(t *testing.T) {
	for answer, want := range map[string]string{"drive-off": "accessNotConfigured", "no-drive": "insufficientPermissions"} {
		srv, client := startGoogle(t, answer)
		out := signIn(t, srv, client)
		if status, reason := driveReason(t, srv, client, out["access_token"].(string)); status != 403 || reason != want {
			t.Errorf("%s: %d %s, want 403 %s", answer, status, reason, want)
		}
	}
}

func TestACodeWorksOnce(t *testing.T) {
	srv, client := startGoogle(t, "works")
	sum := sha256.Sum256([]byte(testVerifier))
	resp, _ := client.PostForm(srv.URL+"/google/approve", url.Values{"choice": {"allow"}, "client_id": {testClientID},
		"redirect_uri": {localCallback}, "nonce": {"n"}, "scope": {"openid"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}})
	resp.Body.Close()
	back, _ := url.Parse(resp.Header.Get("Location"))
	form := url.Values{"grant_type": {"authorization_code"}, "code": {back.Query().Get("code")}, "code_verifier": {testVerifier},
		"redirect_uri": {localCallback}, "client_id": {testClientID}, "client_secret": {testClientSecret}}
	if status, _ := postForm(t, client, srv.URL+"/google/token", form); status != 200 {
		t.Fatalf("first use: %d", status)
	}
	if status, out := postForm(t, client, srv.URL+"/google/token", form); status != 400 || out["error"] != "invalid_grant" {
		t.Errorf("second use: %d %v", status, out)
	}
}

func TestApproveGoesOnlyToTheCallback(t *testing.T) {
	srv, client := startGoogle(t, "works")
	resp, _ := client.PostForm(srv.URL+"/google/approve", url.Values{"choice": {"allow"}, "redirect_uri": {"https://example.com/elsewhere"}})
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status %d, want 400", resp.StatusCode)
	}
}

func TestTheConsoleStandInNamesThePage(t *testing.T) {
	srv, client := startGoogle(t, "works")
	resp, err := client.Get(srv.URL + "/console/auth/clients")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), "<strong>Clients</strong>") ||
		!strings.Contains(string(body), testClientID) || !strings.Contains(string(body), testClientSecret) {
		t.Errorf("%d %s", resp.StatusCode, body)
	}
	resp, err = client.Get(srv.URL + "/console/projectcreate")
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if strings.Contains(string(body), testClientSecret) {
		t.Error("a page other than Clients gives the test client")
	}
}
