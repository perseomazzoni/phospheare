// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package identityproc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/vault"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// binary is the identity service built from this repository for the tests.
var binary string

// TestMain builds the identity service once, or, run as the stand-in
// binary (IDENTITYPROC_FAKE), answers `google-check` the way it does.
func TestMain(m *testing.M) {
	if os.Getenv("IDENTITYPROC_FAKE") == "1" {
		os.Exit(fake(os.Args[1:]))
	}
	dir, err := os.MkdirTemp("", "identityproc")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	binary = filepath.Join(dir, "identity")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	build := exec.Command("go", "build", "-o", binary, "./cmd/identity")
	build.Dir = filepath.Join("..", "..", "..", "..", "identity")
	if out, err := build.CombinedOutput(); err != nil {
		fmt.Fprintf(os.Stderr, "building the identity service: %v\n%s", err, out)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

// fake answers `google-check` with one result per origin, the first ok and
// the others a redirect mismatch, and exits 1 as the binary does then. It
// exits 3 unless the client secret came on standard input, and only there.
func fake(args []string) int {
	if len(args) != 1 || args[0] != "google-check" {
		return 2
	}
	var secrets struct{ GoogleClientSecret string }
	if json.NewDecoder(os.Stdin).Decode(&secrets) != nil || secrets.GoogleClientSecret != configured.ClientSecret ||
		os.Getenv("IDENTITY_SECRETS_ON_STDIN") != "true" || os.Getenv("IDENTITY_GOOGLE_CLIENT_SECRET") != "" {
		return 3
	}
	type result struct {
		RedirectURI string `json:"redirectUri"`
		Result      string `json:"result"`
		Detail      string `json:"detail,omitempty"`
	}
	var out []result
	for i, o := range strings.Split(os.Getenv("IDENTITY_PUBLIC_ORIGINS"), ",") {
		r := result{RedirectURI: o + "/identity/google/callback", Result: "ok"}
		if i > 0 {
			r.Result, r.Detail = "redirect-mismatch", "redirect_uri_mismatch"
		}
		out = append(out, r)
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"results": out})
	return 1
}

const origin = "http://localhost:47821"

func newSupervisor(t *testing.T, set Settings) *Supervisor {
	t.Helper()
	s := &Supervisor{
		Binary:      binary,
		Vault:       vault.Memory(),
		ProductName: "Phospheare",
		Settings:    func() Settings { return set },
	}
	t.Cleanup(s.Stop)
	return s
}

var configured = Settings{
	Origins:      []string{origin},
	ClientID:     "1234-abcd.apps.googleusercontent.com",
	ClientSecret: "very-secret",
}

// session asks the running service for the session as the loopback
// listener's browser would, answering the status.
func session(t *testing.T, s *Supervisor) int {
	t.Helper()
	target := s.Target()
	if target == nil {
		t.Fatal("no identity service runs")
	}
	req, _ := http.NewRequest(http.MethodGet, target.String()+"/identity/session", nil)
	req.Host = "localhost:47821"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	if writer, ok := body["writerId"]; res.StatusCode == http.StatusOK && (!ok || writer != nil) {
		t.Fatalf("session answered %d %v", res.StatusCode, body)
	}
	return res.StatusCode
}

func TestSupervisorRunsTheServiceAndStopsIt(t *testing.T) {
	s := newSupervisor(t, configured)
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	if code := session(t, s); code != http.StatusOK {
		t.Fatalf("session: %d", code)
	}
	keys, _ := s.Vault.Get(domain.SecretSealKeys)
	if keys == "" {
		t.Fatal("the vault keeps no keyring")
	}
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	if again, _ := s.Vault.Get(domain.SecretSealKeys); again != keys {
		t.Fatal("a restart replaced the keyring")
	}
	target := s.Target()
	c := s.current.Load()
	s.Stop()
	if s.Target() != nil {
		t.Fatal("a stopped service still has a target")
	}
	if code := c.cmd.ProcessState.ExitCode(); code != 0 {
		t.Fatalf("the service did not drain and exit cleanly: exit %d", code)
	}
	if _, err := http.Get(target.String() + "/identity/session"); err == nil {
		t.Fatal("the stopped service still answers")
	}
	if err := s.Restart(); err != nil || s.Target() != nil {
		t.Fatalf("a stopped supervisor started again: %v", err)
	}
}

func TestSupervisorLeavesTheServiceStoppedWithoutAClient(t *testing.T) {
	s := newSupervisor(t, Settings{Origins: []string{origin}})
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	if s.Target() != nil {
		t.Fatal("the service started without a Google client")
	}
	if _, err := s.CheckGoogle(context.Background()); err == nil {
		t.Fatal("the check ran without a Google client")
	}
}

func TestSupervisorRestartMovesToANewChild(t *testing.T) {
	s := newSupervisor(t, configured)
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	first := s.current.Load()
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-first.done:
	default:
		t.Fatal("the first child still runs")
	}
	if code := session(t, s); code != http.StatusOK {
		t.Fatalf("session after restart: %d", code)
	}
}

func TestSupervisorRevivesAChildThatExits(t *testing.T) {
	s := newSupervisor(t, configured)
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	first := s.current.Load()
	_ = first.cmd.Process.Kill()
	deadline := time.Now().Add(10 * time.Second)
	for {
		if c := s.current.Load(); c != nil && c != first {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the service was not started again")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if code := session(t, s); code != http.StatusOK {
		t.Fatalf("session after the revival: %d", code)
	}
}

// switchable answers broken settings until fixed is set, and counts how
// often it was asked.
type switchable struct {
	fixed atomic.Bool
	asked atomic.Int32
}

var broken = Settings{Origins: []string{"not an origin"}, ClientID: "x", ClientSecret: "y"}

func (w *switchable) settings() Settings {
	w.asked.Add(1)
	if w.fixed.Load() {
		return configured
	}
	return broken
}

func waitForTarget(t *testing.T, s *Supervisor, not *child) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		if c := s.current.Load(); c != nil && c != not {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the service was not started again")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestSupervisorKeepsTryingAFailedFirstStart(t *testing.T) {
	w := &switchable{}
	s := newSupervisor(t, configured)
	s.Settings = w.settings
	s.RetryAfter = 10 * time.Millisecond
	if err := s.Start(); err == nil {
		t.Fatal("a broken configuration started")
	}
	deadline := time.Now().Add(10 * time.Second)
	for w.asked.Load() < 3 {
		if time.Now().After(deadline) {
			t.Fatal("the failed start was not tried again")
		}
		time.Sleep(10 * time.Millisecond)
	}
	w.fixed.Store(true)
	waitForTarget(t, s, nil)
	if code := session(t, s); code != http.StatusOK {
		t.Fatalf("session after the retry: %d", code)
	}
}

func TestSupervisorKeepsTryingAfterAFailedRevival(t *testing.T) {
	w := &switchable{}
	w.fixed.Store(true)
	s := newSupervisor(t, configured)
	s.Settings = w.settings
	s.RetryAfter = 10 * time.Millisecond
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	first := s.current.Load()
	w.fixed.Store(false)
	asked := w.asked.Load()
	_ = first.cmd.Process.Kill()
	deadline := time.Now().Add(10 * time.Second)
	for w.asked.Load() < asked+2 {
		if time.Now().After(deadline) {
			t.Fatal("the failed revival was not tried again")
		}
		time.Sleep(10 * time.Millisecond)
	}
	w.fixed.Store(true)
	waitForTarget(t, s, first)
}

func TestStopEndsAPendingRetry(t *testing.T) {
	w := &switchable{}
	s := newSupervisor(t, configured)
	s.Settings = w.settings
	s.RetryAfter = 50 * time.Millisecond
	if err := s.Start(); err == nil {
		t.Fatal("a broken configuration started")
	}
	s.Stop()
	asked := w.asked.Load()
	w.fixed.Store(true)
	time.Sleep(300 * time.Millisecond)
	if w.asked.Load() != asked || s.Target() != nil {
		t.Fatal("a retry ran after Stop")
	}
}

func TestRestartEndsAPendingRetry(t *testing.T) {
	w := &switchable{}
	s := newSupervisor(t, configured)
	s.Settings = w.settings
	s.RetryAfter = 200 * time.Millisecond
	if err := s.Start(); err == nil {
		t.Fatal("a broken configuration started")
	}
	w.fixed.Store(true)
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	running := s.current.Load()
	time.Sleep(500 * time.Millisecond)
	if s.current.Load() != running {
		t.Fatal("a retry replaced the service Restart started")
	}
}

func TestTheServiceStopsWhenItsStandardInputCloses(t *testing.T) {
	s := newSupervisor(t, configured)
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	// As the system closes it when the desktop dies.
	first := s.current.Load()
	_ = first.stdin.Close()
	select {
	case <-first.done:
	case <-time.After(4 * time.Second):
		t.Fatal("the service still runs with its standard input closed")
	}
	if code := first.cmd.ProcessState.ExitCode(); code != 0 {
		t.Fatalf("the service did not drain and exit cleanly: exit %d", code)
	}
}

func TestSupervisorReportsAServiceThatDoesNotStart(t *testing.T) {
	s := newSupervisor(t, Settings{Origins: []string{"not an origin"}, ClientID: "x", ClientSecret: "y"})
	err := s.Restart()
	if err == nil || s.Target() != nil {
		t.Fatalf("a service with a broken configuration started: %v", err)
	}
	missing := newSupervisor(t, configured)
	missing.Binary = filepath.Join(t.TempDir(), "absent")
	if err := missing.Restart(); err == nil {
		t.Fatal("a missing binary started")
	}
}

func TestSignOutBrowsersReplacesTheKeys(t *testing.T) {
	s := newSupervisor(t, configured)
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	before, _ := s.Vault.Get(domain.SecretSealKeys)
	if err := s.SignOutBrowsers(); err != nil {
		t.Fatal(err)
	}
	after, _ := s.Vault.Get(domain.SecretSealKeys)
	if after == "" || before == after {
		t.Fatal("the keyring did not change")
	}
	if code := session(t, s); code != http.StatusOK {
		t.Fatalf("session after sign-out: %d", code)
	}
}

func TestForgetKeysLeavesNoKeyringUntilTheNextStart(t *testing.T) {
	set := configured
	s := newSupervisor(t, Settings{})
	s.Settings = func() Settings { return set }
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	before, _ := s.Vault.Get(domain.SecretSealKeys)
	set = Settings{}
	if err := s.ForgetKeys(); err != nil {
		t.Fatal(err)
	}
	if keys, _ := s.Vault.Get(domain.SecretSealKeys); keys != "" {
		t.Fatal("the vault still keeps a keyring")
	}
	if s.Target() != nil {
		t.Fatal("the service runs without a Google client")
	}
	set = configured
	if err := s.Restart(); err != nil {
		t.Fatal(err)
	}
	if after, _ := s.Vault.Get(domain.SecretSealKeys); after == "" || after == before {
		t.Fatal("the next start did not make a new keyring")
	}
}

func TestCheckGoogleAnswersEveryOrigin(t *testing.T) {
	t.Setenv("IDENTITYPROC_FAKE", "1")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	s := newSupervisor(t, Settings{
		Origins:      []string{origin, "https://studio.example.com:47843"},
		ClientID:     configured.ClientID,
		ClientSecret: configured.ClientSecret,
	})
	s.Binary = exe
	results, err := s.CheckGoogle(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || results[0].Result != "ok" || results[1].Result != "redirect-mismatch" ||
		results[1].RedirectURI != "https://studio.example.com:47843/identity/google/callback" || results[1].Detail != "redirect_uri_mismatch" {
		t.Fatalf("results %+v", results)
	}
}

func TestEnvironmentDropsTheUsersIdentitySettings(t *testing.T) {
	t.Setenv("IDENTITY_LISTEN", ":1")
	t.Setenv("identity_google_client_id", "theirs")
	env := environment(configured, map[string]string{"IDENTITY_LISTEN": "127.0.0.1:5000"})
	var identity []string
	for _, kv := range env {
		if strings.HasPrefix(strings.ToUpper(kv), "IDENTITY_") {
			identity = append(identity, kv)
		}
	}
	want := []string{
		"IDENTITY_PUBLIC_ORIGINS=" + origin,
		"IDENTITY_GOOGLE_CLIENT_ID=" + configured.ClientID,
		"IDENTITY_SECRETS_ON_STDIN=true",
		"IDENTITY_LISTEN=127.0.0.1:5000",
	}
	if strings.Join(identity, "\n") != strings.Join(want, "\n") {
		t.Fatalf("environment %q", identity)
	}
}

func TestTheReadyLineSendsTheFirstLineAndCopiesTheRest(t *testing.T) {
	var out strings.Builder
	r := newReadyLine(&out)
	for _, p := range []string{"listening 127.0.0.1", ":5000\nfirst log\n", "second log\n"} {
		if n, err := r.Write([]byte(p)); n != len(p) || err != nil {
			t.Fatalf("write %q answered %d, %v", p, n, err)
		}
	}
	if got := <-r.first; got != "listening 127.0.0.1:5000\n" {
		t.Fatalf("first line %q", got)
	}
	if out.String() != "first log\nsecond log\n" {
		t.Fatalf("copied %q", out.String())
	}
}

func TestAStartLongerThanTheReadyLineIsSentAsItIs(t *testing.T) {
	var out strings.Builder
	r := newReadyLine(&out)
	_, _ = r.Write([]byte(strings.Repeat("x", maxReadyLine+1)))
	_, _ = r.Write([]byte("later\n"))
	select {
	case got := <-r.first:
		if len(got) != maxReadyLine+1 {
			t.Fatalf("first line of %d bytes", len(got))
		}
	default:
		t.Fatal("a start with no newline was held past the bound")
	}
	if out.String() != "later\n" {
		t.Fatalf("copied %q", out.String())
	}
}
