// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Command identity runs the identity service: Google sign-in, the writer
// session and the sealed Drive connections, as the `/identity/` routes the
// SPA calls. It keeps no state of its own (`application`).
//
//	identity [serve]      run the service, configured by IDENTITY_* variables
//	identity keys new     print a fresh keyring line
//	identity google-check check the Google client against every origin's redirect URI
//	identity version      print the version
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/perseomazzoni/phospheare/identity"
	"github.com/perseomazzoni/phospheare/identity/adapters/config"
	"github.com/perseomazzoni/phospheare/identity/adapters/google"
	"github.com/perseomazzoni/phospheare/identity/adapters/seal"
	"github.com/perseomazzoni/phospheare/identity/domain"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// Set by the release build with -ldflags "-X main.version=... -X
// main.productName=...", the product name from `product.json`.
var (
	version     = "dev"
	productName = "Phospheare"
)

// googleEndpoints and driveFiles are where the service reaches Google. Only
// a development build changes them.
var (
	googleEndpoints = google.GoogleEndpoints
	driveFiles      = google.DriveFiles
)

// drainFor is how long a stopping service lets requests in flight finish.
const drainFor = 20 * time.Second

func main() { os.Exit(cli(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }

func cli(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	cmd := "serve"
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch {
	case cmd == "serve" && len(args) == 0:
		return serve(stdin, stdout, stderr)
	case cmd == "keys" && len(args) == 1 && args[0] == "new":
		key, err := seal.NewKey()
		if err != nil {
			fmt.Fprintln(stderr, "identity:", err)
			return 1
		}
		fmt.Fprintln(stdout, key)
		return 0
	case cmd == "google-check" && len(args) == 0:
		env, err := withSecrets(config.Environment{Getenv: os.Getenv}, bufio.NewReader(stdin))
		if err != nil {
			fmt.Fprintf(stderr, "identity: the configuration is not usable:\n%v\n", err)
			return 2
		}
		return googleCheck(env, google.NewClient(googleEndpoints), stdout, stderr)
	case cmd == "version" && len(args) == 0:
		fmt.Fprintln(stdout, "identity", version)
		return 0
	case cmd == "help" || cmd == "-h" || cmd == "--help":
		usage(stdout)
		return 0
	}
	usage(stderr)
	return 2
}

func usage(w io.Writer) {
	fmt.Fprint(w, `usage:
  identity [serve]      run the service, configured by IDENTITY_* variables
  identity keys new     print a fresh keyring line
  identity google-check check the Google client against every origin's redirect URI
  identity version      print the version
`)
}

// withSecrets reads the secrets line from in when env asks for it.
func withSecrets(env config.Environment, in *bufio.Reader) (config.Environment, error) {
	if !config.SecretsOnStdin(env) {
		return env, nil
	}
	secrets, err := config.ReadSecrets(in)
	if err != nil {
		return env, err
	}
	env.Secrets = &secrets
	return env, nil
}

func serve(stdin io.Reader, stdout, stderr io.Writer) int {
	in := bufio.NewReader(stdin)
	env, err := withSecrets(config.Environment{Getenv: os.Getenv}, in)
	var cfg config.Config
	if err == nil {
		cfg, err = config.Load(env)
	}
	if err != nil {
		fmt.Fprintf(stderr, "identity: the configuration is not usable:\n%v\n", err)
		return 2
	}
	logger := newLogger(stderr, cfg)
	setting := "IDENTITY_SEAL_KEYS_FILE"
	var sealer *seal.Sealer
	if cfg.SealKeys != "" {
		setting = "IDENTITY_SECRETS_ON_STDIN"
		sealer, err = seal.FromText(cfg.SealKeys)
	} else {
		sealer, err = seal.Load(cfg.SealKeysFile)
	}
	if err != nil {
		logger.Error("the seal keyring could not be read", "setting", setting, "error", err)
		return 2
	}
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		logger.Error("the public address could not be opened", "setting", "IDENTITY_LISTEN", "error", err)
		return 1
	}
	// The one line standard output carries: a parent that set port 0 learns
	// the port from it, and from nothing another process could answer.
	fmt.Fprintf(stdout, "listening %s\n", ln.Addr())
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if cfg.StopOnStdinClose {
		var cancel context.CancelFunc
		ctx, cancel = untilClosed(ctx, in)
		defer cancel()
	}
	err = run(ctx, service{
		cfg:    cfg,
		sealer: sealer,
		google: google.NewClient(googleEndpoints),
		drive:  google.NewDrive(driveFiles),
		logger: logger,
		drain:  drainFor,
	}, ln)
	if err != nil {
		logger.Error("the service stopped", "error", err)
		return 1
	}
	return 0
}

// untilClosed answers a context that ends with ctx or once r reaches its
// end, whichever comes first. Whatever r carries is discarded.
func untilClosed(ctx context.Context, r io.Reader) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithCancel(ctx)
	go func() {
		_, _ = io.Copy(io.Discard, r)
		cancel()
	}()
	return ctx, cancel
}

type service struct {
	cfg    config.Config
	sealer ports.Sealer
	google ports.Google
	drive  ports.Drive
	logger *slog.Logger
	drain  time.Duration
}

// run serves the routes on ln until ctx ends, then lets the requests in
// flight finish for up to s.drain, and returns.
func run(ctx context.Context, s service, ln net.Listener) error {
	cred := s.cfg.Google
	name := s.cfg.ProductName
	if name == "" {
		name = productName
	}
	listeners := make([]identity.Listener, len(s.cfg.Origins))
	origins := make([]string, len(s.cfg.Origins))
	for i, o := range s.cfg.Origins {
		listeners[i], origins[i] = identity.ListenerFor(o), o.URL
	}
	id := identity.New(identity.Options{
		ProductName: name,
		Clients:     ports.ClientFunc(func() (domain.Credentials, bool) { return cred, true }),
		Sealer:      s.sealer,
		Google:      s.google,
		Drive:       s.drive,
		Observer:    identity.Observer{Logger: s.logger.With("area", "http")},
	})
	public := newServer(id.Handler(listeners...), s.logger)
	failed := make(chan error, 1)
	go func() { failed <- public.Serve(ln) }()
	s.logger.Info("identity service listening", "area", "start", "version", version, "listen", ln.Addr().String(),
		"origins", strings.Join(origins, ","))

	var err error
	select {
	case <-ctx.Done():
	case err = <-failed:
	}
	s.logger.Info("identity service draining", "area", "start", "upTo", s.drain.String())
	stopCtx, cancel := context.WithTimeout(context.Background(), s.drain)
	defer cancel()
	drainErr := public.Shutdown(stopCtx)
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return drainErr
}

func newServer(h http.Handler, logger *slog.Logger) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		// The callback waits up to 30 s for Google's token endpoint.
		WriteTimeout:   60 * time.Second,
		IdleTimeout:    2 * time.Minute,
		MaxHeaderBytes: 32 << 10,
		ErrorLog:       serverLog(logger.With("area", "http")),
	}
}

// serverLog answers a server's ErrorLog. What the server complains of, such
// as a failed TLS handshake, is a WARN record for each line; a handler's
// panic is ERROR, each line of its stack too, so the stack stays with it.
func serverLog(logger *slog.Logger) *log.Logger {
	return log.New(serverErrors{logger}, "", 0)
}

type serverErrors struct{ logger *slog.Logger }

// Write gets one complaint, a panic with all its stack included.
func (s serverErrors) Write(p []byte) (int, error) {
	text := strings.TrimRight(string(p), "\n")
	level := slog.LevelWarn
	if strings.HasPrefix(text, "http: panic serving") {
		level = slog.LevelError
	}
	for line := range strings.SplitSeq(text, "\n") {
		if strings.TrimSpace(line) != "" {
			s.logger.Log(context.Background(), level, line)
		}
	}
	return len(p), nil
}

type checker interface {
	Check(ctx context.Context, cred domain.Credentials, redirectURI string) (google.CheckResult, string)
}

// googleCheck checks the configured Google client against the redirect URI
// of every origin, from IDENTITY_PUBLIC_ORIGINS and the IDENTITY_GOOGLE_*
// settings, and prints one JSON object: {"results": [{redirectUri, result,
// detail}]}. It exits 0 only when every result is "ok".
func googleCheck(env config.Environment, g checker, stdout, stderr io.Writer) int {
	c, err := config.LoadClient(env)
	if err != nil {
		fmt.Fprintf(stderr, "identity: the configuration is not usable:\n%v\n", err)
		return 2
	}
	type result struct {
		RedirectURI string `json:"redirectUri"`
		Result      string `json:"result"`
		Detail      string `json:"detail,omitempty"`
	}
	out := struct {
		Results []result `json:"results"`
	}{}
	code := 0
	for _, o := range c.Origins {
		uri := o.URL + identity.CallbackPath
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		res, detail := g.Check(ctx, c.Google, uri)
		cancel()
		if res != google.CheckOK {
			code = 1
		}
		out.Results = append(out.Results, result{RedirectURI: uri, Result: string(res), Detail: detail})
	}
	_ = json.NewEncoder(stdout).Encode(out)
	return code
}

// newLogger answers the service's logger: text lines for a person at a
// terminal, or JSON lines for the desktop program, which writes them into
// its own log file.
func newLogger(w io.Writer, cfg config.Config) *slog.Logger {
	opts := &slog.HandlerOptions{Level: cfg.LogLevel}
	if cfg.LogJSON {
		return slog.New(slog.NewJSONHandler(w, opts))
	}
	return slog.New(slog.NewTextHandler(w, opts))
}
