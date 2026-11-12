// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"crypto/subtle"
	"regexp"
	"time"
)

var (
	WriterIDPattern     = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
	ConnectionIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22,64}$`)
)

// SessionLifetime is how long a writer session is honoured after it opened,
// whatever the cookie's own lifetime.
const SessionLifetime = 30 * 24 * time.Hour

// Session is the writer session a request carries.
type Session struct {
	SID      string
	WriterID string
	// Proof is the secret the SPA keeps in its origin's storage and sends
	// with every call that uses the session.
	Proof string
}

// SessionClaims are the sealed content of the writer-session cookie.
type SessionClaims struct {
	SID      string `json:"sid"`
	WriterID string `json:"writerId"`
	IAT      int64  `json:"iat"`
	Proof    string `json:"proof"`
}

// Admits reports whether c is a live session that proof unlocks. Browsers
// send a localhost cookie to every port of the host, so another program on
// the computer can receive this cookie and replay it; the proof lives in the
// SPA's own origin storage, which no other port reads. A session
// sealed without a proof, or older than SessionLifetime, admits nothing.
func (c SessionClaims) Admits(proof string, now time.Time) bool {
	if c.SID == "" || c.WriterID == "" || c.Proof == "" || proof == "" {
		return false
	}
	if now.Unix() >= c.IAT+int64(SessionLifetime/time.Second) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(c.Proof), []byte(proof)) == 1
}

// ConnectionClaims are the sealed content of one Drive connection cookie.
type ConnectionClaims struct {
	V            int      `json:"v"`
	ConnectionID string   `json:"connectionId"`
	WriterID     string   `json:"writerId"`
	Sub          string   `json:"sub"`
	Email        string   `json:"email"`
	RefreshToken string   `json:"refreshToken"`
	Scopes       []string `json:"scopes"`
	CreatedAt    int64    `json:"createdAt"`
}

// Identity is a verified Google identity.
type Identity struct {
	Iss           string `json:"iss"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"emailVerified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// Grant is a Drive authorization ready to seal.
type Grant struct {
	Sub          string
	Email        string
	RefreshToken string
	Scopes       []string
	AccessToken  string
	ExpiresIn    int
}

// Result is a finished flow: Identity for an identity flow, Grant for a
// Drive flow.
type Result struct {
	Purpose  Purpose
	WriterID string
	Identity *Identity
	Grant    *Grant
}
