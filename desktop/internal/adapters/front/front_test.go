// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package front_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/front"
)

const (
	localHost   = "localhost:47821"
	localOrigin = "http://localhost:47821"
)

type env struct {
	id *upstream
	h  http.Handler
	// configured is whether a Google client is set up; newEnv sets it.
	configured bool
	// log holds every line the handler logs, DEBUG included.
	log *bytes.Buffer
}

// upstream stands for the identity service: it answers with what reached
// it, as JSON.
type upstream struct{ target *url.URL }

func (u *upstream) Target() *url.URL { return u.target }

func newUpstream(t *testing.T) *upstream {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"writerId": nil,
			"host":     r.Host,
			"path":     r.URL.RequestURI(),
			"for":      r.Header.Get("X-Forwarded-For"),
		})
	}))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return &upstream{target: u}
}

var testSPA = fstest.MapFS{
	"index.html":           {Data: []byte("<!doctype html><title>app</title>")},
	"assets/app-abc123.js": {Data: []byte("console.log(1)")},
	"favicon.svg":          {Data: []byte("<svg/>")},
	"landing/index.html":   {Data: []byte("landing")},
	"manifest.webmanifest": {Data: []byte("{}")},
}

// newEnv answers the loopback front over a stand-in identity service, with
// Google set up and the desktop paths answering "desktop".
func newEnv(t *testing.T) *env {
	t.Helper()
	e := &env{id: newUpstream(t), configured: true, log: new(bytes.Buffer)}
	e.h = front.Handler(front.Options{
		Logger:    slog.New(slog.NewTextHandler(e.log, &slog.HandlerOptions{Level: slog.LevelDebug})),
		Listener:  front.Listener{Origin: localOrigin, ExpectedHost: localHost},
		AliasHost: "127.0.0.1:47821",
		WrongHost: "Phospheare answers only at its own address.",
		Identity:  e.id,
		Desktop: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.WriteString(w, "desktop")
		}),
		Configured:   func() bool { return e.configured },
		SPA:          testSPA,
		SPAImmutable: true,
	})
	return e
}

func get(e *env, path string, headers ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Host = localHost
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func TestSPAFallbackServesIndexForClientRoutes(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/", "/app", "/app/library/abc", "/app/connect/openrouter"} {
		rec := get(e, p)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<title>app</title>") {
			t.Fatalf("%s: %d %s", p, rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Cache-Control") != "no-cache" {
			t.Fatalf("%s cache %q", p, rec.Header().Get("Cache-Control"))
		}
	}
	if rec := get(e, "/landing/"); rec.Body.String() != "landing" {
		t.Fatalf("directory index: %s", rec.Body.String())
	}
}

func TestSPAMissingFileWithExtensionIs404(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/assets/gone-123.js", "/missing.png"} {
		if rec := get(e, p); rec.Code != http.StatusNotFound {
			t.Fatalf("%s: %d", p, rec.Code)
		}
	}
}

func TestSPAAssetsAreImmutable(t *testing.T) {
	e := newEnv(t)
	rec := get(e, "/assets/app-abc123.js")
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset: %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	if !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("content type %q", rec.Header().Get("Content-Type"))
	}
	tag := rec.Header().Get("ETag")
	if tag == "" {
		t.Fatal("no ETag")
	}
	if again := get(e, "/assets/app-abc123.js", "If-None-Match", tag); again.Code != http.StatusNotModified {
		t.Fatalf("revalidation: %d", again.Code)
	}
	if rec := get(e, "/manifest.webmanifest"); rec.Header().Get("Content-Type") != "application/manifest+json" {
		t.Fatalf("manifest type %q", rec.Header().Get("Content-Type"))
	}
}

func TestSPASecurityHeaders(t *testing.T) {
	e := newEnv(t)
	rec := get(e, "/app")
	want := map[string]string{
		"X-Content-Type-Options":       "nosniff",
		"X-Frame-Options":              "DENY",
		"Content-Security-Policy":      "frame-ancestors 'none'; form-action 'self'",
		"Cross-Origin-Embedder-Policy": "credentialless",
		"Referrer-Policy":              "no-referrer",
		"Cross-Origin-Opener-Policy":   "same-origin-allow-popups",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Permissions-Policy":           "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	}
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Fatalf("%s = %q, want %q", k, got, v)
		}
	}
	connect := get(e, "/app/connect/openrouter")
	if connect.Header().Get("Cross-Origin-Opener-Policy") != "" {
		t.Fatal("/app/connect/* carries COOP")
	}
	if connect.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("/app/connect/* lost the other headers")
	}
}

func TestSPARefusesWrites(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodPost, "/app", nil)
	req.Host = localHost
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /app: %d", rec.Code)
	}
}

func TestLoopbackMountsDesktopPaths(t *testing.T) {
	e := newEnv(t)
	rec := get(e, "/desktop/setup/")
	if rec.Body.String() != "desktop" {
		t.Fatalf("desktop paths not mounted: %d", rec.Code)
	}
	if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("Cross-Origin-Opener-Policy") != "same-origin" {
		t.Fatalf("/desktop/ headers %v", rec.Header())
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("/desktop/ headers %v", rec.Header())
	}
}

// The identity routes reach the identity service with the browser's Host,
// which picks the listener there, and the address of the device that sent
// them, never one the browser claims; its answer comes back with its own
// headers only.
func TestLoopbackSendsIdentityRoutesToIdentity(t *testing.T) {
	e := newEnv(t)
	rec := get(e, "/identity/session?x=1", "X-Forwarded-For", "203.0.113.9")
	if rec.Code != http.StatusOK {
		t.Fatalf("/identity/session: %d %s", rec.Code, rec.Body.String())
	}
	var seen map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &seen); err != nil {
		t.Fatal(err)
	}
	if writer, ok := seen["writerId"]; !ok || writer != nil || seen["host"] != localHost || seen["path"] != "/identity/session?x=1" || seen["for"] != "192.0.2.1" {
		t.Fatalf("the identity service saw %v", seen)
	}
	if rec.Header().Get("Content-Security-Policy") != "default-src 'none'; frame-ancestors 'none'" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("/identity/session headers %v", rec.Header())
	}
	if rec.Header().Get("Cross-Origin-Embedder-Policy") != "" {
		t.Fatalf("the SPA's headers reached an identity answer: %v", rec.Header())
	}
}

func TestIdentityRoutesSayWhenTheServiceIsDown(t *testing.T) {
	e := newEnv(t)
	running := e.id.target
	e.id.target = nil
	rec := get(e, "/identity/session")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "\"identity-unavailable\"") {
		t.Fatalf("no service: %d %s", rec.Code, rec.Body.String())
	}
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	e.id.target, _ = url.Parse(closed.URL)
	rec = get(e, "/identity/session")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "\"identity-unavailable\"") {
		t.Fatalf("a service that does not answer: %d %s", rec.Code, rec.Body.String())
	}
	e.id.target = running
	if rec := get(e, "/identity/session"); rec.Code != http.StatusOK {
		t.Fatalf("a running service: %d", rec.Code)
	}
	log := e.log.String()
	if !strings.Contains(log, "level=WARN msg=\"The identity service is not running.") ||
		!strings.Contains(log, "level=ERROR msg=\"The identity service did not answer.\"") || strings.Contains(log, "/identity/session") {
		t.Fatalf("log %q", log)
	}
}

// The log names the route that answered, never the path, which can name a
// project, and leaves the identity routes to the identity service's log.
func TestFrontLogsRoutesNotPaths(t *testing.T) {
	var out bytes.Buffer
	e := newEnv(t)
	h := front.Handler(front.Options{
		Listener: front.Listener{Origin: localOrigin, ExpectedHost: localHost},
		Identity: e.id,
		SPA:      testSPA,
		Logger:   slog.New(slog.NewTextHandler(&out, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
	get(&env{h: h}, "/app/editor/project-7f3a")
	get(&env{h: h}, "/identity/session")
	log := out.String()
	if strings.Contains(log, "project-7f3a") || strings.Contains(log, "/identity/") || !strings.Contains(log, `msg="GET /"`) || strings.Count(log, "\n") != 1 {
		t.Fatalf("log %q", log)
	}
}

func TestARequestsLevelFollowsItsOutcome(t *testing.T) {
	for _, c := range []struct {
		method string
		status int
		want   slog.Level
	}{
		{http.MethodGet, http.StatusOK, slog.LevelDebug},
		{http.MethodGet, http.StatusNotModified, slog.LevelDebug},
		{http.MethodPost, http.StatusAccepted, slog.LevelInfo},
		{http.MethodGet, http.StatusNotFound, slog.LevelWarn},
		{http.MethodPut, http.StatusBadRequest, slog.LevelWarn},
		{http.MethodGet, http.StatusBadGateway, slog.LevelError},
	} {
		if got := front.RequestLevel(c.method, c.status); got != c.want {
			t.Errorf("%s %d: %v, want %v", c.method, c.status, got, c.want)
		}
	}
}

func TestLoopbackRedirectsIPToLocalhost(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodGet, "/app/library?x=1", nil)
	req.Host = "127.0.0.1:47821"
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPermanentRedirect || rec.Header().Get("Location") != localOrigin+"/app/library?x=1" {
		t.Fatalf("redirect: %d %q", rec.Code, rec.Header().Get("Location"))
	}
}

func TestHomeNetworkSendsOtherHostsToItsName(t *testing.T) {
	e := newEnv(t)
	h := front.Handler(front.Options{
		Listener:  front.Listener{Origin: "https://studio.example.test:47843", ExpectedHost: "studio.example.test:47843"},
		WrongHost: "Phospheare answers only at its home-network name.",
		Identity:  e.id,
		SPA:       testSPA,
	})
	req := httptest.NewRequest(http.MethodGet, "/app", nil)
	req.Host = "192.168.1.20:47843"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body := rec.Body.String()
	if rec.Code != http.StatusMisdirectedRequest || !strings.Contains(body, "home-network name") || !strings.Contains(body, "https://studio.example.test:47843/") {
		t.Fatalf("wrong-host page: %d %s", rec.Code, body)
	}
	req = httptest.NewRequest(http.MethodGet, "/desktop/setup/", nil)
	req.Host = "studio.example.test:47843"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("the home network reached a desktop path: %d", rec.Code)
	}
}

// This computer opening the home address is sent to its loopback address,
// path and query kept; every other device is served.
func TestHomeNetworkSendsThisComputerToItsLoopbackAddress(t *testing.T) {
	e := newEnv(t)
	h := front.Handler(front.Options{
		Listener: front.Listener{Origin: "https://studio.example.test", ExpectedHost: "studio.example.test"},
		Identity: e.id,
		SPA:      testSPA,
		FromThisComputer: func(remote, local string) bool {
			return strings.HasPrefix(remote, "192.168.1.20:") && local == "192.168.1.20:8443"
		},
		LocalOrigin: "http://localhost:47821",
	})
	reached := &net.TCPAddr{IP: net.ParseIP("192.168.1.20"), Port: 8443}
	req := httptest.NewRequest(http.MethodGet, "/app/library?x=1", nil)
	req = req.WithContext(context.WithValue(req.Context(), http.LocalAddrContextKey, reached))
	req.Host = "studio.example.test"
	req.RemoteAddr = "192.168.1.20:51000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTemporaryRedirect || rec.Header().Get("Location") != "http://localhost:47821/app/library?x=1" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("this computer: %d %q %q", rec.Code, rec.Header().Get("Location"), rec.Header().Get("Cache-Control"))
	}
	req.RemoteAddr = "192.168.1.31:51000"
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("a phone: %d", rec.Code)
	}
}

// Without a Google client the SPA opens all the same and writes in Local
// Storage; only the identity routes say Google is not set up.
func TestSPAOpensBeforeSetup(t *testing.T) {
	e := newEnv(t)
	e.configured = false
	e.id.target = nil
	for _, p := range []string{"/", "/app", "/assets/app-abc123.js"} {
		if rec := get(e, p); rec.Code != http.StatusOK {
			t.Fatalf("%s before setup: %d", p, rec.Code)
		}
	}
	if rec := get(e, "/desktop/setup/"); rec.Body.String() != "desktop" {
		t.Fatalf("the setup page: %d", rec.Code)
	}
	if rec := get(e, "/identity/session"); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "\"google-not-configured\"") {
		t.Fatalf("identity before setup: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDevModeServesNoSPA(t *testing.T) {
	e := newEnv(t)
	h := front.Handler(front.Options{Listener: front.Listener{Origin: "http://localhost:5173"}, Identity: e.id})
	req := httptest.NewRequest(http.MethodGet, "/app", nil)
	req.Host = "localhost:47821"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "Development mode serves only /identity/ and /desktop/") {
		t.Fatalf("dev mode: %d %s", rec.Code, rec.Body.String())
	}
}

// The desktop serves the SPA with its security headers, and the
// connect path without the opener policy.
func TestSPAHeaders(t *testing.T) {
	want := map[string]string{
		"X-Content-Type-Options":       "nosniff",
		"X-Frame-Options":              "DENY",
		"Referrer-Policy":              "no-referrer",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Permissions-Policy":           "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
		"Content-Security-Policy":      "frame-ancestors 'none'; form-action 'self'",
		"Cross-Origin-Embedder-Policy": "credentialless",
		"Cross-Origin-Opener-Policy":   "same-origin-allow-popups",
	}
	e := newEnv(t)
	for path, cache := range map[string]string{
		"/":                     "no-cache",
		"/app/editor/demo":      "no-cache",
		"/assets/app-abc123.js": "public, max-age=31536000, immutable",
		"/app/connect/x":        "no-cache",
	} {
		rec := get(e, path)
		for name, value := range want {
			if name == "Cross-Origin-Opener-Policy" && strings.HasPrefix(path, "/app/connect/") {
				value = ""
			}
			if got := rec.Header().Get(name); got != value {
				t.Fatalf("%s: %s = %q, want %q", path, name, got, value)
			}
		}
		if got := rec.Header().Get("Cache-Control"); got != cache {
			t.Fatalf("%s: Cache-Control = %q, want %q", path, got, cache)
		}
	}
}

// A path the router does not take for an identity route, such as an
// encoded slash, is served by the SPA and carries the SPA's headers; the
// headers follow the handler that answers, never a second reading of the
// path.
func TestAnEncodedSlashGetsTheHeadersOfWhatServesIt(t *testing.T) {
	e := newEnv(t)
	rec := get(e, "/identity%2Fx")
	if rec.Code == http.StatusOK {
		if rec.Header().Get("Cross-Origin-Embedder-Policy") != "credentialless" || rec.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatalf("SPA answer without the SPA headers: %v", rec.Header())
		}
	} else if rec.Header().Get("X-Frame-Options") != "DENY" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("%d without the base headers: %v", rec.Code, rec.Header())
	}
	for _, p := range []string{"/desktop", "/identity"} {
		if rec := get(e, p); rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("%s: %d without the base headers: %v", p, rec.Code, rec.Header())
		}
	}
}

// The identity service's answers pass with its headers alone, while the
// desktop's own answer for a service that is down carries the base set.
func TestIdentityAnswersCarryNoDesktopHeaders(t *testing.T) {
	e := newEnv(t)
	if rec := get(e, "/identity/session"); rec.Header().Get("X-Frame-Options") != "" || rec.Header().Get("Permissions-Policy") != "" {
		t.Fatalf("desktop headers on an identity answer: %v", rec.Header())
	}
	e.id.target = nil
	if rec := get(e, "/identity/session"); rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("the down answer lacks the base headers: %v", rec.Header())
	}
}

// Only an HTTPS listener asks the browser to keep to HTTPS.
func TestTransportSecurityOnlyOnHTTPS(t *testing.T) {
	e := newEnv(t)
	for _, p := range []string{"/app", "/desktop/setup/", "/identity/session"} {
		if got := get(e, p).Header().Get("Strict-Transport-Security"); got != "" {
			t.Fatalf("loopback %s: %q", p, got)
		}
	}
	home := front.Handler(front.Options{
		Listener:   front.Listener{Origin: "https://rossi-studio.dedyn.io:47843", ExpectedHost: "rossi-studio.dedyn.io:47843"},
		Identity:   e.id,
		Configured: func() bool { return true },
		SPA:        testSPA,
		HTTPS:      true,
	})
	for _, p := range []string{"/app", "/identity/session", "/desktop/setup/"} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		req.Host = "rossi-studio.dedyn.io:47843"
		rec := httptest.NewRecorder()
		home.ServeHTTP(rec, req)
		if got := rec.Header().Values("Strict-Transport-Security"); len(got) != 1 || got[0] != "max-age=31536000" {
			t.Fatalf("home network %s: %q", p, got)
		}
	}
}
