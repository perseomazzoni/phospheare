// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"html/template"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/googletest"
)

// The test client that the control page offers. The stand-in accepts no
// other, as Google accepts only the clients of a project.
const (
	testClientID     = googletest.ClientID
	testClientSecret = googletest.ClientSecret
	callbackPath     = "/identity/google/callback"
	driveAppdata     = "https://www.googleapis.com/auth/drive.appdata"
	driveFile        = "https://www.googleapis.com/auth/drive.file"
)

// The writer that every sign-in names.
const (
	writerSub   = "wizard-writer-1"
	writerEmail = "writer@example.com"
	writerName  = "Test Writer"
)

// googleAnswers are the answers the control page can choose, the first one
// by default. Each one is what Google answers in a real case.
var googleAnswers = []struct{ Key, Label string }{
	{"works", "Everything works"},
	{"credentials", "The client ID or secret is wrong (deleted client)"},
	{"phones", "The phones' address is missing from the client"},
	{"addresses", "Every address is missing from the client"},
	{"drive-off", "The Google Drive API is turned off in the project"},
	{"no-drive", "The writer does not tick the Google Drive permissions"},
	{"down", "Google does not answer"},
}

// fakeGoogle stands in for Google's OAuth endpoints and for the one Drive
// call of the setup page's trial sign-in. Its ID tokens carry no signature:
// the identity service takes them from the token endpoint, as OpenID
// Connect lets a client do, and checks no signature.
type fakeGoogle struct {
	mu     sync.Mutex
	answer string
	codes  map[string]grant
	// tokens maps each access and refresh token to its scope.
	tokens map[string]string
}

type grant struct {
	clientID, redirectURI, nonce, scope, challenge string
	offline                                        bool
	made                                           time.Time
}

func newFakeGoogle() *fakeGoogle {
	return &fakeGoogle{answer: googleAnswers[0].Key, codes: map[string]grant{}, tokens: map[string]string{}}
}

func (g *fakeGoogle) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /google/auth", g.auth)
	mux.HandleFunc("POST /google/approve", g.approve)
	mux.HandleFunc("GET /google/signin/oauth/error", g.authError)
	mux.HandleFunc("POST /google/token", g.token)
	mux.HandleFunc("POST /google/revoke", g.revoke)
	mux.HandleFunc("GET /google/drive/v3/files", g.files)
	mux.HandleFunc("GET /google/client.json", g.clientFile)
	mux.HandleFunc("POST /google/answer", g.setAnswer)
	mux.HandleFunc("GET /console/{page...}", console)
}

// consolePages names the Google Cloud Console pages that the setup page
// opens.
var consolePages = map[string]string{
	"projectcreate":                     "New project",
	"apis/library/drive.googleapis.com": "Google Drive API",
	"auth/overview":                     "Google Auth Platform",
	"auth/branding":                     "Branding",
	"auth/audience":                     "Audience",
	"auth/scopes":                       "Data Access",
	"auth/clients":                      "Clients",
}

// console stands in for a Google Cloud Console page that the setup page
// opens, which a devfake build of the desktop program leads here.
func console(w http.ResponseWriter, r *http.Request) {
	page := r.PathValue("page")
	name, ok := consolePages[page]
	if !ok {
		name = page
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// The Clients page is where the real setup makes the client, so it
	// gives the test client.
	if err := consolePage.Execute(w, map[string]any{
		"Name": name, "Page": page, "Clients": page == "auth/clients",
		"ClientID": testClientID, "Secret": testClientSecret,
	}); err != nil {
		log.Print(err)
	}
}

// Answer answers the chosen answer's key.
func (g *fakeGoogle) Answer() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.answer
}

func (g *fakeGoogle) setAnswer(w http.ResponseWriter, r *http.Request) {
	key := r.FormValue("answer")
	for _, a := range googleAnswers {
		if a.Key == key {
			g.mu.Lock()
			g.answer = key
			g.mu.Unlock()
			log.Printf("Google: answer set to %q", a.Label)
		}
	}
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// refusal answers the code that Google's sign-in page refuses a client
// with, or "".
func (g *fakeGoogle) refusal(clientID, redirectURI string) string {
	switch g.answer {
	case "credentials":
		return "deleted_client"
	case "addresses":
		return "redirect_uri_mismatch"
	case "phones":
		if u, err := url.Parse(redirectURI); err == nil && !loopbackName(u.Hostname()) {
			return "redirect_uri_mismatch"
		}
	}
	if clientID != testClientID {
		return "invalid_client"
	}
	return ""
}

func loopbackName(host string) bool {
	ip := net.ParseIP(host)
	return host == "localhost" || ip != nil && ip.IsLoopback()
}

// auth is the sign-in page. A refusal goes to the error page, as Google's
// does; the identity service's check reads the code from that redirect.
func (g *fakeGoogle) auth(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	q := r.URL.Query()
	if g.answer == "down" {
		http.Error(w, "Google does not answer (fake-services).", http.StatusServiceUnavailable)
		return
	}
	if code := g.refusal(q.Get("client_id"), q.Get("redirect_uri")); code != "" {
		// Google's authError: byte 0x0a, the code's length, then the code.
		raw := append([]byte{0x0a, byte(len(code))}, code...)
		http.Redirect(w, r, "/google/signin/oauth/error?"+url.Values{
			"authError":   {base64.StdEncoding.EncodeToString(raw)},
			"code":        {code},
			"redirectUri": {q.Get("redirect_uri")},
		}.Encode(), http.StatusFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := consentPage.Execute(w, map[string]any{
		"Query":  q,
		"Scopes": strings.Fields(q.Get("scope")),
		"Email":  writerEmail,
		"Name":   writerName,
	}); err != nil {
		log.Print(err)
	}
}

func (g *fakeGoogle) authError(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusBadRequest)
	if err := errorPage.Execute(w, r.URL.Query()); err != nil {
		log.Print(err)
	}
}

// approve is the consent page's answer: back to the client with a code, or
// with access_denied.
func (g *fakeGoogle) approve(w http.ResponseWriter, r *http.Request) {
	back, err := url.Parse(r.FormValue("redirect_uri"))
	if err != nil || (back.Scheme != "http" && back.Scheme != "https") || back.Path != callbackPath {
		http.Error(w, "The redirect address is not the identity service's callback.", http.StatusBadRequest)
		return
	}
	q := url.Values{"state": {r.FormValue("state")}}
	if r.FormValue("choice") != "allow" {
		q.Set("error", "access_denied")
	} else {
		code := randomText()
		g.mu.Lock()
		g.codes[code] = grant{
			clientID:    r.FormValue("client_id"),
			redirectURI: back.String(),
			nonce:       r.FormValue("nonce"),
			scope:       r.FormValue("scope"),
			challenge:   r.FormValue("code_challenge"),
			offline:     r.FormValue("access_type") == "offline",
			made:        time.Now(),
		}
		g.mu.Unlock()
		q.Set("code", code)
		q.Set("scope", r.FormValue("scope"))
		log.Printf("Google: %s signed in", writerEmail)
	}
	back.RawQuery = q.Encode()
	http.Redirect(w, r, back.String(), http.StatusSeeOther)
}

func oauthError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code})
}

// token trades a code or a refresh token, after the client's ID and secret.
func (g *fakeGoogle) token(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.answer == "down" {
		http.Error(w, "Google does not answer (fake-services).", http.StatusServiceUnavailable)
		return
	}
	if g.answer == "credentials" || r.FormValue("client_id") != testClientID || r.FormValue("client_secret") != testClientSecret {
		oauthError(w, http.StatusUnauthorized, "invalid_client")
		return
	}
	var scope, nonce string
	offline := false
	switch r.FormValue("grant_type") {
	case "authorization_code":
		code := r.FormValue("code")
		gr, ok := g.codes[code]
		delete(g.codes, code)
		sum := sha256.Sum256([]byte(r.FormValue("code_verifier")))
		if !ok || time.Since(gr.made) > 10*time.Minute || gr.redirectURI != r.FormValue("redirect_uri") ||
			gr.challenge != base64.RawURLEncoding.EncodeToString(sum[:]) {
			oauthError(w, http.StatusBadRequest, "invalid_grant")
			return
		}
		scope, nonce, offline = gr.scope, gr.nonce, gr.offline
		if g.answer == "no-drive" {
			scope = withoutDrive(scope)
		}
	case "refresh_token":
		s, ok := g.tokens[r.FormValue("refresh_token")]
		if !ok {
			oauthError(w, http.StatusBadRequest, "invalid_grant")
			return
		}
		scope = s
	default:
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type")
		return
	}
	access := "wizard-access-" + randomText()
	g.tokens[access] = scope
	out := map[string]any{"access_token": access, "expires_in": 3599, "scope": scope, "token_type": "Bearer"}
	if offline {
		refresh := "1//wizard-" + randomText()
		g.tokens[refresh] = scope
		out["refresh_token"] = refresh
	}
	if nonce != "" {
		out["id_token"] = idToken(nonce)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func withoutDrive(scope string) string {
	var kept []string
	for _, s := range strings.Fields(scope) {
		if s != driveFile && s != driveAppdata {
			kept = append(kept, s)
		}
	}
	return strings.Join(kept, " ")
}

// idToken answers an ID token for the test writer, without a signature.
func idToken(nonce string) string {
	part := func(v any) string {
		raw, _ := json.Marshal(v)
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	now := time.Now().Unix()
	return part(map[string]string{"alg": "none", "typ": "JWT"}) + "." + part(map[string]any{
		"iss": "https://accounts.google.com", "aud": testClientID, "sub": writerSub,
		"email": writerEmail, "email_verified": true, "name": writerName,
		"nonce": nonce, "iat": now, "exp": now + 3600,
	}) + "."
}

func (g *fakeGoogle) revoke(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	token := r.FormValue("token")
	if _, ok := g.tokens[token]; !ok {
		oauthError(w, http.StatusBadRequest, "invalid_token")
		return
	}
	delete(g.tokens, token)
	w.WriteHeader(http.StatusOK)
}

// files is the trial sign-in's Drive call: a list of the app's hidden
// folder, empty.
func (g *fakeGoogle) files(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	driveError := func(status int, reason string) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"errors": []map[string]string{{"reason": reason}}}})
	}
	scope, ok := g.tokens[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	switch {
	case g.answer == "down":
		http.Error(w, "Google does not answer (fake-services).", http.StatusServiceUnavailable)
	case !ok:
		driveError(http.StatusUnauthorized, "authError")
	case g.answer == "drive-off":
		driveError(http.StatusForbidden, "accessNotConfigured")
	case !strings.Contains(" "+scope+" ", " "+driveAppdata+" "):
		driveError(http.StatusForbidden, "insufficientPermissions")
	default:
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"files":[]}`))
	}
}

// clientFile is the file that Google Cloud Console downloads for a Web
// application client.
func (g *fakeGoogle) clientFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="client_secret_`+testClientID+`.json"`)
	json.NewEncoder(w).Encode(map[string]any{"web": map[string]any{
		"client_id":     testClientID,
		"project_id":    "phospheare-wizard",
		"auth_uri":      "https://accounts.google.com/o/oauth2/auth",
		"token_uri":     "https://oauth2.googleapis.com/token",
		"client_secret": testClientSecret,
	}})
}

func randomText() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

var consentPage = template.Must(template.New("consent").Parse(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in - Fake Google</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }
  code { word-break: break-all; }
  .row { display: flex; gap: .75rem; margin-top: 1.5rem; }
</style>
<h1>Fake Google</h1>
<p><strong>{{.Name}}</strong> ({{.Email}}) signs in to the client
<code>{{.Query.Get "client_id"}}</code>.</p>
<p>The client asks for:</p>
<ul>{{range .Scopes}}<li><code>{{.}}</code></li>{{end}}</ul>
<p>Back to: <code>{{.Query.Get "redirect_uri"}}</code></p>
<form method="post" action="/google/approve">
  <input type="hidden" name="client_id" value="{{.Query.Get "client_id"}}">
  <input type="hidden" name="redirect_uri" value="{{.Query.Get "redirect_uri"}}">
  <input type="hidden" name="state" value="{{.Query.Get "state"}}">
  <input type="hidden" name="nonce" value="{{.Query.Get "nonce"}}">
  <input type="hidden" name="scope" value="{{.Query.Get "scope"}}">
  <input type="hidden" name="code_challenge" value="{{.Query.Get "code_challenge"}}">
  <input type="hidden" name="access_type" value="{{.Query.Get "access_type"}}">
  <div class="row">
    <button name="choice" value="allow">Continue</button>
    <button name="choice" value="deny">Cancel</button>
  </div>
</form>
`))

var consolePage = template.Must(template.New("console").Parse(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Name}} - Fake Google Cloud Console</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }
  code { word-break: break-all; }
  .value { display: flex; gap: .5rem; align-items: center; margin: .25rem 0 1rem; }
  .value code { flex: 1; padding: .4rem .6rem; border: 1px solid #ccc; border-radius: 6px; }
</style>
<h1>Fake Google Cloud Console</h1>
<p>In the real setup, this tab opens the Google Cloud Console page
<strong>{{.Name}}</strong> (<code>console.cloud.google.com/{{.Page}}</code>).</p>
{{if .Clients}}<p>Here is the test client. Copy the two values into the setup
page, or download the client file.</p>
<div>Client ID</div>
<div class="value"><code id="client-id">{{.ClientID}}</code><button type="button" data-copy="client-id">Copy</button></div>
<div>Client secret</div>
<div class="value"><code id="client-secret">{{.Secret}}</code><button type="button" data-copy="client-secret">Copy</button></div>
<p><a href="/google/client.json">Download the client file</a></p>
<p>Then close this tab and go back to the setup page.</p>
<script>
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var code = document.getElementById(b.dataset.copy);
      navigator.clipboard.writeText(code.textContent).then(function () {
        b.textContent = "Copied";
      }, function () {
        // A browser that refuses the clipboard: select the value instead.
        getSelection().selectAllChildren(code);
        b.textContent = "Press Ctrl+C";
      });
    });
  });
</script>
{{else}}<p>Here there is nothing to do. Close this tab and go back to the setup page.</p>
{{end}}`))

var errorPage = template.Must(template.New("error").Parse(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Error - Fake Google</title>
<style>body { font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; } code { word-break: break-all; }</style>
<h1>Access blocked</h1>
<p>Error 400: <strong>{{.Get "code"}}</strong></p>
{{with .Get "redirectUri"}}<p>Address: <code>{{.}}</code></p>{{end}}
<p>This is the answer chosen on the control page of fake-services.</p>
`))
