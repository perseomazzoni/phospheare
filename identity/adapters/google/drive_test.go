// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package google

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/perseomazzoni/phospheare/identity/ports"
)

func driveAnswering(t *testing.T, status int, body string) *Drive {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token-1" || r.URL.Query().Get("spaces") != "appDataFolder" {
			t.Errorf("request %s %v", r.URL, r.Header)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return NewDrive(srv.URL)
}

func TestProbeTellsDriveAnswersApart(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"listed", 200, `{"files":[]}`, nil},
		{"api off, old reason", 403, `{"error":{"code":403,"errors":[{"reason":"accessNotConfigured"}]}}`, ports.ErrDriveOff},
		{"api off, new reason", 403, `{"error":{"code":403,"details":[{"reason":"SERVICE_DISABLED"}]}}`, ports.ErrDriveOff},
		{"scope missing", 403, `{"error":{"code":403,"errors":[{"reason":"insufficientPermissions"}]}}`, ports.ErrDriveScope},
		{"scope missing, new reason", 403, `{"error":{"code":403,"details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}`, ports.ErrDriveScope},
		{"down", 503, ``, ports.ErrUnreachable},
	}
	for _, c := range cases {
		err := driveAnswering(t, c.status, c.body).Probe(context.Background(), "token-1")
		if c.want == nil && err != nil || c.want != nil && !errors.Is(err, c.want) {
			t.Fatalf("%s: %v, want %v", c.name, err, c.want)
		}
	}
	err := driveAnswering(t, 401, `{"error":{"code":401}}`).Probe(context.Background(), "token-1")
	if err == nil || errors.Is(err, ports.ErrDriveOff) || errors.Is(err, ports.ErrDriveScope) || errors.Is(err, ports.ErrUnreachable) {
		t.Fatalf("an unknown refusal: %v", err)
	}
}
