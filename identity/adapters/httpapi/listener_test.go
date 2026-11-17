// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/perseomazzoni/phospheare/identity/adapters/httpapi"
	"github.com/perseomazzoni/phospheare/identity/domain"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// ── Cross-site guard ─────────────────────────────────────────────────────────

func TestGuardRefusesMissingHeaderAndCrossSite(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	body := map[string]string{"writerId": "writer-a"}
	expectProblem(t, b.request(http.MethodPost, "/identity/session", body, "X-Phospheare", ""), http.StatusForbidden, "csrf-refused")
	expectProblem(t, b.request(http.MethodPost, "/identity/session", body, "X-Phospheare", "0"), http.StatusForbidden, "csrf-refused")
	expectProblem(t, b.request(http.MethodPost, "/identity/session", body, "Sec-Fetch-Site", "cross-site"), http.StatusForbidden, "csrf-refused")
	expectProblem(t, b.request(http.MethodPost, "/identity/session", body, "Sec-Fetch-Site", "same-site"), http.StatusForbidden, "csrf-refused")
	expectProblem(t, b.request(http.MethodDelete, "/identity/session", nil, "Origin", "https://evil.example.test"), http.StatusForbidden, "csrf-refused")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{}, "X-Phospheare", ""), http.StatusForbidden, "csrf-refused")
	if _, set := b.cookies["phospheare_session"]; set {
		t.Fatal("a refused request opened a session")
	}
	if rec := b.request(http.MethodPost, "/identity/session", body, "Sec-Fetch-Site", "", "Origin", localOrigin); rec.Code != http.StatusOK {
		t.Fatalf("a same-origin request without Sec-Fetch-Site: %d", rec.Code)
	}
}

// ── Host check ───────────────────────────────────────────────────────────────

func TestForeignHostGetsTheWrongAddressPage(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodGet, "/identity/session", nil)
	req.Host = "127.0.0.1:47821"
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMisdirectedRequest || !strings.Contains(rec.Body.String(), localOrigin+"/") {
		t.Fatalf("wrong-address page: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Location") != "" {
		t.Fatal("the identity service redirected another host")
	}
}

func TestHostCheckRefusesForeignHost(t *testing.T) {
	e := newEnv(t)
	for _, host := range []string{"evil.example.test:47821", "localhost:1234", ""} {
		req := httptest.NewRequest(http.MethodGet, "/identity/session", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		e.h.ServeHTTP(rec, req)
		if rec.Code != http.StatusMisdirectedRequest {
			t.Fatalf("host %q: %d", host, rec.Code)
		}
	}
}

func httpsHandler(e *env) http.Handler {
	return e.host.Handler(httpapi.Listener{
		Origin:       "https://studio.example.test",
		ExpectedHost: "studio.example.test",
		Secure:       true,
	})
}

func TestHTTPSListenerSetsSecureCookies(t *testing.T) {
	e := newEnv(t)
	b := &browser{t: t, h: httpsHandler(e), host: "studio.example.test", cookies: map[string]string{}, lastSet: map[string]*http.Cookie{}}
	b.openSession("writer-a")
	if c := b.lastSet["phospheare_session"]; !c.Secure {
		t.Fatal("the HTTPS session cookie is not Secure")
	}
	flowID, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	if q.Get("redirect_uri") != "https://studio.example.test/identity/google/callback" {
		t.Fatalf("redirect uri %q", q.Get("redirect_uri"))
	}
	if !b.lastSet["phospheare_flow_"+flowID].Secure {
		t.Fatal("the HTTPS flow cookie is not Secure")
	}
}

func TestWrongAddressPageLinksTheOrigin(t *testing.T) {
	e := newEnv(t)
	req := httptest.NewRequest(http.MethodGet, "/app", nil)
	req.Host = "192.168.1.20"
	rec := httptest.NewRecorder()
	httpsHandler(e).ServeHTTP(rec, req)
	if rec.Code != http.StatusMisdirectedRequest || !strings.Contains(rec.Body.String(), "https://studio.example.test/") {
		t.Fatalf("wrong-address page: %d %s", rec.Code, rec.Body.String())
	}
}

func TestDevModeServesOnlyIdentityRoutesAndChecksDevOrigin(t *testing.T) {
	e := newEnv(t)
	h := e.host.Handler(httpapi.Listener{Origin: "http://localhost:5173"})
	b := &browser{t: t, h: h, host: "localhost:47821", cookies: map[string]string{}, lastSet: map[string]*http.Cookie{}}
	if rec := b.request(http.MethodGet, "/app", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("dev mode served the SPA: %d", rec.Code)
	}
	if rec := b.request(http.MethodPost, "/identity/session", map[string]string{"writerId": "w"}, "Origin", "http://localhost:5173"); rec.Code != http.StatusOK {
		t.Fatalf("dev origin refused: %d %s", rec.Code, rec.Body.String())
	} else {
		b.proof = decode(t, rec)["proof"].(string)
	}
	expectProblem(t, b.request(http.MethodPost, "/identity/session", map[string]string{"writerId": "w"}, "Origin", localOrigin), http.StatusForbidden, "csrf-refused")
	_, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "w"})
	if q.Get("redirect_uri") != "http://localhost:5173/identity/google/callback" {
		t.Fatalf("redirect uri %q", q.Get("redirect_uri"))
	}
}

// ── Scope and logging ────────────────────────────────────────────────────────

func TestServesNothingOutsideItsPrefix(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	for _, path := range []string{"/host/info", "/app", "/desktop/setup/"} {
		if rec := b.request(http.MethodGet, path, nil); rec.Code != http.StatusNotFound {
			t.Fatalf("%s: %d", path, rec.Code)
		}
	}
	expectProblem(t, b.request(http.MethodGet, "/identity/info", nil), http.StatusNotFound, "not-found")
}

func TestLogsCarryNoQueryCodeOrToken(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	e.connectDrive(b, "writer-a", "sub-a")
	b.request(http.MethodGet, "/identity/google/callback?state=s&code=very-secret-code", nil)
	logs := e.logs.String()
	for _, secret := range []string{"very-secret-code", "state=", "refresh-", "access-", "@example.test", "phospheare_session"} {
		if strings.Contains(logs, secret) {
			t.Fatalf("the log carries %q:\n%s", secret, logs)
		}
	}
	if !strings.Contains(logs, `msg="GET /identity/google/callback" status=200`) ||
		!strings.Contains(logs, `msg="POST /identity/session" status=200`) ||
		!strings.Contains(logs, `msg="POST /identity/google/flows/{flowId}/finish" status=200`) {
		t.Fatalf("the log misses request lines:\n%s", logs)
	}
	// Google's redirect carries no session proof; the flow's own cookie
	// names the account.
	named := false
	for line := range strings.SplitSeq(logs, "\n") {
		if strings.Contains(line, `msg="GET /identity/google/callback" status=200`) && strings.Contains(line, "account=writer-a") {
			named = true
		}
	}
	if !named {
		t.Fatalf("no callback line names the account:\n%s", logs)
	}
}

func TestUnknownIdentityRouteIsProblem(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	expectProblem(t, b.request(http.MethodGet, "/identity/nothing", nil), http.StatusNotFound, "not-found")
}

// ── Origins ──────────────────────────────────────────────────────────────────

func TestOneServiceAnswersEveryListedOrigin(t *testing.T) {
	e := newEnv(t)
	local, _ := domain.ParseOrigin(localOrigin)
	public, _ := domain.ParseOrigin("https://studio.example.test")
	h := e.host.Handler(httpapi.ListenerFor(local), httpapi.ListenerFor(public))
	for host, origin := range map[string]string{localHost: localOrigin, "studio.example.test": "https://studio.example.test"} {
		b := &browser{t: t, h: h, host: host, cookies: map[string]string{}, lastSet: map[string]*http.Cookie{}}
		b.openSession("writer-a")
		if b.lastSet["phospheare_session"].Secure != strings.HasPrefix(origin, "https:") {
			t.Fatalf("%s: session cookie Secure %v", host, b.lastSet["phospheare_session"].Secure)
		}
		_, q := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
		if q.Get("redirect_uri") != origin+"/identity/google/callback" {
			t.Fatalf("%s: redirect uri %q", host, q.Get("redirect_uri"))
		}
		expectProblem(t, b.request(http.MethodDelete, "/identity/session", nil, "Origin", "http://other.example.test"), http.StatusForbidden, "csrf-refused")
	}
	req := httptest.NewRequest(http.MethodGet, "/identity/session", nil)
	req.Host = "evil.example.test"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMisdirectedRequest || !strings.Contains(rec.Body.String(), localOrigin+"/") {
		t.Fatalf("unlisted host: %d %s", rec.Code, rec.Body.String())
	}
}

// ── Observer ─────────────────────────────────────────────────────────────────

func TestRequestIDIsKeptOrMade(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	if rec := b.request(http.MethodGet, "/identity/session", nil, "X-Request-Id", "lb-1234.abc"); rec.Header().Get("X-Request-Id") != "lb-1234.abc" {
		t.Fatalf("kept id %q", rec.Header().Get("X-Request-Id"))
	}
	for _, bad := range []string{"", "has space", strings.Repeat("x", 129), "<script>"} {
		rec := b.request(http.MethodGet, "/identity/session", nil, "X-Request-Id", bad)
		if got := rec.Header().Get("X-Request-Id"); got == "" || got == bad {
			t.Fatalf("id for %q: %q", bad, got)
		}
	}
	if !strings.Contains(e.logs.String(), "requestId=lb-1234.abc") {
		t.Fatalf("the log misses the request id:\n%s", e.logs.String())
	}
}

// A request line names the writer account its sealed session acts for;
// an id the request only states is never written.
func TestARequestLineNamesTheSessionsAccount(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.request(http.MethodGet, "/identity/session", nil)
	b.openSession("writer-a")
	b.request(http.MethodGet, "/identity/session", nil)
	proof := b.proof
	// The cookie without its proof is no session.
	b.proof = ""
	b.request(http.MethodGet, "/identity/session", nil)
	b.proof = proof
	// Another browser states an account it has no session for.
	other := e.browser()
	other.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "identity", "writerId": "writer-z"})

	var got []string
	for line := range strings.SplitSeq(strings.TrimSpace(e.logs.String()), "\n") {
		if !strings.Contains(line, "requestId=") {
			continue
		}
		account := "-"
		if _, after, ok := strings.Cut(line, " account="); ok {
			account, _, _ = strings.Cut(after, " ")
		}
		msg, _, _ := strings.Cut(line[strings.Index(line, "msg=")+4:], " status=")
		got = append(got, msg+" "+account)
	}
	want := []string{
		`"GET /identity/session" -`,
		`"POST /identity/session" writer-a`,
		`"GET /identity/session" writer-a`,
		`"GET /identity/session" -`,
		`"POST /identity/google/flows" -`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("lines\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// failingSeal refuses every seal, as a broken keyring would.
type failingSeal struct{ ports.Sealer }

func (failingSeal) Seal(string, any) (string, error) { return "", errors.New("no key") }

// A session whose seal fails names no account: the id came from the body
// and was never sealed.
func TestAFailedSealNamesNoAccount(t *testing.T) {
	e := newEnv(t)
	e.host.Sealer = failingSeal{e.sealer}
	rec := e.browser().request(http.MethodPost, "/identity/session", map[string]string{"writerId": "writer-q"})
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", rec.Code)
	}
	if strings.Contains(e.logs.String(), "writer-q") {
		t.Fatalf("the log names the unsealed account:\n%s", e.logs.String())
	}
}

func TestIdentityBodiesAreCapped(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	body := map[string]string{"writerId": "w", "pad": strings.Repeat("x", 20<<10)}
	expectProblem(t, b.request(http.MethodPost, "/identity/session", body), http.StatusBadRequest, "bad-request")
}

func TestARequestsLevelFollowsItsOutcome(t *testing.T) {
	for _, c := range []struct {
		method string
		status int
		want   slog.Level
	}{
		{http.MethodGet, http.StatusOK, slog.LevelDebug},
		{http.MethodPost, http.StatusOK, slog.LevelInfo},
		{http.MethodPost, http.StatusGone, slog.LevelWarn},
		{http.MethodGet, http.StatusServiceUnavailable, slog.LevelError},
	} {
		if got := httpapi.RequestLevel(c.method, c.status); got != c.want {
			t.Errorf("%s %d: %v, want %v", c.method, c.status, got, c.want)
		}
	}
}

func TestRequestsAreLoggedByRoutePattern(t *testing.T) {
	e := newEnv(t)
	logs := e.logs
	b := &browser{t: t, h: e.host.Handler(e.l), host: localHost, cookies: map[string]string{}, lastSet: map[string]*http.Cookie{}}
	b.request(http.MethodPost, "/identity/google/flows/AAAAAAAAAAAAAAAAAAAAAA/finish", nil)
	b.request(http.MethodGet, "/elsewhere", nil)
	for _, want := range []string{
		`msg="POST /identity/google/flows/{flowId}/finish" status=410`,
		`msg="GET /" status=404`,
	} {
		if !strings.Contains(logs.String(), want) {
			t.Fatalf("the log misses %q:\n%s", want, logs.String())
		}
	}
	if strings.Contains(logs.String(), "AAAAAAAAAAAAAAAAAAAAAA") {
		t.Fatalf("the log names the path:\n%s", logs.String())
	}
}
