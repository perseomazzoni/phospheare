// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package identityproc runs the identity service as a child process: the
// same `identity` binary a hosted deployment runs, configured through its
// IDENTITY_* environment from the desktop's settings. The child binds a
// free loopback port itself and prints it on its standard output, and the
// front proxies to it. The desktop holds the child's standard input open,
// and the child stops once it closes, as it does when the desktop exits
// however it ends. A child that exits on its own is started again; one the
// desktop stops is not. A start that fails is tried again after a pause that
// grows with each failure in a row. The seal keyring is kept in the desktop's vault
// and made by the binary: `identity keys new` makes it on the first start
// and makes its replacement, so the desktop holds no cryptographic code.
// The keyring and the Google client secret reach the child as one line on
// its standard input (IDENTITY_SECRETS_ON_STDIN), so neither is in its
// environment or on disk.
package identityproc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// Settings are what one run of the service is configured with.
type Settings struct {
	Origins      []string
	ClientID     string
	ClientSecret string
}

// Configured reports whether a Google client is set, without which the
// service does not start.
func (s Settings) Configured() bool { return s.ClientID != "" && s.ClientSecret != "" }

// Supervisor starts, watches and stops the identity service.
type Supervisor struct {
	// Binary is the `identity` executable.
	Binary string
	// Vault keeps the seal keyring.
	Vault ports.Vault
	// ProductName names the product on the pages the service serves.
	ProductName string
	// Settings answers the settings of the next run.
	Settings func() Settings
	// Log takes the supervisor's own lines; it may be nil.
	Log *slog.Logger
	// Output takes the service's own log, which it writes as JSON lines
	// when LogLevel is set; the desktop's standard error when nil.
	Output io.Writer
	// LogLevel answers the level the service logs at, by name (debug,
	// info, warn or error); nil leaves the service's own default and text
	// lines.
	LogLevel func() string
	// ReadyTimeout bounds a start; 15 seconds when zero.
	ReadyTimeout time.Duration
	// RetryAfter is the first pause before a failed start is tried again;
	// each failure in a row doubles it, up to 32 times. One second when
	// zero.
	RetryAfter time.Duration

	restart sync.Mutex
	current atomic.Pointer[child]
	stopped atomic.Bool
	// failures counts the starts in a row that failed or ended on their
	// own, for the back-off.
	failures atomic.Int32
	// retrying cancels the pending retry, which a Restart or Stop
	// supersedes. It is guarded by restart.
	retrying context.CancelFunc
}

var _ ports.IdentityService = (*Supervisor)(nil)

type child struct {
	cmd *exec.Cmd
	// stdin is the child's standard input; closing it stops the child.
	stdin    io.WriteCloser
	target   *url.URL
	started  time.Time
	done     chan struct{}
	expected atomic.Bool
}

// Target answers where the running service listens, or nil while none runs.
func (s *Supervisor) Target() *url.URL {
	if c := s.current.Load(); c != nil {
		return c.target
	}
	return nil
}

// Restart stops the running service and starts it again with the current
// settings, as `ports.IdentityService` states.
func (s *Supervisor) Restart() error {
	s.restart.Lock()
	defer s.restart.Unlock()
	s.cancelRetry()
	return s.restartLocked()
}

// Start starts the service as Restart does and, when the start fails, keeps
// trying in the background until a start succeeds or a Restart or Stop
// supersedes it. The error is the first start's.
func (s *Supervisor) Start() error {
	s.restart.Lock()
	defer s.restart.Unlock()
	s.cancelRetry()
	err := s.restartLocked()
	if err != nil {
		s.retryLocked()
	}
	return err
}

// restartLocked is Restart with s.restart held.
func (s *Supervisor) restartLocked() error {
	if old := s.current.Swap(nil); old != nil {
		s.stop(old)
	}
	if s.stopped.Load() {
		return nil
	}
	set := s.Settings()
	if !set.Configured() {
		return nil
	}
	c, err := s.start(set)
	if err != nil {
		return err
	}
	s.current.Store(c)
	return nil
}

// Stop stops the service for good.
func (s *Supervisor) Stop() {
	s.restart.Lock()
	defer s.restart.Unlock()
	s.cancelRetry()
	s.stopped.Store(true)
	if old := s.current.Swap(nil); old != nil {
		s.stop(old)
	}
}

// SignOutBrowsers replaces the keyring with one new key and restarts the
// service, as `ports.IdentityService` states.
func (s *Supervisor) SignOutBrowsers() error {
	if _, err := s.newKeyring(); err != nil {
		return err
	}
	return s.Restart()
}

// ForgetKeys removes the keyring from the vault and restarts the service,
// as `ports.IdentityService` states.
func (s *Supervisor) ForgetKeys() error {
	if err := s.Vault.Set(domain.SecretSealKeys, ""); err != nil {
		return fmt.Errorf("the seal keyring could not be removed: %w", err)
	}
	return s.Restart()
}

// keyring answers the seal keyring the vault keeps, making one when it
// keeps none.
func (s *Supervisor) keyring() (string, error) {
	keys, err := s.Vault.Get(domain.SecretSealKeys)
	if err != nil || keys != "" {
		return keys, err
	}
	return s.newKeyring()
}

// newKeyring makes a keyring of one new key with `identity keys new` and
// keeps it in the vault in place of the old one.
func (s *Supervisor) newKeyring() (string, error) {
	var out, errOut bytes.Buffer
	cmd := exec.Command(s.Binary, "keys", "new")
	cmd.Stdout, cmd.Stderr = &out, &errOut
	prepare(cmd)
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("identity keys new: %v: %s", err, strings.TrimSpace(errOut.String()))
	}
	keys := out.String()
	if err := s.Vault.Set(domain.SecretSealKeys, keys); err != nil {
		return "", fmt.Errorf("the seal keyring could not be kept: %w", err)
	}
	return keys, nil
}

// secretsLine answers the line the child reads first on its standard
// input.
func secretsLine(set Settings, keys string) ([]byte, error) {
	line, err := json.Marshal(struct {
		GoogleClientSecret string `json:"googleClientSecret"`
		SealKeys           string `json:"sealKeys,omitempty"`
	}{set.ClientSecret, keys})
	return append(line, '\n'), err
}

// CheckGoogle runs `identity google-check` with the current settings.
func (s *Supervisor) CheckGoogle(ctx context.Context) ([]domain.GoogleCheck, error) {
	set := s.Settings()
	if !set.Configured() {
		return nil, errors.New("no Google client is saved")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	var out, errOut bytes.Buffer
	line, err := secretsLine(set, "")
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, s.Binary, "google-check")
	cmd.Env = environment(set, map[string]string{})
	cmd.Stdin = bytes.NewReader(line)
	cmd.Stdout, cmd.Stderr = &out, &errOut
	prepare(cmd)
	err = cmd.Run()
	var exit *exec.ExitError
	if err != nil && !(errors.As(err, &exit) && exit.ExitCode() == 1) {
		return nil, fmt.Errorf("identity google-check: %v: %s", err, strings.TrimSpace(errOut.String()))
	}
	var answer struct {
		Results []domain.GoogleCheck `json:"results"`
	}
	if err := json.Unmarshal(out.Bytes(), &answer); err != nil {
		return nil, fmt.Errorf("identity google-check answered %q", out.String())
	}
	return answer.Results, nil
}

// environment answers the child's environment: the desktop's own, without
// any IDENTITY_* setting of the user's, plus set's settings that are not
// secret and extra. The secrets follow on standard input.
func environment(set Settings, extra map[string]string) []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(kv), "IDENTITY_") {
			env = append(env, kv)
		}
	}
	env = append(env,
		"IDENTITY_PUBLIC_ORIGINS="+strings.Join(set.Origins, ","),
		"IDENTITY_GOOGLE_CLIENT_ID="+set.ClientID,
		"IDENTITY_SECRETS_ON_STDIN=true",
	)
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	return env
}

func (s *Supervisor) start(set Settings) (*child, error) {
	keys, err := s.keyring()
	if err != nil {
		return nil, err
	}
	line, err := secretsLine(set, keys)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(s.Binary, "serve")
	// Port 0: the service binds a free port itself and prints the address,
	// so no other process can take the port between a choice here and the
	// bind there.
	cmd.Env = environment(set, map[string]string{
		"IDENTITY_LISTEN":              "127.0.0.1:0",
		"IDENTITY_PRODUCT_NAME":        s.ProductName,
		"IDENTITY_STOP_ON_STDIN_CLOSE": "true",
	})
	if s.LogLevel != nil {
		cmd.Env = append(cmd.Env, "IDENTITY_LOG_FORMAT=json", "IDENTITY_LOG_LEVEL="+s.LogLevel())
	}
	var output io.Writer = os.Stderr
	if s.Output != nil {
		output = s.Output
	}
	cmd.Stderr = output
	// exec copies the standard output into ready, and Wait returns only after
	// that copy ends, so no output is lost when the child exits. WaitDelay
	// bounds that wait if something else keeps the pipe open after the exit.
	ready := newReadyLine(output)
	cmd.Stdout = ready
	cmd.WaitDelay = time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	prepare(cmd)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("the identity service did not start: %w", err)
	}
	if err := adopt(cmd); err != nil {
		s.log().Warn("The identity service could not be tied to this program.", "error", err)
	}
	c := &child{
		cmd:     cmd,
		stdin:   stdin,
		started: time.Now(),
		done:    make(chan struct{}),
	}
	go s.watch(c)
	if _, err := stdin.Write(line); err != nil {
		s.stop(c)
		return nil, fmt.Errorf("the identity service did not take its secrets: %w", err)
	}
	addr, err := s.waitReady(c, ready.first)
	if err != nil {
		s.stop(c)
		return nil, err
	}
	c.target = &url.URL{Scheme: "http", Host: addr}
	return c, nil
}

// readyPrefix starts the one line the service prints once it listens.
const readyPrefix = "listening "

// maxReadyLine bounds what readyLine holds before the first newline. A
// longer start is not the ready line.
const maxReadyLine = 4096

// readyLine is the child's standard output. It sends the first line on
// first and copies everything after it to output. A write never fails, so
// a slow or broken output never blocks the child.
type readyLine struct {
	mu     sync.Mutex
	held   []byte
	sent   bool
	first  chan string
	output io.Writer
}

func newReadyLine(output io.Writer) *readyLine {
	return &readyLine{first: make(chan string, 1), output: output}
}

func (r *readyLine) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sent {
		_, _ = r.output.Write(p)
		return len(p), nil
	}
	r.held = append(r.held, p...)
	end := bytes.IndexByte(r.held, '\n')
	if end < 0 && len(r.held) <= maxReadyLine {
		return len(p), nil
	}
	if end < 0 {
		end = len(r.held) - 1
	}
	r.sent = true
	r.first <- string(r.held[:end+1])
	if rest := r.held[end+1:]; len(rest) > 0 {
		_, _ = r.output.Write(rest)
	}
	r.held = nil
	return len(p), nil
}

// waitReady waits for the line the service prints once it listens, which
// it does once its configuration and keyring have read, and answers the
// loopback address it listens on. Only the service writes on that pipe, so
// nothing else on the machine can answer for it.
func (s *Supervisor) waitReady(c *child, first <-chan string) (string, error) {
	timeout := s.ReadyTimeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	stopped := errors.New("the identity service stopped while starting; its log says why")
	select {
	case line := <-first:
		addr, ok := strings.CutPrefix(strings.TrimSpace(line), readyPrefix)
		if !ok {
			return "", fmt.Errorf("the identity service did not say where it listens: %q", line)
		}
		if host, _, err := net.SplitHostPort(addr); err != nil || !net.ParseIP(host).IsLoopback() {
			return "", fmt.Errorf("the identity service listens off the loopback: %s", addr)
		}
		return addr, nil
	case <-c.done:
		return "", stopped
	case <-time.After(timeout):
		return "", fmt.Errorf("the identity service was not ready within %s", timeout)
	}
}

// watch waits for c to exit and, when nobody asked it to, starts the
// service again through the retry loop.
func (s *Supervisor) watch(c *child) {
	err := c.cmd.Wait()
	close(c.done)
	if c.expected.Load() {
		return
	}
	s.log().Error("The identity service stopped by itself. Starting it again.", "error", err)
	if time.Since(c.started) > time.Minute {
		s.failures.Store(0)
	}
	s.restart.Lock()
	defer s.restart.Unlock()
	if s.current.Load() == c && !s.stopped.Load() {
		s.cancelRetry()
		s.retryLocked()
	}
}

// retryLocked starts the retry loop; s.restart must be held.
func (s *Supervisor) retryLocked() {
	ctx, cancel := context.WithCancel(context.Background())
	s.retrying = cancel
	go s.retry(ctx)
}

// cancelRetry ends the pending retry, if any; s.restart must be held.
func (s *Supervisor) cancelRetry() {
	if s.retrying != nil {
		s.retrying()
		s.retrying = nil
	}
}

// retry starts the service again after a back-off that grows with each
// failure in a row, until a start succeeds or ctx is cancelled.
func (s *Supervisor) retry(ctx context.Context) {
	first := s.RetryAfter
	if first == 0 {
		first = time.Second
	}
	for {
		n := s.failures.Add(1)
		t := time.NewTimer(first << min(n-1, 5))
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
		s.restart.Lock()
		if ctx.Err() != nil || s.stopped.Load() {
			s.restart.Unlock()
			return
		}
		err := s.restartLocked()
		if err == nil {
			s.retrying = nil
			s.restart.Unlock()
			return
		}
		s.restart.Unlock()
		s.log().Error("The identity service did not start.", "error", err)
	}
}

// stop ends c, letting it drain briefly.
func (s *Supervisor) stop(c *child) {
	c.expected.Store(true)
	_ = c.stdin.Close()
	select {
	case <-c.done:
	case <-time.After(5 * time.Second):
		_ = c.cmd.Process.Kill()
		<-c.done
	}
}

func (s *Supervisor) log() *slog.Logger {
	if s.Log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return s.Log
}
