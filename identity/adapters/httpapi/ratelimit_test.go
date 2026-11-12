// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/httpapi"
)

const homeOrigin = "https://rossi-studio.dedyn.io:47843"

// openFrom asks h to open a session from remote, with forwarded as the
// `X-Forwarded-For` header when it is not empty.
func openFrom(h http.Handler, host, origin, remote, forwarded string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/identity/session", bytes.NewReader([]byte(`{"writerId":"w"}`)))
	req.Host, req.RemoteAddr = host, remote
	req.Header.Set("X-Phospheare", "1")
	req.Header.Set("Origin", origin)
	if forwarded != "" {
		req.Header.Set("X-Forwarded-For", forwarded)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// spend opens sessions from remote until one is refused, and answers how
// many were served.
func spend(t *testing.T, h http.Handler, remote, forwarded string) int {
	t.Helper()
	for served := 0; served < 1000; served++ {
		rec := openFrom(h, "rossi-studio.dedyn.io:47843", homeOrigin, remote, forwarded)
		if rec.Code == http.StatusTooManyRequests {
			p := expectProblem(t, rec, http.StatusTooManyRequests, "rate-limited")
			if p["retryAfterSeconds"] == nil || rec.Header().Get("Retry-After") == "" {
				t.Fatalf("a rate-limited answer without a retry time: %v", p)
			}
			return served
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("open session: %d %s", rec.Code, rec.Body.String())
		}
	}
	t.Fatal("never limited")
	return 0
}

func TestHomeNetworkLimitsEachAddress(t *testing.T) {
	e := newEnv(t)
	h := e.host.Handler(httpapi.Listener{Origin: homeOrigin, ExpectedHost: "rossi-studio.dedyn.io:47843", Secure: true})
	if served := spend(t, h, "192.0.2.10:5000", ""); served != 30 {
		t.Fatalf("served %d before limiting, want 30", served)
	}
	if rec := openFrom(h, "rossi-studio.dedyn.io:47843", homeOrigin, "192.0.2.11:5000", ""); rec.Code != http.StatusOK {
		t.Fatalf("another address was limited: %d", rec.Code)
	}
	e.skew = 2 * time.Second
	if rec := openFrom(h, "rossi-studio.dedyn.io:47843", homeOrigin, "192.0.2.10:5001", ""); rec.Code != http.StatusOK {
		t.Fatalf("a token did not come back: %d", rec.Code)
	}
}

func TestHomeNetworkLimitReadsTheFrontsForwardedAddress(t *testing.T) {
	e := newEnv(t)
	h := e.host.Handler(httpapi.Listener{Origin: homeOrigin, ExpectedHost: "rossi-studio.dedyn.io:47843", Secure: true})
	spend(t, h, "127.0.0.1:40000", "192.0.2.20")
	if rec := openFrom(h, "rossi-studio.dedyn.io:47843", homeOrigin, "127.0.0.1:40001", "192.0.2.21"); rec.Code != http.StatusOK {
		t.Fatalf("a second phone behind the front was limited: %d", rec.Code)
	}
	// A peer that is not the front cannot pick its own address.
	spend(t, h, "192.0.2.30:5000", "192.0.2.31")
	if rec := openFrom(h, "rossi-studio.dedyn.io:47843", homeOrigin, "192.0.2.30:5000", "192.0.2.32"); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("a forged forwarded address escaped the limit: %d", rec.Code)
	}
}

func TestLoopbackListenerIsNotLimited(t *testing.T) {
	e := newEnv(t)
	for i := range 100 {
		if rec := openFrom(e.h, localHost, localOrigin, "127.0.0.1:40000", ""); rec.Code != http.StatusOK {
			t.Fatalf("request %d on the loopback listener: %d", i, rec.Code)
		}
	}
}
