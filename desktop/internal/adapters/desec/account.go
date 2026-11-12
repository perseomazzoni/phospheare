// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package desec

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

var _ ports.NameAccount = (*Client)(nil)

// Register asks for an account owning domain. No captcha is sent, so deSEC
// asks for one on the page its activation link opens.
func (c *Client) Register(ctx context.Context, email, password, domain string) error {
	body := map[string]any{"email": email, "password": password, "domain": domain, "outreach_preference": false}
	_, err := c.call(ctx, http.MethodPost, "/auth/", "", body, nil)
	return err
}

// Login answers a login token. deSEC answers 403 until the activation link
// is used; the password is the one Register sent, so a 403 means that.
func (c *Client) Login(ctx context.Context, email, password string) (string, error) {
	var out struct {
		Token string `json:"token"`
	}
	status, err := c.call(ctx, http.MethodPost, "/auth/login/", "", map[string]string{"email": email, "password": password}, &out)
	if status == http.StatusForbidden {
		return "", ports.ErrNotActivated
	}
	if err != nil {
		return "", err
	}
	if out.Token == "" {
		return "", errors.New("deSEC answered the login without a token")
	}
	return out.Token, nil
}

// policy is one row of a token's record policy. A nil pointer is JSON null,
// which deSEC reads as "any".
type policy struct {
	Domain    *string `json:"domain"`
	Subname   *string `json:"subname"`
	Type      *string `json:"type"`
	PermWrite bool    `json:"perm_write"`
}

// MakeToken makes a token with no expiry, then narrows it: a default policy
// that writes nothing, and write access to the name's `A` and `AAAA`
// records and its `_acme-challenge` `TXT` record. When the login token may not set policies
// the token stays as made; when a later policy fails the token is deleted.
func (c *Client) MakeToken(ctx context.Context, loginToken, domain string) (string, bool, error) {
	var made struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	body := map[string]any{"name": c.TokenName, "max_age": nil, "max_unused_period": nil}
	if _, err := c.call(ctx, http.MethodPost, "/auth/tokens/", loginToken, body, &made); err != nil {
		return "", false, err
	}
	if made.Token == "" || made.ID == "" {
		return "", false, errors.New("deSEC answered the new token without its value")
	}
	path := "/auth/tokens/" + url.PathEscape(made.ID) + "/policies/rrsets/"
	status, err := c.call(ctx, http.MethodPost, path, loginToken, policy{}, nil)
	if status == http.StatusForbidden {
		return made.Token, false, nil
	}
	if err == nil {
		apex, challenge, a, aaaa, txt := "", "_acme-challenge", "A", "AAAA", "TXT"
		for _, p := range []policy{
			{Domain: &domain, Subname: &apex, Type: &a, PermWrite: true},
			{Domain: &domain, Subname: &apex, Type: &aaaa, PermWrite: true},
			{Domain: &domain, Subname: &challenge, Type: &txt, PermWrite: true},
		} {
			if _, err = c.call(ctx, http.MethodPost, path, loginToken, p, nil); err != nil {
				break
			}
		}
	}
	if err != nil {
		c.call(ctx, http.MethodDelete, "/auth/tokens/"+url.PathEscape(made.ID)+"/", loginToken, nil, nil)
		return "", false, fmt.Errorf("the token's limits could not be set: %w", err)
	}
	return made.Token, true, nil
}

// Logout ends loginToken.
func (c *Client) Logout(ctx context.Context, loginToken string) error {
	_, err := c.call(ctx, http.MethodPost, "/auth/logout/", loginToken, nil, nil)
	return err
}

// Owns answers nil when token can read domain.
func (c *Client) Owns(ctx context.Context, token, domain string) error {
	status, err := c.call(ctx, http.MethodGet, "/domains/"+url.PathEscape(domain)+"/", token, nil, nil)
	if status == http.StatusNotFound {
		return &ports.Refusal{Field: "name", Message: "This deSEC account has no name " + domain + "."}
	}
	return err
}
