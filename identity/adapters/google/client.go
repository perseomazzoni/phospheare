// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package google is the identity service's adapter for Google's OAuth
// endpoints: the code exchange, refresh, revocation and the client check of
// the setup page.
package google

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/perseomazzoni/phospheare/identity/domain"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// Endpoints are Google's OAuth endpoints; tests point them at a fake.
type Endpoints struct {
	Auth   string
	Token  string
	Revoke string
}

// GoogleEndpoints are the production endpoints.
var GoogleEndpoints = Endpoints{
	Auth:   "https://accounts.google.com/o/oauth2/v2/auth",
	Token:  "https://oauth2.googleapis.com/token",
	Revoke: "https://oauth2.googleapis.com/revoke",
}

type tokenAnswer struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	IDToken      string `json:"id_token"`
	TokenType    string `json:"token_type"`
}

// Client talks to Google's token and revocation endpoints.
type Client struct {
	Endpoints Endpoints
	HTTP      *http.Client
}

// AuthEndpoint answers the authorization endpoint's URL.
func (c *Client) AuthEndpoint() string { return c.Endpoints.Auth }

// NewClient answers a client over endpoints with a 20-second timeout.
func NewClient(endpoints Endpoints) *Client {
	return &Client{Endpoints: endpoints, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

// Exchange trades an authorization code for tokens.
func (c *Client) Exchange(ctx context.Context, cred domain.Credentials, code, verifier, redirectURI string) (*domain.Tokens, error) {
	return c.token(ctx, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {redirectURI},
		"client_id":     {cred.ClientID},
		"client_secret": {cred.ClientSecret},
	})
}

// Refresh trades a refresh token for a new access token.
func (c *Client) Refresh(ctx context.Context, cred domain.Credentials, refreshToken string) (*domain.Tokens, error) {
	return c.token(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {cred.ClientID},
		"client_secret": {cred.ClientSecret},
	})
}

func (c *Client) token(ctx context.Context, form url.Values) (*domain.Tokens, error) {
	var out tokenAnswer
	if err := c.post(ctx, c.Endpoints.Token, form, &out); err != nil {
		return nil, err
	}
	return &domain.Tokens{
		AccessToken:  out.AccessToken,
		ExpiresIn:    out.ExpiresIn,
		RefreshToken: out.RefreshToken,
		Scope:        out.Scope,
		IDToken:      out.IDToken,
		TokenType:    out.TokenType,
	}, nil
}

// Revoke revokes token at Google. A token Google does not know
// (`invalid_token`) counts as revoked.
func (c *Client) Revoke(ctx context.Context, token string) error {
	err := c.post(ctx, c.Endpoints.Revoke, url.Values{"token": {token}}, nil)
	var ge *ports.GoogleError
	if errors.As(err, &ge) && ge.Status == http.StatusBadRequest && ge.Code == "invalid_token" {
		return nil
	}
	return err
}

func (c *Client) post(ctx context.Context, endpoint string, form url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ports.ErrUnreachable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ports.ErrUnreachable, err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("%w: status %d", ports.ErrUnreachable, resp.StatusCode)
	}
	if resp.StatusCode >= 300 {
		ge := &ports.GoogleError{Status: resp.StatusCode}
		_ = json.Unmarshal(body, ge)
		return ge
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("google: malformed answer: %w", err)
	}
	return nil
}

// CheckResult is what a credentials check found.
type CheckResult string

const (
	CheckOK               CheckResult = "ok"
	CheckWrongCredentials CheckResult = "wrong-credentials"
	CheckRedirectMismatch CheckResult = "redirect-mismatch"
	CheckUnreachable      CheckResult = "unreachable"
	CheckUnexpected       CheckResult = "unexpected"
)

// Check asks the authorization endpoint whether it accepts the client ID
// with redirectURI, then redeems a code that cannot exist to try the
// secret. The token endpoint answers `invalid_grant` for an unknown code
// before it looks at the redirect URI, so only the first question finds an
// address the client does not list.
func (c *Client) Check(ctx context.Context, cred domain.Credentials, redirectURI string) (CheckResult, string) {
	switch code, err := c.authorize(ctx, cred.ClientID, redirectURI); {
	case err != nil:
		return CheckUnreachable, ""
	case code == "redirect_uri_mismatch":
		return CheckRedirectMismatch, code
	case code == "invalid_client", code == "deleted_client", code == "unauthorized_client":
		return CheckWrongCredentials, code
	case code != "":
		return CheckUnexpected, code
	}
	_, err := c.Exchange(ctx, cred, "phospheare-connection-check", "phospheare-connection-check-verifier-000000000000000", redirectURI)
	var ge *ports.GoogleError
	switch {
	case err == nil:
		return CheckUnexpected, "Google accepted a code that does not exist."
	case errors.As(err, &ge):
		switch ge.Code {
		case "invalid_grant":
			return CheckOK, ""
		case "invalid_client", "unauthorized_client":
			return CheckWrongCredentials, ge.Code
		case "redirect_uri_mismatch":
			return CheckRedirectMismatch, ge.Code
		}
		return CheckUnexpected, ge.Code
	case errors.Is(err, ports.ErrUnreachable):
		return CheckUnreachable, ""
	}
	return CheckUnexpected, ""
}

// authorize starts a sign-in with clientID and redirectURI without following
// Google's answer, and returns the error code Google refused it with, or ""
// when Google goes on to its sign-in page. A refusal is a redirect to
// `/signin/oauth/error` whose `authError` is base64 of a message that
// starts with the code: byte 0x0a, the code's length, then the code. Any
// answer that is neither a page nor a redirect onwards, such as a 4xx, is
// "unknown": the check cannot tell whether Google accepts the client.
func (c *Client) authorize(ctx context.Context, clientID, redirectURI string) (string, error) {
	q := url.Values{
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {"openid"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Endpoints.Auth+"?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	hc := *c.HTTP
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ports.ErrUnreachable, err)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if resp.StatusCode >= 500 {
		return "", fmt.Errorf("%w: %s", ports.ErrUnreachable, resp.Status)
	}
	location := resp.Header.Get("Location")
	if loc, err := url.Parse(location); err == nil && strings.HasSuffix(loc.Path, "/signin/oauth/error") {
		return authErrorCode(loc.Query().Get("authError")), nil
	}
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return "", nil
	case resp.StatusCode >= 300 && resp.StatusCode < 400 && location != "":
		return "", nil
	}
	return "unknown", nil
}

// authErrorCode reads the code at the start of an `authError`, or answers
// "unknown" when it cannot.
func authErrorCode(s string) string {
	var raw []byte
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			raw = b
			break
		}
	}
	if len(raw) < 2 || raw[0] != 0x0a || raw[1] >= 0x80 || len(raw) < 2+int(raw[1]) {
		return "unknown"
	}
	return string(raw[2 : 2+int(raw[1])])
}
