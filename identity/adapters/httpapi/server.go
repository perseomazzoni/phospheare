// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package httpapi answers the `/identity/` routes of
// `docs/identity-contract.md` for each origin the service serves, behind the
// checks every request to such an origin passes.
//
// Every request passes the Host check before anything else: the browser
// origin is one stable string per listener (`domain.Origin`). Every
// non-GET `/identity/` request passes the cross-site guard. Nothing
// logs a query string, a code, a token, a cookie or an email.
package httpapi

import (
	"context"
	"html"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/problem"
	"github.com/perseomazzoni/phospheare/identity/application"
	"github.com/perseomazzoni/phospheare/identity/domain"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// Prefix is the path every identity route lives under. The rest of the
// origin belongs to whoever serves the SPA.
const Prefix = "/identity/"

// CallbackPath is where Google returns the browser; each origin's redirect
// URI is the origin followed by it.
const CallbackPath = "/identity/google/callback"

// maxBody caps every `/identity/` request body; the largest the contract
// sends is a few hundred bytes.
const maxBody = 16 << 10

// Host is the state every listener shares.
type Host struct {
	ProductName string
	Sealer      ports.Sealer
	Clients     ports.ClientSource
	OAuth       *application.Service
	Observer    Observer
}

// Observer watches every request to a served origin.
type Observer struct {
	// Logger receives one line per request; nil logs nothing.
	Logger *slog.Logger
}

// Listener describes one origin a handler serves.
type Listener struct {
	// Origin is the browser origin of the listener: the base of its Google
	// redirect URI and the only accepted `Origin` header.
	Origin string
	// ExpectedHost is the only accepted `Host` header; "" accepts any
	// (development behind the Vite proxy).
	ExpectedHost string
	// Secure marks cookies `Secure`; true on HTTPS.
	Secure bool
	// Loopback marks the origin on the computer itself, the only one that
	// serves the trial sign-in.
	Loopback bool
}

func (h *Host) now() time.Time {
	if h.OAuth.Now != nil {
		return h.OAuth.Now()
	}
	return time.Now()
}

// ListenerFor answers the listener of origin o.
func ListenerFor(o domain.Origin) Listener {
	return Listener{Origin: o.URL, ExpectedHost: o.Host, Secure: o.Secure, Loopback: o.Loopback}
}

// routes answers the `/identity/` routes of listener l, without the checks
// of Handler.
func (h *Host) routes(l Listener) http.Handler {
	var lim *limiter
	if !l.Loopback {
		lim = newLimiter(h.now)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /identity/session", h.getSession)
	mux.HandleFunc("POST /identity/session", limit(lim, func(w http.ResponseWriter, r *http.Request) { h.openSession(w, r, l) }))
	mux.HandleFunc("DELETE /identity/session", func(w http.ResponseWriter, r *http.Request) { h.closeSession(w, r, l) })
	mux.HandleFunc("POST /identity/google/flows", limit(lim, func(w http.ResponseWriter, r *http.Request) { h.beginFlow(w, r, l) }))
	mux.HandleFunc("GET "+CallbackPath, limit(lim, func(w http.ResponseWriter, r *http.Request) { h.callback(w, r, l) }))
	mux.HandleFunc("POST /identity/google/flows/{flowId}/finish", func(w http.ResponseWriter, r *http.Request) { h.finish(w, r, l) })
	mux.HandleFunc("POST /identity/google/token", func(w http.ResponseWriter, r *http.Request) { h.token(w, r, l) })
	mux.HandleFunc("DELETE /identity/google/connections/{connectionId}", func(w http.ResponseWriter, r *http.Request) { h.disconnect(w, r, l) })
	mux.HandleFunc("PUT /identity/credentials/{name}", func(w http.ResponseWriter, r *http.Request) { h.keepCredential(w, r, l) })
	mux.HandleFunc("POST /identity/credentials/{name}/open", limit(lim, func(w http.ResponseWriter, r *http.Request) { h.openCredential(w, r, l) }))
	mux.HandleFunc("DELETE /identity/credentials/{name}", func(w http.ResponseWriter, r *http.Request) { h.forgetCredential(w, r, l) })
	mux.HandleFunc("POST /identity/google/trials", func(w http.ResponseWriter, r *http.Request) { h.beginTrial(w, r, l) })
	mux.HandleFunc("POST /identity/google/trials/{flowId}/finish", func(w http.ResponseWriter, r *http.Request) { h.finishTrial(w, r, l) })
	mux.HandleFunc(Prefix, func(w http.ResponseWriter, r *http.Request) { notFound(w) })
	return mux
}

// Handler answers the requests of every listener in ls, picked by the
// request's Host: the `/identity/` routes behind every check, and 404 for
// any other path. A Host no listener names gets the wrong-address page
// linking the first; a listener without an expected Host answers every Host
// the others do not name.
func (h *Host) Handler(ls ...Listener) http.Handler {
	byHost := map[string]http.Handler{}
	var anyHost http.Handler
	for _, l := range ls {
		mux := http.NewServeMux()
		mux.Handle(Prefix, h.routes(l))
		mux.Handle("/", http.NotFoundHandler())
		served := securityHeaders(guard(l, mux))
		if l.ExpectedHost == "" {
			anyHost = served
		} else {
			byHost[strings.ToLower(l.ExpectedHost)] = served
		}
	}
	first := ""
	if len(ls) > 0 {
		first = ls[0].Origin
	}
	return h.Observer.observe(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if next, ok := byHost[strings.ToLower(r.Host)]; ok {
			next.ServeHTTP(w, r)
		} else if anyHost != nil {
			anyHost.ServeHTTP(w, r)
		} else {
			wrongHost(w, first, "This address is not served here.")
		}
	}))
}

// wrongHost answers a request for a Host no listener serves: a short page
// that says why and links origin. A page on another origin that resolves its
// name to this machine (DNS rebinding) is turned away before any route runs.
func wrongHost(w http.ResponseWriter, origin, reason string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusMisdirectedRequest)
	_, _ = w.Write([]byte(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Wrong address</title><body><p>` +
		html.EscapeString(reason) + `</p><p>Open <a href="` + html.EscapeString(origin) + `/">` +
		html.EscapeString(origin) + `/</a></p></body></html>`))
}

// guard is the cross-site guard of every non-GET `/identity/` route. The
// custom header cannot be sent cross-origin without a CORS preflight, which no
// route grants; `Sec-Fetch-Site` and `Origin`, when the browser sends them,
// must name this listener.
func guard(l Listener, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, Prefix) || r.Method == http.MethodGet || r.Method == http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("X-Phospheare") != "1" {
			problem.Write(w, http.StatusForbidden, "csrf-refused", "The X-Phospheare header is missing")
			return
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
			problem.Write(w, http.StatusForbidden, "csrf-refused", "Cross-site request refused")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != l.Origin {
			problem.Write(w, http.StatusForbidden, "csrf-refused", "Cross-origin request refused")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// securityHeaders sets the headers every answer on the origin carries, and
// the `/identity/` ones. Whoever serves the SPA adds its own headers for the
// other paths.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		p := r.URL.Path
		if strings.HasPrefix(p, Prefix) {
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
			h.Set("Cache-Control", "no-store")
			if !strings.HasPrefix(p, CallbackPath) {
				h.Set("Cross-Origin-Opener-Policy", "same-origin")
			}
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the server's writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

// requestIDPattern is an `X-Request-Id` worth keeping from the proxy in
// front; any other is replaced.
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

// observe gives every request an `X-Request-Id`, caps `/identity/` bodies,
// and after the answer writes one log line (method, route pattern, status,
// duration, request id, client) and counts it. The route is the pattern
// that matched, never the path, so neither the log nor the counters carry
// an id from a URL.
func (o Observer) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := r.Header.Get("X-Request-Id")
		if !requestIDPattern.MatchString(id) {
			id, _ = domain.RandomID(12)
		}
		w.Header().Set("X-Request-Id", id)
		// The request below is a copy, so the pattern its mux records
		// stays readable here.
		inner := r.WithContext(r.Context())
		inner.Header = r.Header.Clone()
		inner.Header.Set("X-Request-Id", id)
		if strings.HasPrefix(r.URL.Path, Prefix) {
			inner.Body = http.MaxBytesReader(w, r.Body, maxBody)
		}
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, inner)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		route := inner.Pattern
		if i := strings.IndexByte(route, ' '); i >= 0 {
			route = route[i+1:]
		}
		if route == "" {
			route = "unmatched"
		}
		if o.Logger != nil {
			o.Logger.LogAttrs(context.Background(), slog.LevelInfo, "request",
				slog.String("method", r.Method),
				slog.String("route", route),
				slog.Int("status", rec.status),
				slog.Duration("took", time.Since(start).Round(time.Microsecond)),
				slog.String("requestId", id))
		}
	})
}
