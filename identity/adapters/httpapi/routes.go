// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/problem"
	"github.com/perseomazzoni/phospheare/identity/application"
	"github.com/perseomazzoni/phospheare/identity/domain"
)

// ── Cookies and sealing ──────────────────────────────────────────────────────

const (
	sessionCookie    = "phospheare_session"
	flowPrefix       = "phospheare_flow_"
	connectionPrefix = "phospheare_g_"

	sealSession    = "phospheare_session"
	sealFlow       = "phospheare_flow"
	sealConnection = "phospheare_g"

	// googlePath scopes the flow and connection cookies to the Google
	// routes, so no other request carries their tokens.
	googlePath = "/identity/google"

	// cookieMaxAge is 400 days, the longest lifetime browsers keep, for the
	// Drive connections.
	cookieMaxAge = 400 * 24 * 60 * 60

	// sessionMaxAge matches the sealed session's own lifetime. The writer
	// session outlives a browser restart, as the SPA's session does.
	sessionMaxAge = int(domain.SessionLifetime / time.Second)

	// SessionHeader carries the session proof on every call that uses the
	// writer session.
	SessionHeader = "X-Phospheare-Session"
)

func setCookie(w http.ResponseWriter, l Listener, name, value, path string, maxAge int, sameSite http.SameSite) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   l.Secure,
		SameSite: sameSite,
	})
}

func clearCookie(w http.ResponseWriter, l Listener, name, path string, sameSite http.SameSite) {
	setCookie(w, l, name, "", path, -1, sameSite)
}

// session answers the writer session the request's cookie seals when the
// request's SessionHeader carries its proof, or nil. A cookie alone is not
// a session (`domain.SessionClaims.Admits`).
func (h *Host) session(r *http.Request) *domain.Session {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return nil
	}
	var s domain.SessionClaims
	if h.Sealer.Open(sealSession, c.Value, &s) != nil {
		return nil
	}
	admitted := h.OAuth.Admit(s, r.Header.Get(SessionHeader))
	if admitted != nil {
		noteAccount(r, admitted.WriterID)
	}
	return admitted
}

// flow opens the flow this browser carries under id, or nil. Each flow has
// its own cookie, so two tabs' flows stay apart.
func (h *Host) flow(r *http.Request, id string) *domain.Flow {
	if !domain.FlowIDPattern.MatchString(id) {
		return nil
	}
	c, err := r.Cookie(flowPrefix + id)
	if err != nil {
		return nil
	}
	var f domain.Flow
	if h.Sealer.Open(sealFlow, c.Value, &f) != nil || f.ID != id {
		return nil
	}
	noteAccount(r, f.WriterID)
	return &f
}

// setFlow seals f into its cookie for the rest of its lifetime. The cookie
// is `SameSite=Lax`: Google's redirect to the callback is a cross-site
// navigation, which a `Strict` cookie would miss.
func (h *Host) setFlow(w http.ResponseWriter, l Listener, f domain.Flow) bool {
	sealed, err := h.Sealer.Seal(sealFlow, f)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return false
	}
	left := int(h.OAuth.Left(f) / time.Second)
	if left <= 0 {
		left = -1
	}
	setCookie(w, l, flowPrefix+f.ID, sealed, googlePath, left, http.SameSiteLaxMode)
	return true
}

func readJSON(r *http.Request, v any) bool {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return false
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		body = []byte("{}")
	}
	return json.Unmarshal(body, v) == nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

var refusals = map[string]struct {
	status int
	title  string
}{
	domain.CodeBadRequest:        {http.StatusBadRequest, "The request is malformed"},
	domain.CodeNoSession:         {http.StatusUnauthorized, "No writer session is open"},
	domain.CodeWriterMismatch:    {http.StatusForbidden, "The open session belongs to another writer"},
	domain.CodeNotConfigured:     {http.StatusServiceUnavailable, "Google is not configured on this service"},
	domain.CodeFlowExpired:       {http.StatusGone, "The authorization has expired"},
	domain.CodeFlowPending:       {http.StatusConflict, "The authorization has not returned yet"},
	domain.CodeFlowFailed:        {http.StatusConflict, "The authorization did not complete"},
	domain.CodeFlowCancelled:     {http.StatusConflict, "The authorization was declined at Google"},
	domain.CodeSessionMismatch:   {http.StatusConflict, "The authorization belongs to another session"},
	domain.CodeAccountMismatch:   {http.StatusConflict, "Google answered for another account"},
	domain.CodeScopeMissing:      {http.StatusConflict, "Google did not grant the Drive permissions"},
	domain.CodeNoConnection:      {http.StatusNotFound, "No such Drive connection in this browser"},
	domain.CodeNoCredential:      {http.StatusNotFound, "No such kept credential in this browser"},
	domain.CodeGrantInvalid:      {http.StatusConflict, "Google no longer accepts this Drive grant"},
	domain.CodeGoogleUnreachable: {http.StatusBadGateway, "Google could not be reached"},
	domain.CodeGoogleRefused:     {http.StatusBadGateway, "Google refused the service's client configuration"},
	domain.CodeRateLimited:       {http.StatusTooManyRequests, "Too many requests from this address"},
}

const retryAfterSeconds = 30

func refuse(w http.ResponseWriter, code string) {
	r, ok := refusals[code]
	if !ok {
		r = refusals[domain.CodeFlowFailed]
		code = domain.CodeFlowFailed
	}
	retry := 0
	if code == domain.CodeGoogleUnreachable {
		retry = retryAfterSeconds
	}
	problem.WriteRetry(w, r.status, code, r.title, retry)
}

// refuseErr answers err's refusal, or a bare 500 for an error that is not
// one.
func refuseErr(w http.ResponseWriter, err error) {
	if code := domain.CodeOf(err); code != "" {
		refuse(w, code)
		return
	}
	http.Error(w, "internal error", http.StatusInternalServerError)
}

// ── Session ──────────────────────────────────────────────────────────────────

func (h *Host) getSession(w http.ResponseWriter, r *http.Request) {
	s := h.session(r)
	if s == nil {
		// A question with a valid answer, "none", asked by every page load
		// and after a restart of the service: not an error. The operations
		// that need a session still refuse with 401 no-session.
		writeJSON(w, http.StatusOK, map[string]any{"writerId": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"writerId": s.WriterID})
}

func (h *Host) openSession(w http.ResponseWriter, r *http.Request, l Listener) {
	var body struct {
		WriterID string `json:"writerId"`
	}
	if !readJSON(r, &body) {
		refuse(w, domain.CodeBadRequest)
		return
	}
	existing := h.session(r)
	claims, err := h.OAuth.OpenSession(existing, body.WriterID)
	if err != nil {
		refuseErr(w, err)
		return
	}
	if claims == nil {
		writeJSON(w, http.StatusOK, map[string]string{"proof": existing.Proof})
		return
	}
	sealed, err := h.Sealer.Seal(sealSession, *claims)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// The body's id is the session's only once it is sealed: a seal that
	// fails names no account.
	noteAccount(r, claims.WriterID)
	setCookie(w, l, sessionCookie, sealed, "/identity", sessionMaxAge, http.SameSiteStrictMode)
	writeJSON(w, http.StatusOK, map[string]string{"proof": claims.Proof})
}

// closeSession clears the session cookie without asking for the proof:
// clearing removes a credential from this browser and grants nothing.
func (h *Host) closeSession(w http.ResponseWriter, r *http.Request, l Listener) {
	clearCookie(w, l, sessionCookie, "/identity", http.SameSiteStrictMode)
	w.WriteHeader(http.StatusNoContent)
}

// ── Google flows ─────────────────────────────────────────────────────────────

func (h *Host) beginFlow(w http.ResponseWriter, r *http.Request, l Listener) {
	var body struct {
		Purpose     string `json:"purpose"`
		WriterID    string `json:"writerId"`
		ExpectedSub string `json:"expectedSub"`
		LoginHint   string `json:"loginHint"`
	}
	if !readJSON(r, &body) || len(body.ExpectedSub) > 255 || len(body.LoginHint) > 320 {
		refuse(w, domain.CodeBadRequest)
		return
	}
	s := h.session(r)
	if s == nil {
		refuse(w, domain.CodeNoSession)
		return
	}
	if body.WriterID != s.WriterID {
		refuse(w, domain.CodeWriterMismatch)
		return
	}
	f, authorizeURL, err := h.OAuth.Begin(application.BeginRequest{
		Purpose:     domain.Purpose(body.Purpose),
		Session:     *s,
		ExpectedSub: body.ExpectedSub,
		LoginHint:   body.LoginHint,
		RedirectURI: l.Origin + CallbackPath,
	})
	if err != nil {
		refuseErr(w, err)
		return
	}
	if !h.setFlow(w, l, f) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"flowId": f.ID, "authorizeUrl": authorizeURL})
}

func (h *Host) callback(w http.ResponseWriter, r *http.Request, l Listener) {
	q := r.URL.Query()
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	carried := h.flow(r, q.Get("state"))
	if carried != nil && carried.Purpose == domain.PurposeTrial && !l.Loopback {
		// The trial routes are loopback-only (`trials.go`).
		carried = nil
	}
	f, status := h.OAuth.Callback(ctx, carried, application.CallbackParams{
		State: q.Get("state"),
		Code:  q.Get("code"),
		Error: q.Get("error"),
	})
	flowID, trial := "", false
	if f != nil {
		// The outcome rides in the flow cookie until Finish reads it.
		if !h.setFlow(w, l, *f) {
			return
		}
		flowID, trial = f.ID, f.Purpose == domain.PurposeTrial
	}
	writeCallbackPage(w, h.ProductName, flowID, status, trial)
}

func (h *Host) finish(w http.ResponseWriter, r *http.Request, l Listener) {
	id := r.PathValue("flowId")
	res, keep, err := h.OAuth.Finish(h.flow(r, id), h.session(r))
	if !keep && domain.FlowIDPattern.MatchString(id) {
		if _, err := r.Cookie(flowPrefix + id); err == nil {
			clearCookie(w, l, flowPrefix+id, googlePath, http.SameSiteLaxMode)
		}
	}
	if err != nil {
		refuse(w, domain.CodeOf(err))
		return
	}
	if res.Identity != nil {
		writeJSON(w, http.StatusOK, map[string]any{"identity": res.Identity})
		return
	}
	g := res.Grant
	claims, err := h.OAuth.NewConnection(res.WriterID, g)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if !h.setConnection(w, l, claims) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"connection": map[string]any{
			"connectionId": claims.ConnectionID,
			"sub":          g.Sub,
			"email":        g.Email,
			"scopes":       g.Scopes,
		},
		"accessToken": g.AccessToken,
		"expiresIn":   g.ExpiresIn,
	})
}

func (h *Host) setConnection(w http.ResponseWriter, l Listener, c domain.ConnectionClaims) bool {
	sealed, err := h.Sealer.Seal(sealConnection, c)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return false
	}
	setCookie(w, l, connectionPrefix+c.ConnectionID, sealed, googlePath, cookieMaxAge, http.SameSiteStrictMode)
	return true
}

// connection opens the Drive connection cookie id names. The second result
// reports a cookie that is present but does not open.
func (h *Host) connection(r *http.Request, id string) (*domain.ConnectionClaims, bool) {
	c, err := r.Cookie(connectionPrefix + id)
	if err != nil {
		return nil, false
	}
	var cc domain.ConnectionClaims
	if h.Sealer.Open(sealConnection, c.Value, &cc) != nil || cc.ConnectionID != id || cc.RefreshToken == "" {
		return nil, true
	}
	return &cc, false
}

func (h *Host) token(w http.ResponseWriter, r *http.Request, l Listener) {
	var body struct {
		ConnectionID string `json:"connectionId"`
	}
	if !readJSON(r, &body) || !domain.ConnectionIDPattern.MatchString(body.ConnectionID) {
		refuse(w, domain.CodeBadRequest)
		return
	}
	s := h.session(r)
	if s == nil {
		refuse(w, domain.CodeNoSession)
		return
	}
	name := connectionPrefix + body.ConnectionID
	conn, broken := h.connection(r, body.ConnectionID)
	if conn == nil {
		if broken {
			clearCookie(w, l, name, googlePath, http.SameSiteStrictMode)
		}
		refuse(w, domain.CodeNoConnection)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	tok, rotated, err := h.OAuth.Refresh(ctx, *s, *conn)
	if err != nil {
		if domain.CodeOf(err) == domain.CodeGrantInvalid {
			clearCookie(w, l, name, googlePath, http.SameSiteStrictMode)
		}
		refuseErr(w, err)
		return
	}
	if rotated != nil && !h.setConnection(w, l, *rotated) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"accessToken": tok.AccessToken,
		"expiresIn":   tok.ExpiresIn,
		"scope":       tok.Scope,
	})
}

// disconnect clears a Drive connection. Clearing alone needs no session, as
// `closeSession` says; revoking at Google needs the writer's own session.
func (h *Host) disconnect(w http.ResponseWriter, r *http.Request, l Listener) {
	id := r.PathValue("connectionId")
	var body struct {
		Revoke bool `json:"revoke"`
	}
	if !domain.ConnectionIDPattern.MatchString(id) || !readJSON(r, &body) {
		refuse(w, domain.CodeBadRequest)
		return
	}
	name := connectionPrefix + id
	conn, _ := h.connection(r, id)
	revoked := false
	if body.Revoke && conn != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		var err error
		if revoked, err = h.OAuth.Revoke(ctx, h.session(r), *conn); err != nil {
			refuseErr(w, err)
			return
		}
	}
	clearCookie(w, l, name, googlePath, http.SameSiteStrictMode)
	writeJSON(w, http.StatusOK, map[string]bool{"revokedAtGoogle": revoked})
}
