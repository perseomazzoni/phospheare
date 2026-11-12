// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"testing"
	"time"
)

func TestParseOriginNormalizes(t *testing.T) {
	cases := map[string]Origin{
		"https://Studio.Example.com":      {URL: "https://studio.example.com", Host: "studio.example.com", Secure: true},
		"https://studio.example.com:443/": {URL: "https://studio.example.com", Host: "studio.example.com", Secure: true},
		"https://studio.example.com:8443": {URL: "https://studio.example.com:8443", Host: "studio.example.com:8443", Secure: true},
		"http://localhost:5173":           {URL: "http://localhost:5173", Host: "localhost:5173", Loopback: true},
		"http://127.0.0.1:47821":          {URL: "http://127.0.0.1:47821", Host: "127.0.0.1:47821", Loopback: true},
	}
	for raw, want := range cases {
		got, err := ParseOrigin(raw)
		if err != nil || got != want {
			t.Fatalf("%s: %+v %v, want %+v", raw, got, err, want)
		}
	}
}

func TestParseOriginRefuses(t *testing.T) {
	for _, raw := range []string{
		"", "studio.example.com", "ftp://studio.example.com", "http://studio.example.com",
		"https://studio.example.com/app", "https://studio.example.com/?x=1", "https://user@studio.example.com",
	} {
		if _, err := ParseOrigin(raw); err == nil {
			t.Fatalf("%q accepted", raw)
		}
	}
}

func TestParseOriginsListsDistinctOrigins(t *testing.T) {
	got, err := ParseOrigins(" http://localhost:47821 , https://studio.example.test:47843 ")
	if err != nil || len(got) != 2 || got[1].Host != "studio.example.test:47843" {
		t.Fatalf("%+v %v", got, err)
	}
	for _, bad := range []string{"", " , ", "https://a.example.test,https://A.example.test:443"} {
		if _, err := ParseOrigins(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
}

func TestFlowExpiry(t *testing.T) {
	start := time.Unix(1_800_000_000, 0)
	f := Flow{Created: start.Unix()}
	if f.Expired(10*time.Minute, start.Add(9*time.Minute)) || f.Remaining(10*time.Minute, start.Add(9*time.Minute)) != time.Minute {
		t.Fatal("expired early")
	}
	if !f.Expired(10*time.Minute, start.Add(10*time.Minute)) || f.Remaining(10*time.Minute, start.Add(11*time.Minute)) != 0 {
		t.Fatal("alive after ten minutes")
	}
}
