// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package ports declares what the identity service's application needs
// from the outside: the Google client's credentials, cookie sealing,
// Google's OAuth endpoints, and the one Google Drive call a trial sign-in
// makes.
package ports

import (
	"context"
	"errors"
	"fmt"

	"github.com/perseomazzoni/phospheare/identity/domain"
)

// ClientSource answers the Web-application client, and false while it is
// not configured.
type ClientSource interface {
	Credentials() (domain.Credentials, bool)
}

// ClientFunc adapts a function to ClientSource.
type ClientFunc func() (domain.Credentials, bool)

func (f ClientFunc) Credentials() (domain.Credentials, bool) { return f() }

// Sealer turns a value into an opaque string only holders of the same keys
// open. A value sealed for one purpose does not open as another.
type Sealer interface {
	Seal(purpose string, v any) (string, error)
	Open(purpose, sealed string, v any) error
}

// Google is the OAuth side of Google: the authorization endpoint, the token
// endpoint and revocation.
type Google interface {
	// AuthEndpoint answers the authorization endpoint's URL.
	AuthEndpoint() string
	// Exchange trades an authorization code for tokens.
	Exchange(ctx context.Context, cred domain.Credentials, code, verifier, redirectURI string) (*domain.Tokens, error)
	// Refresh trades a refresh token for a new access token.
	Refresh(ctx context.Context, cred domain.Credentials, refreshToken string) (*domain.Tokens, error)
	// Revoke revokes token at Google. A token Google does not know counts
	// as revoked.
	Revoke(ctx context.Context, token string) error
}

// GoogleError is an OAuth error answer from Google.
type GoogleError struct {
	Status      int
	Code        string `json:"error"`
	Description string `json:"error_description"`
}

func (e *GoogleError) Error() string {
	return fmt.Sprintf("google: %d %s", e.Status, e.Code)
}

// ErrUnreachable wraps a network failure or a 5xx answer from Google.
var ErrUnreachable = errors.New("google unreachable")

// Drive is the part of Google Drive a trial sign-in touches.
type Drive interface {
	// Probe lists the app's hidden folder with accessToken, the first
	// thing the SPA does with a Drive connection.
	Probe(ctx context.Context, accessToken string) error
}

// Drive refusals Probe tells apart.
var (
	// ErrDriveOff: the Google Cloud project has the Google Drive API
	// turned off.
	ErrDriveOff = errors.New("google drive api turned off")
	// ErrDriveScope: the token lacks the permission the call needs.
	ErrDriveScope = errors.New("google drive permission missing")
)
