// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func token(claims map[string]any) string {
	raw, _ := json.Marshal(claims)
	return "eyJhbGciOiJSUzI1NiJ9." + base64.RawURLEncoding.EncodeToString(raw) + ".c2ln"
}

func TestClaimsValidate(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	base := map[string]any{"iss": "accounts.google.com", "aud": "client", "sub": "s", "exp": now.Unix() + 60, "nonce": "n"}
	with := func(k string, v any) map[string]any {
		out := map[string]any{}
		for kk, vv := range base {
			out[kk] = vv
		}
		if v == nil {
			delete(out, k)
		} else {
			out[k] = v
		}
		return out
	}
	cases := []struct {
		name   string
		claims map[string]any
		ok     bool
	}{
		{"valid", base, true},
		{"https issuer", with("iss", "https://accounts.google.com"), true},
		{"audience array", with("aud", []string{"other", "client"}), true},
		{"wrong audience", with("aud", "other"), false},
		{"wrong issuer", with("iss", "https://accounts.google.com.evil"), false},
		{"expired within the leeway", with("exp", now.Unix()-4*60), true},
		{"expired past the leeway", with("exp", now.Unix()-5*60), false},
		{"wrong nonce", with("nonce", "m"), false},
		{"no nonce", with("nonce", nil), false},
		{"no subject", with("sub", ""), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			claims, err := ParseIDToken(token(c.claims))
			if err != nil {
				t.Fatal(err)
			}
			if err := claims.Validate("client", "n", now); (err == nil) != c.ok {
				t.Fatalf("validate: %v, want ok=%v", err, c.ok)
			}
		})
	}
}

func TestParseIDTokenReadsEmailVerifiedString(t *testing.T) {
	c, err := ParseIDToken(token(map[string]any{"email_verified": "true"}))
	if err != nil || !bool(c.EmailVerified) {
		t.Fatalf("%v %+v", err, c)
	}
	if _, err := ParseIDToken("not-a-jwt"); err == nil {
		t.Fatal("garbage parsed")
	}
}
