// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"maps"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/httpapi"
	"github.com/perseomazzoni/phospheare/identity/domain"
)

// Pins the session proof: a browser sends localhost cookies to every port of
// the host, so another program on the computer can receive the session and
// connection cookies and replay them. Without the proof the SPA keeps in its
// origin's storage, they open nothing.

// thief answers a client holding b's cookies but not its proof.
func (b *browser) thief() *browser {
	return &browser{t: b.t, h: b.h, host: b.host, cookies: maps.Clone(b.cookies), lastSet: map[string]*http.Cookie{}}
}

func TestReplayedCookiesWithoutTheProofOpenNothing(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	for _, proof := range []string{"", "not-the-proof", b.proof[:len(b.proof)-1]} {
		x := b.thief()
		x.proof = proof
		expectNoSession(t, x.request(http.MethodGet, "/identity/session", nil))
		expectProblem(t, x.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}), http.StatusUnauthorized, "no-session")
		expectProblem(t, x.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "identity", "writerId": "writer-a"}), http.StatusUnauthorized, "no-session")
		expectProblem(t, x.request(http.MethodDelete, "/identity/google/connections/"+id, map[string]bool{"revoke": true}), http.StatusUnauthorized, "no-session")
	}
	if len(e.google.revoked) != 0 {
		t.Fatal("a replayed cookie revoked the grant")
	}
	if rec := b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}); rec.Code != http.StatusOK {
		t.Fatalf("the proof holder lost its token: %d %s", rec.Code, rec.Body.String())
	}
}

func TestFinishWithoutTheProofIsSessionMismatch(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	e.consent(b, q, "code", grant{sub: "sub-a", scope: driveScope})
	x := b.thief()
	expectProblem(t, x.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-session-mismatch")
	for name := range x.cookies {
		if strings.HasPrefix(name, "phospheare_g_") {
			t.Fatal("a finish without the proof sealed a connection")
		}
	}
}

func TestReopenWithoutTheProofStartsAnotherSession(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	first, proof := b.cookies["phospheare_session"], b.proof
	b.proof = ""
	b.openSession("writer-a")
	if b.cookies["phospheare_session"] == first || b.proof == proof {
		t.Fatal("a reopen without the proof answered the open session's proof")
	}
	b.proof = proof
	expectNoSession(t, b.request(http.MethodGet, "/identity/session", nil))
}

func TestReopenWithTheProofAnswersTheSameProof(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	proof := b.proof
	b.openSession("writer-a")
	if b.proof != proof {
		t.Fatal("a second tab of the same writer was handed another proof")
	}
}

func TestSessionOlderThanThirtyDaysIsNoSession(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	id := e.connectDrive(b, "writer-a", "sub-a")["connection"].(map[string]any)["connectionId"].(string)
	e.skew = 30*24*time.Hour - time.Minute
	if rec := b.request(http.MethodGet, "/identity/session", nil); rec.Code != http.StatusOK {
		t.Fatalf("a session inside its thirty days: %d %s", rec.Code, rec.Body.String())
	}
	e.skew = 30 * 24 * time.Hour
	expectNoSession(t, b.request(http.MethodGet, "/identity/session", nil))
	expectProblem(t, b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}), http.StatusUnauthorized, "no-session")
	b.openSession("writer-a")
	if rec := b.request(http.MethodPost, "/identity/google/token", map[string]string{"connectionId": id}); rec.Code != http.StatusOK {
		t.Fatalf("token after reopening: %d %s", rec.Code, rec.Body.String())
	}
}

func TestSessionSealedWithoutProofIsNoSession(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	sealed, err := e.sealer.Seal("phospheare_session", domain.SessionClaims{SID: "sid", WriterID: "writer-a", IAT: time.Now().Unix()})
	if err != nil {
		t.Fatal(err)
	}
	b.cookies["phospheare_session"] = sealed
	b.proof = "anything"
	expectNoSession(t, b.request(http.MethodGet, "/identity/session", nil))
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "identity", "writerId": "writer-a"}), http.StatusUnauthorized, "no-session")
}

func TestCloseSessionNeedsNoProof(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	b.proof = ""
	if rec := b.request(http.MethodDelete, "/identity/session", nil); rec.Code != http.StatusNoContent || b.lastSet["phospheare_session"].MaxAge >= 0 {
		t.Fatalf("close: %d", rec.Code)
	}
}

// ── Flow purposes and cancellation ───────────────────────────────────────────

func TestBeginRefusesTheTrialPurpose(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows", map[string]string{"purpose": "trial", "writerId": "writer-a"}), http.StatusBadRequest, "bad-request")
	if len(b.flowCookies()) != 0 {
		t.Fatal("a refused trial left a flow cookie")
	}
}

func TestTrialCallbackRunsOnlyOnTheComputer(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	_, q := b.beginTrial()
	home := httpapi.Listener{Origin: "https://rossi-studio.dedyn.io:47843", ExpectedHost: "rossi-studio.dedyn.io:47843", Secure: true}
	b.h, b.host = e.host.Handler(home), home.ExpectedHost
	page := e.consent(b, q, "trial-code", grant{sub: "sub-t", email: "t@example.test", scope: driveScope, noRefresh: true})
	if !strings.Contains(page.Body.String(), `data-status="expired"`) || len(e.drive.tokens) != 0 || len(e.google.codes) != 1 {
		t.Fatalf("a trial ran on the home network: %s", page.Body.String())
	}
}

func TestCallbackCancelledAtGoogle(t *testing.T) {
	e := newEnv(t)
	b := e.browser()
	b.openSession("writer-a")
	flowID, q := b.authorize(map[string]string{"purpose": "drive", "writerId": "writer-a", "expectedSub": "sub-a"})
	cancel := "/identity/google/callback?" + url.Values{"state": {q.Get("state")}, "error": {"access_denied"}}.Encode()
	for range 2 {
		page := b.request(http.MethodGet, cancel, nil).Body.String()
		if !strings.Contains(page, `data-status="cancelled"`) || !strings.Contains(page, "Google sign-in was cancelled.") {
			t.Fatalf("callback page: %s", page)
		}
	}
	expectProblem(t, b.request(http.MethodPost, "/identity/google/flows/"+flowID+"/finish", nil), http.StatusConflict, "flow-cancelled")
	if len(b.flowCookies()) != 0 {
		t.Fatal("a cancelled flow keeps its cookie")
	}
}
