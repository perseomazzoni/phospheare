// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package domain holds the identity service's rules: flows, sessions, Drive
// connections, origins, ID-token checks and the refusal codes of the
// contract in `docs/identity-contract.md`. It imports nothing outside the standard
// library and does no I/O.
package domain

import (
	"crypto/rand"
	"encoding/base64"
	"regexp"
	"time"
)

// Purpose is what a flow authorizes.
type Purpose string

const (
	PurposeIdentity Purpose = "identity"
	PurposeDrive    Purpose = "drive"
	// PurposeTrial is a trial sign-in from the setup page: it belongs to no
	// writer session and ends in a TrialReport, never in a token.
	PurposeTrial Purpose = "trial"
)

// Status is where a flow is.
type Status int

const (
	StatusPending Status = iota
	StatusDone
	StatusFailed
)

// Flow is one authorization in progress. It is a value the service keeps
// nowhere: the browser carries it sealed, so any replica holding the keys
// answers any step. Its id is also the OAuth `state`.
type Flow struct {
	ID          string  `json:"id"`
	Verifier    string  `json:"verifier"`
	Nonce       string  `json:"nonce"`
	Purpose     Purpose `json:"purpose"`
	SID         string  `json:"sid"`
	WriterID    string  `json:"writerId"`
	ExpectedSub string  `json:"expectedSub,omitempty"`
	RedirectURI string  `json:"redirectUri"`
	Created     int64   `json:"created"`
	Status      Status  `json:"status"`
	FailCode    string  `json:"failCode,omitempty"`
	Token       *Tokens `json:"token,omitempty"`
	Claims      *Claims `json:"claims,omitempty"`
	// Report is a trial flow's outcome, set by its callback.
	Report *TrialReport `json:"report,omitempty"`
}

// FlowIDPattern is a flow id: 16 random bytes as unpadded base64url.
var FlowIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)

// Expired reports whether f has outlived ttl at now.
func (f Flow) Expired(ttl time.Duration, now time.Time) bool {
	return now.Unix() >= f.Created+int64(ttl/time.Second)
}

// Remaining answers how long f has left at now, in whole seconds as
// Expired counts them, never below zero.
func (f Flow) Remaining(ttl time.Duration, now time.Time) time.Duration {
	left := f.Created + int64(ttl/time.Second) - now.Unix()
	if left < 0 {
		return 0
	}
	return time.Duration(left) * time.Second
}

// CancelledAtGoogle reports whether code, the `error` of Google's redirect,
// means the person declined at Google rather than something failing.
func CancelledAtGoogle(code string) bool { return code == "access_denied" }

// Tokens are what Google's token endpoint answered.
type Tokens struct {
	AccessToken  string `json:"accessToken,omitempty"`
	ExpiresIn    int    `json:"expiresIn,omitempty"`
	RefreshToken string `json:"refreshToken,omitempty"`
	Scope        string `json:"scope,omitempty"`
	IDToken      string `json:"-"`
	TokenType    string `json:"-"`
}

// RandomID answers n random bytes as unpadded base64url.
func RandomID(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
