// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build devfake

package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/certs"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/googletest"
)

func TestTheDevfakeBuildStaysApartFromTheRealCopy(t *testing.T) {
	if _, err := parseFlags(nil); err == nil {
		t.Fatal("the devfake build started without --data-dir")
	}
	for _, real := range [][]string{{"--desec-api", "https://desec.io/api/v1"}, {"--acme-directory", "https://acme-v02.api.letsencrypt.org/directory"}} {
		if _, err := parseFlags(append([]string{"--data-dir", "/d"}, real...)); err == nil {
			t.Fatalf("the devfake build took %s", real[0])
		}
	}
	o, err := parseFlags([]string{"--data-dir", "/d"})
	if err != nil || o.desecAPI != fakeServices+"/desec" || o.acmeDirectory != fakeServices+"/acme/dir" {
		t.Fatalf("%+v %v", o, err)
	}

	src := &certs.Source{Settle: 1}
	o.devWiring.certs(src)
	if src.Propagated != nil || src.Settle != 0 || src.HTTP == nil {
		t.Fatalf("the certificate source was not set for the stand-ins: %+v", src)
	}
	// The client that checks no certificate goes nowhere but loopback.
	if _, err := src.HTTP.Get("https://192.0.2.1/directory"); err == nil || !strings.Contains(err.Error(), "not on loopback") {
		t.Fatalf("the ACME client reached beyond loopback: %v", err)
	}

	if err := o.devWiring.autostart.Enable("x", nil); err != nil {
		t.Fatal(err)
	}
	if on, _ := o.devWiring.autostart.Enabled(); !on {
		t.Fatal("the login list in memory did not keep the entry")
	}

	ln, err := o.devWiring.listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	if !strings.HasPrefix(ln.Addr().String(), "127.0.0.1:") {
		t.Fatalf("the home network listens on %s, not loopback", ln.Addr())
	}
}

func TestTheDevfakeBuildTakesOnlyALoopbackAddress(t *testing.T) {
	for _, base := range []string{"https://127.0.0.1:47890", "http://192.168.1.20:47890", "http://localhost:47890", "http://127.0.0.1"} {
		if _, err := loopbackBase(base); err == nil {
			t.Errorf("%s was accepted", base)
		}
	}
}

func TestTheDevfakeSetupPageLinksToTheConsoleStandIn(t *testing.T) {
	page := `<a href="https://console.cloud.google.com/auth/clients">` +
		`<script>{"x":"https:\/\/console.cloud.google.com\/projectcreate"}</script>`
	wrapped := consoleLinks("http://127.0.0.1:47890/console")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1")
		w.Header().Set("ETag", `"release"`)
		io.WriteString(w, page)
	}))
	for path, want := range map[string]bool{"/desktop/setup/": true, "/desktop/setup/admin.js": true, "/desktop/setup/api/state": false} {
		rec := httptest.NewRecorder()
		wrapped.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		body := rec.Body.String()
		if changed := !strings.Contains(body, "console.cloud.google.com"); changed != want {
			t.Errorf("%s: links changed %v, want %v: %s", path, changed, want, body)
		}
		if want && (!strings.Contains(body, `href="http://127.0.0.1:47890/console/auth/clients"`) ||
			!strings.Contains(body, `http:\/\/127.0.0.1:47890\/console\/projectcreate`) ||
			rec.Header().Get("ETag") != "" || rec.Header().Get("Content-Length") != "") {
			t.Errorf("%s: %s %v", path, body, rec.Header())
		}
	}
}

// Each hint goes right after its own part of the real setup page, once.
// A change to the page that moves a part fails here, not in a run.
func TestTheDevfakeSetupPageGuidesEachOutsideStep(t *testing.T) {
	raw, err := os.ReadFile("../../internal/adapters/admin/static/index.html")
	if err != nil {
		t.Fatal(err)
	}
	wrapped := testMode("http://127.0.0.1:47890")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(raw)
	}))
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/desktop/setup/", nil))
	body := rec.Body.String()
	hints := testHints("http://127.0.0.1:47890")
	for _, h := range hints {
		if n := strings.Count(string(raw), h.mark); n != 1 {
			t.Errorf("%s shows %d times in index.html, want 1", h.mark, n)
		}
		if !strings.Contains(body, h.mark+h.text) {
			t.Errorf("no hint after %s", h.mark)
		}
	}
	if n := strings.Count(body, "Test mode:"); n != len(hints) {
		t.Errorf("%d hints, want %d", n, len(hints))
	}
	if !strings.Contains(body, googletest.ClientSecret) || strings.Contains(body, "console.cloud.google.com") {
		t.Error("the paste hint lacks the test client, or a console link is left")
	}
}
