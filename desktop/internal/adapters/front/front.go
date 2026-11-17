// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package front answers one desktop listener: the program's own `/desktop/`
// paths when the listener has them, the `/identity/` routes passed on to the
// identity service the desktop runs, and the SPA everywhere else. The Host
// rules run first: the numeric loopback alias goes to the listener's name,
// and any other Host is turned away with the desktop's own reason. On the
// home network, a visit from the computer the program runs on goes to its
// loopback address: the browser keeps saved work and folder permissions per
// address, so that computer has one address and one library.
package front

import (
	"context"
	"html"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/problem"
)

// Prefix is the path the desktop program keeps for itself: the setup page
// and the copy check.
const Prefix = "/desktop/"

// IdentityPrefix is the path of every identity route.
const IdentityPrefix = "/identity/"

// Listener describes the origin one listener serves.
type Listener struct {
	// Origin is the browser origin of the listener.
	Origin string
	// ExpectedHost is the only accepted `Host` header; "" accepts any
	// (development behind the Vite proxy).
	ExpectedHost string
}

// Upstream answers where the identity service listens, or nil while none
// runs.
type Upstream interface {
	Target() *url.URL
}

// Options describe one listener's front.
type Options struct {
	Listener Listener
	// AliasHost is answered with a 308 to the same path on the listener's
	// origin; "" has none.
	AliasHost string
	// WrongHost says why a request for another Host is turned away.
	WrongHost string
	// FromThisComputer reports a request from the computer the program runs
	// on, given the connection's remote and local addresses; nil reports
	// none. Such a request is sent to the same path on LocalOrigin.
	FromThisComputer func(remoteAddr, localAddr string) bool
	LocalOrigin      string
	// Identity is the service `/identity/` is passed on to.
	Identity Upstream
	// Desktop serves `/desktop/`; nil answers 404 there.
	Desktop http.Handler
	// Configured reports whether a Google client is set up. Until it is,
	// `/identity/` answers `google-not-configured` and the SPA writes in
	// Local Storage without Google.
	Configured func() bool
	// SPA is the built application; nil serves only `/identity/` and
	// `/desktop/` (development).
	SPA fs.FS
	// SPAImmutable marks SPA as embedded, so ETags are computed once.
	SPAImmutable bool
	// Logger logs every request but the identity routes, which the
	// identity service logs itself; nil logs nothing.
	Logger *slog.Logger
	// HTTPS marks a listener that serves only HTTPS: every answer carries
	// Strict-Transport-Security.
	HTTPS bool
}

// Handler answers the requests of the listener o describes.
func Handler(o Options) http.Handler {
	mux := http.NewServeMux()
	desktop := o.Desktop
	if desktop == nil {
		desktop = http.NotFoundHandler()
	}
	mux.Handle(Prefix, desktopHeaders(desktop))
	mux.Handle(IdentityPrefix, proxy(o))
	if o.SPA != nil {
		mux.Handle("/", spaHeaders(newSPA(o.SPA, o.SPAImmutable)))
	} else {
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Development mode serves only /identity/ and /desktop/; the SPA comes from the Vite dev server.", http.StatusNotFound)
		})
	}
	return transportSecurity(o.HTTPS, hostRules(o, logged(o.Logger, baseline(mux))))
}

// transportSecurity tells the browser to reach an HTTPS listener's name
// only over HTTPS for a year. Subdomains are left out: the name's zone is
// not the program's to bind.
func transportSecurity(on bool, next http.Handler) http.Handler {
	if !on {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		next.ServeHTTP(w, r)
	})
}

// hostRules sends the numeric loopback alias to the listener's name and
// turns away any other Host. A page on another origin that resolves its
// name to this machine (DNS rebinding) never reaches a route.
func hostRules(o Options, next http.Handler) http.Handler {
	l := o.Listener
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o.AliasHost != "" && strings.EqualFold(r.Host, o.AliasHost) {
			http.Redirect(w, r, l.Origin+r.URL.RequestURI(), http.StatusPermanentRedirect)
			return
		}
		if l.ExpectedHost != "" && !strings.EqualFold(r.Host, l.ExpectedHost) {
			wrongHost(w, l.Origin, o.WrongHost)
			return
		}
		// A temporary redirect: the home network can be turned off, and the
		// browser must not remember this answer.
		if o.FromThisComputer != nil && o.LocalOrigin != "" && o.FromThisComputer(r.RemoteAddr, localAddr(r)) {
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, o.LocalOrigin+r.URL.RequestURI(), http.StatusTemporaryRedirect)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func localAddr(r *http.Request) string {
	if a, ok := r.Context().Value(http.LocalAddrContextKey).(net.Addr); ok {
		return a.String()
	}
	return ""
}

func wrongHost(w http.ResponseWriter, origin, reason string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusMisdirectedRequest)
	_, _ = w.Write([]byte(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Wrong address</title><body><p>` +
		html.EscapeString(reason) + `</p><p>Open <a href="` + html.EscapeString(origin) + `/">` +
		html.EscapeString(origin) + `/</a></p></body></html>`))
}

// transport carries every request to the identity service. It is on the
// same machine, so a connection that does not open at once is not coming.
var transport = &http.Transport{
	DialContext:           (&dialer).DialContext,
	MaxIdleConnsPerHost:   16,
	IdleConnTimeout:       time.Minute,
	ResponseHeaderTimeout: time.Minute,
}

var dialer = net.Dialer{Timeout: 2 * time.Second}

// proxy passes `/identity/` to the identity service with the browser's Host,
// which picks the listener there. A passed-on answer carries only the
// identity service's own headers.
func proxy(o Options) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var target *url.URL
		if o.Identity != nil {
			target = o.Identity.Target()
		}
		if target == nil {
			if o.Configured != nil && !o.Configured() {
				// The usual state before setup, which the app asks about often.
				proxyLog(o, slog.LevelDebug, "Google sign-in is not set up. The identity route answers 503.", r)
				problem.Write(w, http.StatusServiceUnavailable, "google-not-configured", "Google sign-in is not set up yet")
				return
			}
			proxyLog(o, slog.LevelWarn, "The identity service is not running. The identity route answers 503.", r)
			problem.Write(w, http.StatusServiceUnavailable, "identity-unavailable", "The identity service is not running")
			return
		}
		rp := &httputil.ReverseProxy{
			Rewrite: func(pr *httputil.ProxyRequest) {
				pr.SetURL(target)
				pr.Out.Host = pr.In.Host
				// The identity service limits requests per device on the
				// home network, so it hears the device's address; any
				// address the browser sent is dropped.
				if ip, _, err := net.SplitHostPort(pr.In.RemoteAddr); err == nil {
					pr.Out.Header.Set("X-Forwarded-For", ip)
				}
			},
			Transport: transport,
			ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
				if r.Context().Err() == context.Canceled {
					return
				}
				proxyLog(o, slog.LevelError, "The identity service did not answer.", r, "error", err)
				set(w.Header(), baseHeaders)
				problem.Write(w, http.StatusBadGateway, "identity-unavailable", "The identity service did not answer")
			},
		}
		for _, kv := range baseHeaders {
			w.Header().Del(kv[0])
		}
		rp.ServeHTTP(w, r)
	})
}

// baseHeaders are what every answer the desktop writes itself carries.
var baseHeaders = [][2]string{
	{"X-Content-Type-Options", "nosniff"},
	{"X-Frame-Options", "DENY"},
	{"Referrer-Policy", "no-referrer"},
	{"Cross-Origin-Resource-Policy", "same-origin"},
	{"Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"},
}

// spaExtra are the headers every SPA answer carries beside baseHeaders.
// The SPA's own content security policy is a meta tag in its
// `index.html`; the header adds `frame-ancestors`, which a meta tag cannot
// carry, and `form-action`. `credentialless` embedding lets the editor
// isolate itself without breaking Google's avatars, and the opener policy
// lets the sign-in window report back.
var spaExtra = [][2]string{
	{"Content-Security-Policy", "frame-ancestors 'none'; form-action 'self'"},
	{"Cross-Origin-Embedder-Policy", "credentialless"},
	{"Cross-Origin-Opener-Policy", "same-origin-allow-popups"},
}

// desktopExtra are the headers every `/desktop/` answer carries beside
// baseHeaders: it is never cached and opens no window to other origins.
var desktopExtra = [][2]string{
	{"Cache-Control", "no-store"},
	{"Cross-Origin-Opener-Policy", "same-origin"},
}

const (
	// cacheAssets is the Cache-Control of the hashed files under /assets/.
	cacheAssets = "public, max-age=31536000, immutable"
	// cacheOther is the Cache-Control of every other SPA file.
	cacheOther = "no-cache"
	// withoutOpenerPolicy is the path prefix whose answers carry no
	// Cross-Origin-Opener-Policy: the connect window leaves for the
	// provider's site and stays reusable by name.
	withoutOpenerPolicy = "/app/connect/"
)

func set(h http.Header, kvs [][2]string) {
	for _, kv := range kvs {
		h.Set(kv[0], kv[1])
	}
}

// baseline gives every answer baseHeaders before the route's handler runs,
// so an answer no handler shapes, such as the router's own redirect, still
// carries them. Each handler adds its own set; the identity proxy removes
// them before it passes a request on.
func baseline(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		set(w.Header(), baseHeaders)
		next.ServeHTTP(w, r)
	})
}

func desktopHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		set(w.Header(), desktopExtra)
		next.ServeHTTP(w, r)
	})
}

func spaHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		opener := !strings.HasPrefix(r.URL.Path, withoutOpenerPolicy)
		for _, kv := range spaExtra {
			if opener || kv[0] != "Cross-Origin-Opener-Policy" {
				w.Header().Set(kv[0], kv[1])
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

// logged logs each request but the identity routes: the method, the route
// pattern that answered it (never the path, which can name a project), the
// status and the time it took. A successful read is a detail (DEBUG), a
// successful change a step (INFO), a refusal a WARN and a failure an ERROR.
func logged(logger *slog.Logger, next http.Handler) http.Handler {
	if logger == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, IdentityPrefix) {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		route := r.Pattern
		if i := strings.IndexByte(route, ' '); i >= 0 {
			route = route[i+1:]
		}
		if route == "" {
			route = "unmatched"
		}
		logger.LogAttrs(context.Background(), RequestLevel(r.Method, rec.status), r.Method+" "+route,
			slog.Int("status", rec.status),
			slog.Duration("took", time.Since(start).Round(time.Microsecond)))
	})
}

// RequestLevel answers the level of a request's log line.
func RequestLevel(method string, status int) slog.Level {
	switch {
	case status >= http.StatusInternalServerError:
		return slog.LevelError
	case status >= http.StatusBadRequest:
		return slog.LevelWarn
	case method == http.MethodGet || method == http.MethodHead:
		return slog.LevelDebug
	}
	return slog.LevelInfo
}

// proxyLog logs an identity request that the identity service did not
// answer, so its own log has no line for it. The path stays out: it can
// carry a flow id.
func proxyLog(o Options, level slog.Level, msg string, r *http.Request, args ...any) {
	if o.Logger != nil {
		o.Logger.Log(context.Background(), level, msg, append([]any{"method", r.Method}, args...)...)
	}
}
