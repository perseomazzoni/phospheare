// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build devfake

// A development build, made with `-tags devfake`, uses the stand-ins of
// cmd/fake-services in place of deSEC, Let's Encrypt and Google Cloud
// Console, for walking the setup page by hand. Its identity service, built
// with the same tag, uses the Google stand-in. The release build has none
// of this, because it trusts any certificate from the ACME server. Even
// here, that trust reaches loopback only, and the run keeps away from the
// real copy: its own data folder (parseFlags), a login list in memory, and
// a home network on loopback.

package main

import (
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/certs"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/googletest"
)

// fakeServices is the address of cmd/fake-services. `npm run dev:wizard`
// sets it at build time with -ldflags "-X main.fakeServices=...".
var fakeServices = "http://127.0.0.1:47890"

func init() {
	devFlags = func(_ *flag.FlagSet, o *options) {
		base, err := loopbackBase(fakeServices)
		o.desecAPI = base + "/desec"
		o.acmeDirectory = base + "/acme/dir"
		o.devWiring = devWiring{
			check: func(o options) error {
				if err != nil {
					return err
				}
				if o.dataDir == "" {
					return errors.New("the devfake build needs --data-dir, so the run keeps away from the real copy's data")
				}
				// A later --desec-api or --acme-directory would reach the
				// real services.
				if o.desecAPI != base+"/desec" || o.acmeDirectory != base+"/acme/dir" {
					return errors.New("the devfake build does not take --desec-api or --acme-directory")
				}
				return nil
			},
			certs: func(s *certs.Source) {
				s.HTTP = loopbackOnlyClient()
				// The stand-in's records reach Pebble's DNS at once, and
				// deSEC's own name servers never see them.
				s.Propagated = nil
				s.Settle = 0
			},
			autostart: &loginList{},
			listen: func(network, addr string) (net.Listener, error) {
				_, port, err := net.SplitHostPort(addr)
				if err != nil {
					return nil, err
				}
				return net.Listen(network, net.JoinHostPort("127.0.0.1", port))
			},
			setupPage: testMode(base),
		}
	}
}

// loopbackBase answers base without a final slash, or an error when it is
// not an http address on loopback with a port.
func loopbackBase(base string) (string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || u.Port() == "" || !net.ParseIP(u.Hostname()).IsLoopback() {
		return "", fmt.Errorf("the devfake build was made with %q as the address of fake-services; it must be a loopback address such as http://127.0.0.1:47890", base)
	}
	return strings.TrimSuffix(base, "/"), nil
}

// googleConsole is where the setup page's Open buttons lead.
const googleConsole = "https://console.cloud.google.com"

// testHint is one instruction for the developer, at the one place of the
// setup page where the run needs an action outside it. It goes right after
// mark, the opening tag of a part that shows only at that moment, so it
// shows and hides with that part.
type testHint struct {
	mark, text string
}

// testHints answers the hints for a run against fake-services at base.
// The page allows only its own styles, so a hint uses the page's callout.
func testHints(base string) []testHint {
	control := `<a href="` + html.EscapeString(base+"/") + `" target="_blank" rel="noopener noreferrer">control page</a>`
	hint := func(mark, text string) testHint {
		return testHint{mark, `<div class="callout"><p><strong>Test mode:</strong> ` + text + `</p></div>`}
	}
	return []testHint{
		// The client step shows either the file area or the paste form.
		hint(`<div id="client-file">`, `on the `+control+`, click <em>Download the client file</em>, then drop the file here.`),
		hint(`<form id="client-paste" autocomplete="off" hidden>`, `paste the client ID <code>`+googletest.ClientID+
			`</code> and the client secret <code>`+googletest.ClientSecret+`</code>.`),
		// The trial sign-in opens the Google stand-in's page.
		hint(`<div data-scope="g6">`, `the button opens the fake Google page: click <em>Continue</em> there. `+
			`To see an error, first choose what Google answers on the `+control+`.`),
		// The part that waits for deSEC's email hides once deSEC confirms.
		hint(`<div class="row" id="waiting-restart">`, `no email is sent. On the `+control+
			`, click <em>Click the activation link</em> beside this name. This page then confirms it within 15 seconds.`),
	}
}

// testMode changes the setup page for a run against fake-services at
// base: its links to Google Cloud Console lead to the stand-in's pages, and
// each step that needs an action outside the page says what to do.
func testMode(base string) func(http.Handler) http.Handler {
	links := consoleLinks(base + "/console")
	hints := testHints(base)
	return func(next http.Handler) http.Handler {
		return links(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || r.URL.Path != "/desktop/setup/" {
				next.ServeHTTP(w, r)
				return
			}
			rec := httptest.NewRecorder()
			next.ServeHTTP(rec, r)
			body := rec.Body.String()
			for _, h := range hints {
				body = strings.Replace(body, h.mark, h.mark+h.text, 1)
			}
			copyAnswer(w, rec)
			io.WriteString(w, body)
		}))
	}
}

// copyAnswer writes rec's status and headers to w, without those that a
// changed body makes wrong.
func copyAnswer(w http.ResponseWriter, rec *httptest.ResponseRecorder) {
	for k, v := range rec.Header() {
		w.Header()[k] = v
	}
	// The body changes length, and a copy cached from another build must
	// not answer for it.
	for _, k := range []string{"Content-Length", "Etag", "Last-Modified"} {
		w.Header().Del(k)
	}
	w.WriteHeader(rec.Code)
}

// consoleLinks makes the setup page's links to Google Cloud Console lead to
// to instead, in the page and in its script. The page carries its words as
// JSON, where a slash may be written `\/`.
func consoleLinks(to string) func(http.Handler) http.Handler {
	escaped := func(s string) string { return strings.ReplaceAll(s, "/", `\/`) }
	links := strings.NewReplacer(googleConsole, to, escaped(googleConsole), escaped(to))
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet || r.URL.Path != "/desktop/setup/" && r.URL.Path != "/desktop/setup/admin.js" {
				next.ServeHTTP(w, r)
				return
			}
			rec := httptest.NewRecorder()
			next.ServeHTTP(rec, r)
			copyAnswer(w, rec)
			links.WriteString(w, rec.Body.String())
		})
	}
}

// loopbackOnlyClient is the ACME client: Pebble serves ACME with a
// certificate from its own test CA, so the client checks none, and it so
// refuses to connect anywhere but loopback. It checks the address that a
// name resolves to, not the name.
func loopbackOnlyClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, Control: loopbackOnly}
	return &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		DialContext:     dialer.DialContext,
	}}
}

// loopbackOnly refuses a connection to an address that is not loopback.
func loopbackOnly(network, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("devfake: %s is not on loopback", address)
	}
	return nil
}

// loginList is a login list in memory, so the setup page's "start at login"
// never touches the real copy's entry.
type loginList struct {
	mu sync.Mutex
	on bool
}

func (l *loginList) Enable(string, []string) error { l.set(true); return nil }
func (l *loginList) Disable() error                { l.set(false); return nil }

func (l *loginList) Enabled() (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.on, nil
}

func (l *loginList) set(on bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.on = on
}
