// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Claims are the ID token claims the service reads.
type Claims struct {
	Iss           string   `json:"iss"`
	Sub           string   `json:"sub"`
	Aud           audience `json:"aud"`
	Exp           int64    `json:"exp"`
	Nonce         string   `json:"nonce"`
	Email         string   `json:"email"`
	EmailVerified flexBool `json:"email_verified"`
	Name          string   `json:"name"`
	Picture       string   `json:"picture"`
}

var errIDToken = errors.New("id token rejected")

// clockLeeway is how far past `exp` a token is still accepted, so a service
// whose clock runs ahead of Google's does not refuse a fresh token.
const clockLeeway = 5 * time.Minute

// ParseIDToken decodes the payload of an ID token without checking its
// signature. The token arrives in the token endpoint's answer over TLS from
// Google itself, and Google's OpenID Connect documentation states that such
// a token needs no signature validation. A token from any other channel
// needs it.
func ParseIDToken(raw string) (*Claims, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return nil, errIDToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return nil, errIDToken
	}
	var c Claims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, errIDToken
	}
	return &c, nil
}

// Validate checks audience, issuer, expiry and the flow's nonce.
func (c *Claims) Validate(clientID, nonce string, now time.Time) error {
	if !c.Aud.contains(clientID) {
		return errIDToken
	}
	if c.Iss != "accounts.google.com" && c.Iss != "https://accounts.google.com" {
		return errIDToken
	}
	if c.Exp+int64(clockLeeway/time.Second) <= now.Unix() {
		return errIDToken
	}
	if nonce == "" || c.Nonce != nonce {
		return errIDToken
	}
	if c.Sub == "" {
		return errIDToken
	}
	return nil
}

// audience accepts `aud` as a string or an array of strings.
type audience []string

func (a *audience) UnmarshalJSON(b []byte) error {
	var one string
	if err := json.Unmarshal(b, &one); err == nil {
		*a = audience{one}
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return err
	}
	*a = many
	return nil
}

func (a audience) contains(id string) bool {
	for _, v := range a {
		if v == id {
			return true
		}
	}
	return false
}

// flexBool accepts `email_verified` as a boolean or as the string "true".
type flexBool bool

func (f *flexBool) UnmarshalJSON(b []byte) error {
	var v bool
	if err := json.Unmarshal(b, &v); err == nil {
		*f = flexBool(v)
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	*f = flexBool(s == "true")
	return nil
}
