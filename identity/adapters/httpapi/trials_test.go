// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"context"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/perseomazzoni/phospheare/identity/adapters/httpapi"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// fakeDriveAPI is Google Drive's files endpoint as a trial meets it: it
// records the tokens it is called with and answers err.
type fakeDriveAPI struct {
	mu     sync.Mutex
	err    error
	tokens []string
}

func (d *fakeDriveAPI) Probe(ctx context.Context, accessToken string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.tokens = append(d.tokens, accessToken)
	return d.err
}

// beginTrial starts a trial and answers its id and the authorize URL's query.
func (b *browser) beginTrial() (string, url.Values) {
	b.t.Helper()
	rec := b.request(http.MethodPost, "/identity/google/trials", nil)
	if rec.Code != http.StatusOK {
		b.t.Fatalf("begin trial: %d %s", rec.Code, rec.Body.String())
	}
	out := decode(b.t, rec)
	u, err := url.Parse(out["authorizeUrl"].(string))
	if err != nil {
		b.t.Fatal(err)
	}
	return out["flowId"].(string), u.Query()
}

func (b *browser) finishTrial(flowID string) map[string]any {
	b.t.Helper()
	rec := b.request(http.MethodPost, "/identity/google/trials/"+flowID+"/finish", nil)
	if rec.Code != http.StatusOK {
		b.t.Fatalf("finish trial: %d %s", rec.Code, rec.Body.String())
	}
	return decode(b.t, rec)
}

func TestTrialProvesTheSetupAndKeepsNoToken(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	flowID, q := b.beginTrial()
	if q.Get("scope") != "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata" ||
		q.Get("prompt") != "select_account consent" || q.Has("access_type") || q.Has("include_granted_scopes") ||
		q.Get("redirect_uri") != localOrigin+"/identity/google/callback" || q.Get("code_challenge_method") != "S256" {
		t.Fatalf("authorize query %v", q)
	}

	page := e.consent(b, q, "trial-code-1", grant{sub: "sub-t", email: "t@example.test", scope: driveScope, noRefresh: true})
	body := page.Body.String()
	if !strings.Contains(body, `data-status="done"`) || !strings.Contains(body, `data-return=""`) || strings.Contains(body, "access-") {
		t.Fatalf("callback page: %s", body)
	}
	if !slices.Equal(e.drive.tokens, []string{"access-sub-t"}) {
		t.Fatalf("drive called with %v", e.drive.tokens)
	}
	if len(e.google.revoked) != 0 {
		t.Fatalf("a trial revoked %v, which ends the account's whole grant", e.google.revoked)
	}

	report := b.finishTrial(flowID)
	if report["result"] != "ok" || report["email"] != "t@example.test" || len(report) != 2 {
		t.Fatalf("report %v", report)
	}
	for name := range b.cookies {
		if name == "phospheare_session" || strings.HasPrefix(name, "phospheare_g_") {
			t.Fatalf("a trial left cookie %s", name)
		}
	}
	if len(b.flowCookies()) != 0 {
		t.Fatal("finish leaves the trial's flow cookie")
	}
	expectProblem(t, b.request(http.MethodPost, "/identity/google/trials/"+flowID+"/finish", nil), http.StatusGone, "flow-expired")
}

func TestTrialReportsWhatIsWrong(t *testing.T) {
	cases := map[string]struct {
		set   func(e *env)
		scope string
		want  string
	}{
		"permissions left out": {scope: "openid email profile", want: "scope-missing"},
		"drive turned off":     {set: func(e *env) { e.drive.err = ports.ErrDriveOff }, want: "drive-off"},
		"drive refuses scope":  {set: func(e *env) { e.drive.err = ports.ErrDriveScope }, want: "scope-missing"},
		"drive unreachable":    {set: func(e *env) { e.drive.err = ports.ErrUnreachable }, want: "unreachable"},
		"wrong secret":         {set: func(e *env) { e.client.ClientSecret = "wrong" }, want: "client"},
		"google down":          {set: func(e *env) { e.google.unreachable = true }, want: "unreachable"},
	}
	for name, c := range cases {
		e := newEnv(t)
		b := e.browser()
		flowID, q := b.beginTrial()
		if c.set != nil {
			c.set(e)
		}
		scope := c.scope
		if scope == "" {
			scope = driveScope
		}
		e.consent(b, q, "trial-"+flowID, grant{sub: "sub-t", email: "t@example.test", scope: scope, noRefresh: true})
		if got := b.finishTrial(flowID)["result"]; got != c.want {
			t.Fatalf("%s: result %v, want %s", name, got, c.want)
		}
	}
}

func TestTrialCancelledAtGoogle(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	flowID, q := b.beginTrial()
	b.request(http.MethodGet, "/identity/google/callback?"+url.Values{"state": {q.Get("state")}, "error": {"access_denied"}}.Encode(), nil)
	if got := b.finishTrial(flowID); got["result"] != "cancelled" || got["email"] != nil {
		t.Fatalf("report %v", got)
	}
	if len(e.drive.tokens) != 0 {
		t.Fatal("a cancelled trial called Drive")
	}
}

func TestTrialFinishBeforeCallbackIsPending(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	flowID, _ := b.beginTrial()
	expectProblem(t, b.request(http.MethodPost, "/identity/google/trials/"+flowID+"/finish", nil), http.StatusConflict, "flow-pending")
	if len(b.flowCookies()) != 1 {
		t.Fatal("a pending trial lost its flow cookie")
	}
}

func TestTrialCannotFinishAsASignIn(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.beginTrial()
	e.consent(b, q, "trial-code-2", grant{sub: "sub-t", email: "t@example.test", scope: driveScope, noRefresh: true})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusBadRequest, "bad-request")
}

func TestSignInFlowCannotFinishAsATrial(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, _ := b.authorize(map[string]string{"purpose": "identity", "writerId": "writer-a"})
	expectProblem(t, b.request(http.MethodPost, "/identity/google/trials/"+flowID+"/finish", nil), http.StatusBadRequest, "bad-request")
}

func TestTrialNeedsGoogleConfigured(t *testing.T) {
	e := newEnv(t)
	e.client.ClientID = ""
	expectProblem(t, e.browser().request(http.MethodPost, "/identity/google/trials", nil), http.StatusServiceUnavailable, "google-not-configured")
}

func TestTrialIsServedOnlyOnTheComputer(t *testing.T) {
	e := newEnv(t)
	home := httpapi.Listener{Origin: "https://rossi-studio.dedyn.io:47843", ExpectedHost: "rossi-studio.dedyn.io:47843", Secure: true}
	b := e.browser()
	b.h, b.host = e.host.Handler(home), home.ExpectedHost
	headers := []string{"Origin", home.Origin}
	expectProblem(t, b.request(http.MethodPost, "/identity/google/trials", nil, headers...), http.StatusNotFound, "not-found")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/trials/AAAAAAAAAAAAAAAAAAAAAA/finish", nil, headers...), http.StatusNotFound, "not-found")
}
