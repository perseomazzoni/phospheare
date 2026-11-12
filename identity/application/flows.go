// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package application runs the identity service's use cases: the Google
// authorization flows, the writer session, the refresh and revocation of
// Drive connections, and the setup page's trial sign-in.
//
// The service keeps no state. A flow is a value the browser carries sealed
// between the steps, so its use cases take the flow in and answer the flow
// to keep. Flows are used once: Finish ends the flow whatever it answers,
// except while the callback has not run yet. A flow carries the session id
// and writer id that started it, so a grant that returns after the session
// ended or changed writer attaches to nobody. Tokens are held in a flow
// only between the callback and Finish.
package application

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strings"
	"time"

	"github.com/perseomazzoni/phospheare/identity/domain"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// BeginRequest starts a flow for the open session.
type BeginRequest struct {
	Purpose     domain.Purpose
	Session     domain.Session
	ExpectedSub string
	LoginHint   string
	RedirectURI string
}

// Callback outcomes posted to the page that opened the flow.
const (
	CallbackDone      = "done"
	CallbackFailed    = "failed"
	CallbackCancelled = "cancelled"
	CallbackExpired   = "expired"
)

// DefaultFlowTTL is how long a Google authorization may take, from its
// start to Finish.
const DefaultFlowTTL = 10 * time.Minute

// Service runs the identity service's use cases against Google.
type Service struct {
	Google  ports.Google
	Clients ports.ClientSource
	// Drive is what a trial sign-in touches.
	Drive ports.Drive
	// FlowTTL is a flow's lifetime; zero is DefaultFlowTTL.
	FlowTTL time.Duration
	Now     func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// TTL answers a flow's lifetime.
func (s *Service) TTL() time.Duration {
	if s.FlowTTL > 0 {
		return s.FlowTTL
	}
	return DefaultFlowTTL
}

// Live reports whether f is still within its lifetime.
func (s *Service) Live(f domain.Flow) bool { return !f.Expired(s.TTL(), s.now()) }

// Left answers how long f has to live.
func (s *Service) Left(f domain.Flow) time.Duration { return f.Remaining(s.TTL(), s.now()) }

// Begin answers a new identity or Drive flow, with fresh id, PKCE verifier
// and nonce, and the URL that starts it at Google. A trial is not a purpose
// Begin accepts: only BeginTrial makes one, behind the loopback-only route.
func (s *Service) Begin(req BeginRequest) (domain.Flow, string, error) {
	if req.Purpose != domain.PurposeIdentity && req.Purpose != domain.PurposeDrive {
		return domain.Flow{}, "", domain.Refuse(domain.CodeBadRequest)
	}
	if req.Purpose == domain.PurposeDrive && req.ExpectedSub == "" {
		return domain.Flow{}, "", domain.Refuse(domain.CodeBadRequest)
	}
	return s.begin(req)
}

func (s *Service) begin(req BeginRequest) (domain.Flow, string, error) {
	cred, ok := s.Clients.Credentials()
	if !ok {
		return domain.Flow{}, "", domain.Refuse(domain.CodeNotConfigured)
	}
	f := domain.Flow{
		Purpose:     req.Purpose,
		SID:         req.Session.SID,
		WriterID:    req.Session.WriterID,
		ExpectedSub: req.ExpectedSub,
		RedirectURI: req.RedirectURI,
		Created:     s.now().Unix(),
	}
	var err error
	if f.ID, err = domain.RandomID(16); err != nil {
		return domain.Flow{}, "", err
	}
	// 48 bytes make a 64-character verifier, inside RFC 7636's 43 to 128.
	if f.Verifier, err = domain.RandomID(48); err != nil {
		return domain.Flow{}, "", err
	}
	if f.Nonce, err = domain.RandomID(16); err != nil {
		return domain.Flow{}, "", err
	}
	return f, s.authorizeURL(cred, f, req.LoginHint), nil
}

func (s *Service) authorizeURL(cred domain.Credentials, f domain.Flow, loginHint string) string {
	challenge := sha256.Sum256([]byte(f.Verifier))
	q := url.Values{
		"client_id":             {cred.ClientID},
		"redirect_uri":          {f.RedirectURI},
		"response_type":         {"code"},
		"state":                 {f.ID},
		"nonce":                 {f.Nonce},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
	}
	switch f.Purpose {
	case domain.PurposeDrive:
		// Offline access with forced consent is what makes Google return a
		// refresh token on every Drive grant, not only the first one.
		q.Set("scope", domain.DriveScopes)
		q.Set("access_type", "offline")
		q.Set("prompt", "consent")
		q.Set("include_granted_scopes", "true")
	case domain.PurposeTrial:
		// A trial shows the consent screen every time, as a first sign-in
		// does. It asks for no offline access and does not join the
		// account's earlier grants, so its token is a short-lived access
		// token of its own that ends nothing when it lapses.
		q.Set("scope", domain.DriveScopes)
		q.Set("prompt", "select_account consent")
	default:
		q.Set("scope", domain.IdentityScopes)
		q.Set("prompt", "select_account")
		q.Set("include_granted_scopes", "true")
	}
	if loginHint != "" {
		q.Set("login_hint", loginHint)
	}
	return s.Google.AuthEndpoint() + "?" + q.Encode()
}

// CallbackParams are Google's redirect parameters.
type CallbackParams struct {
	State string
	Code  string
	Error string
}

// Callback settles f, the flow this browser carries under p.State, or nil
// when it carries none, and answers the flow to keep and the outcome to
// post. A redirect into a browser that did not start the flow (a login CSRF
// attempt, or a link opened elsewhere) finds no flow and settles nothing. A
// failed check keeps no token.
func (s *Service) Callback(ctx context.Context, f *domain.Flow, p CallbackParams) (*domain.Flow, string) {
	if f == nil || p.State == "" || f.ID != p.State || !s.Live(*f) {
		return nil, CallbackExpired
	}
	switch f.Status {
	case domain.StatusDone:
		return f, CallbackDone
	case domain.StatusFailed:
		return f, failedOutcome(f.FailCode)
	}
	next := *f
	if next.Purpose == domain.PurposeTrial {
		report := s.trial(ctx, next, p)
		next.Status, next.Report = domain.StatusDone, &report
		return &next, CallbackDone
	}
	token, claims, code := s.exchange(ctx, next, p)
	if code != "" {
		next.Status, next.FailCode = domain.StatusFailed, code
		return &next, failedOutcome(code)
	}
	if next.Purpose == domain.PurposeIdentity {
		// An identity flow keeps only the verified claims.
		token = nil
	}
	next.Status, next.Token, next.Claims = domain.StatusDone, token, claims
	return &next, CallbackDone
}

func failedOutcome(code string) string {
	if code == domain.CodeFlowCancelled {
		return CallbackCancelled
	}
	return CallbackFailed
}

func (s *Service) exchange(ctx context.Context, f domain.Flow, p CallbackParams) (*domain.Tokens, *domain.Claims, string) {
	if domain.CancelledAtGoogle(p.Error) {
		return nil, nil, domain.CodeFlowCancelled
	}
	if p.Error != "" || p.Code == "" {
		return nil, nil, domain.CodeFlowFailed
	}
	cred, ok := s.Clients.Credentials()
	if !ok {
		return nil, nil, domain.CodeFlowFailed
	}
	token, err := s.Google.Exchange(ctx, cred, p.Code, f.Verifier, f.RedirectURI)
	if err != nil {
		return nil, nil, domain.CodeFlowFailed
	}
	claims, err := domain.ParseIDToken(token.IDToken)
	if err != nil || claims.Validate(cred.ClientID, f.Nonce, s.now()) != nil {
		return nil, nil, domain.CodeFlowFailed
	}
	if f.ExpectedSub != "" && claims.Sub != f.ExpectedSub {
		return nil, nil, domain.CodeAccountMismatch
	}
	if f.Purpose == domain.PurposeDrive {
		granted := strings.Fields(token.Scope)
		if !contains(granted, domain.ScopeDriveFile) || !contains(granted, domain.ScopeDriveAppdata) {
			return nil, nil, domain.CodeScopeMissing
		}
		if token.RefreshToken == "" || token.AccessToken == "" {
			return nil, nil, domain.CodeFlowFailed
		}
	}
	return token, claims, ""
}

// Finish answers the result of f, the flow this browser carries, or nil
// when it carries none, for session. The second result reports whether
// the browser keeps the flow.
func (s *Service) Finish(f *domain.Flow, session *domain.Session) (*domain.Result, bool, error) {
	switch {
	case f == nil:
		return nil, false, domain.Refuse(domain.CodeFlowExpired)
	case !s.Live(*f):
		return nil, false, domain.Refuse(domain.CodeFlowExpired)
	case f.Purpose == domain.PurposeTrial:
		return nil, false, domain.Refuse(domain.CodeBadRequest)
	case session == nil || session.SID != f.SID || session.WriterID != f.WriterID:
		return nil, false, domain.Refuse(domain.CodeSessionMismatch)
	case f.Status == domain.StatusPending:
		return nil, true, domain.Refuse(domain.CodeFlowPending)
	case f.Status == domain.StatusFailed:
		return nil, false, domain.Refuse(f.FailCode)
	}
	c := f.Claims
	res := &domain.Result{Purpose: f.Purpose, WriterID: f.WriterID}
	if f.Purpose == domain.PurposeIdentity {
		res.Identity = &domain.Identity{
			Iss:           c.Iss,
			Sub:           c.Sub,
			Email:         c.Email,
			EmailVerified: bool(c.EmailVerified),
			Name:          c.Name,
			Picture:       c.Picture,
		}
		return res, false, nil
	}
	res.Grant = &domain.Grant{
		Sub:          c.Sub,
		Email:        c.Email,
		RefreshToken: f.Token.RefreshToken,
		Scopes:       strings.Fields(f.Token.Scope),
		AccessToken:  f.Token.AccessToken,
		ExpiresIn:    f.Token.ExpiresIn,
	}
	return res, false, nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
