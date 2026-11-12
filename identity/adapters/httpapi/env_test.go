// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/google"
	"github.com/perseomazzoni/phospheare/identity/adapters/httpapi"
	"github.com/perseomazzoni/phospheare/identity/adapters/seal"
	"github.com/perseomazzoni/phospheare/identity/application"
	"github.com/perseomazzoni/phospheare/identity/domain"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

const (
	localHost   = "localhost:47821"
	localOrigin = "http://localhost:47821"
)

// browser is one browser profile: a cookie jar that keeps cookies by name
// and records every Set-Cookie for attribute checks, and the session proof
// the SPA keeps in its origin's storage and sends on every call.
type browser struct {
	t       *testing.T
	h       http.Handler
	host    string
	cookies map[string]string
	lastSet map[string]*http.Cookie
	proof   string
}

type env struct {
	t      *testing.T
	google *fakeGoogle
	drive  *fakeDriveAPI
	host   *httpapi.Host
	// skew moves the service's clock ahead of the real one.
	skew time.Duration
	// client is the Google client the host reads; zero is not configured.
	client domain.Credentials
	sealer *seal.Sealer
	logs   *bytes.Buffer
	l      httpapi.Listener
	h      http.Handler
}

func newEnv(t *testing.T) *env {
	t.Helper()
	g := newFakeGoogle(t)
	key := bytes.Repeat([]byte{7}, 32)
	sealer, err := seal.New(key)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, google: g, drive: &fakeDriveAPI{}, client: domain.Credentials{ClientID: testClientID, ClientSecret: testClientSecret}}
	clients := ports.ClientFunc(func() (domain.Credentials, bool) {
		return e.client, e.client.ClientID != "" && e.client.ClientSecret != ""
	})
	client := google.NewClient(google.Endpoints{
		Auth:   "https://accounts.example.test/o/oauth2/v2/auth",
		Token:  g.srv.URL + "/token",
		Revoke: g.srv.URL + "/revoke",
	})
	logs := &bytes.Buffer{}
	h := &httpapi.Host{
		ProductName: "Phospheare",
		Sealer:      sealer,
		Clients:     clients,
		Observer:    httpapi.Observer{Logger: slog.New(slog.NewTextHandler(logs, nil))},
		OAuth: &application.Service{
			Google:  client,
			Clients: clients,
			Drive:   e.drive,
			Now:     func() time.Time { return time.Now().Add(e.skew) },
		},
	}
	l := httpapi.Listener{
		Origin:       localOrigin,
		ExpectedHost: localHost,
		Loopback:     true,
	}
	e.host, e.sealer, e.logs, e.l, e.h = h, sealer, logs, l, h.Handler(l)
	return e
}

// replica answers another identity service over the same keys, Google
// client and origin, as a second instance behind a load balancer.
func (e *env) replica() http.Handler {
	e.t.Helper()
	sealer, err := seal.New(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		e.t.Fatal(err)
	}
	h := *e.host
	h.Sealer = sealer
	h.Observer = httpapi.Observer{}
	return h.Handler(e.l)
}

// flowCookies answers the flow cookies the browser holds.
func (b *browser) flowCookies() []string {
	var names []string
	for name := range b.cookies {
		if strings.HasPrefix(name, "phospheare_flow_") {
			names = append(names, name)
		}
	}
	return names
}

func (e *env) browser() *browser {
	return &browser{t: e.t, h: e.h, host: localHost, cookies: map[string]string{}, lastSet: map[string]*http.Cookie{}}
}

// request answers the response to a same-origin request from the SPA.
func (b *browser) request(method, target string, body any, headers ...string) *httptest.ResponseRecorder {
	b.t.Helper()
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, target, rd)
	req.Host = b.host
	if method != http.MethodGet {
		req.Header.Set("X-Phospheare", "1")
		req.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	if b.proof != "" {
		req.Header.Set(httpapi.SessionHeader, b.proof)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i+1] == "" {
			req.Header.Del(headers[i])
		} else {
			req.Header.Set(headers[i], headers[i+1])
		}
	}
	for name, value := range b.cookies {
		req.AddCookie(&http.Cookie{Name: name, Value: value})
	}
	rec := httptest.NewRecorder()
	b.h.ServeHTTP(rec, req)
	for _, c := range rec.Result().Cookies() {
		b.lastSet[c.Name] = c
		if c.MaxAge < 0 {
			delete(b.cookies, c.Name)
		} else {
			b.cookies[c.Name] = c.Value
		}
	}
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return out
}

func expectProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) map[string]any {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d, want %d: %s", rec.Code, status, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("content type %q", ct)
	}
	p := decode(t, rec)
	if p["code"] != code || p["type"] != "about:blank" || int(p["status"].(float64)) != status || p["title"] == "" {
		t.Fatalf("problem %v, want code %s", p, code)
	}
	return p
}

// expectNoSession checks the session probe's answer when no session is open:
// 200 with a null writer, not an error.
func expectNoSession(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("no session: %d %q %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
	body := decode(t, rec)
	if writer, ok := body["writerId"]; !ok || writer != nil || len(body) != 1 {
		t.Fatalf("no session: %s", rec.Body.String())
	}
}

// openSession opens a session for writerID and keeps the proof it answers.
func (b *browser) openSession(writerID string) {
	b.t.Helper()
	rec := b.request(http.MethodPost, "/identity/session", map[string]string{"writerId": writerID})
	if rec.Code != http.StatusOK {
		b.t.Fatalf("open session: %d %s", rec.Code, rec.Body.String())
	}
	proof, _ := decode(b.t, rec)["proof"].(string)
	if len(proof) < 22 {
		b.t.Fatalf("open session answered proof %q", proof)
	}
	b.proof = proof
}

// authorize starts a flow and answers its id and the authorize URL's query.
func (b *browser) authorize(body map[string]string) (string, url.Values) {
	b.t.Helper()
	rec := b.request(http.MethodPost, "/identity/google/flows", body)
	if rec.Code != http.StatusOK {
		b.t.Fatalf("begin flow: %d %s", rec.Code, rec.Body.String())
	}
	out := decode(b.t, rec)
	u, err := url.Parse(out["authorizeUrl"].(string))
	if err != nil {
		b.t.Fatal(err)
	}
	return out["flowId"].(string), u.Query()
}

// consent plays Google: it issues code for the flow's query with gr and
// returns the browser to the callback.
func (e *env) consent(b *browser, q url.Values, code string, gr grant) *httptest.ResponseRecorder {
	e.t.Helper()
	gr.nonce = q.Get("nonce")
	gr.challenge = q.Get("code_challenge")
	gr.redirectURI = q.Get("redirect_uri")
	e.google.issue(code, gr)
	return b.request(http.MethodGet, "/identity/google/callback?"+url.Values{"state": {q.Get("state")}, "code": {code}}.Encode(), nil)
}

const driveScope = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile " +
	"https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata"

// connectDrive runs a whole Drive flow for writerID bound to sub and
// answers the finish response.
func (e *env) connectDrive(b *browser, writerID, sub string) map[string]any {
	e.t.Helper()
	b.openSession(writerID)
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": writerID, "expectedSub": sub})
	page := e.consent(b, q, "code-"+sub+"-"+flowID, grant{sub: sub, email: sub + "@example.test", scope: driveScope})
	if !strings.Contains(page.Body.String(), `data-status="done"`) {
		e.t.Fatalf("callback page: %s", page.Body.String())
	}
	rec := b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil)
	if rec.Code != http.StatusOK {
		e.t.Fatalf("finish: %d %s", rec.Code, rec.Body.String())
	}
	return decode(e.t, rec)
}
