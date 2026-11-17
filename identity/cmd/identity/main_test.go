// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/config"
	"github.com/perseomazzoni/phospheare/identity/adapters/google"
	"github.com/perseomazzoni/phospheare/identity/adapters/seal"
	"github.com/perseomazzoni/phospheare/identity/domain"
)

func TestKeysNewPrintsALineTheKeyringReads(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := cli([]string{"keys", "new"}, strings.NewReader(""), &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	keys, err := seal.ParseKeys(out.String())
	if err != nil || len(keys) != 1 {
		t.Fatalf("keys %v, %v", keys, err)
	}
}

// fakeChecker answers a result per redirect URI.
type fakeChecker map[string]google.CheckResult

func (f fakeChecker) Check(_ context.Context, _ domain.Credentials, uri string) (google.CheckResult, string) {
	return f[uri], ""
}

func TestGoogleCheckReportsEveryOrigin(t *testing.T) {
	vars := map[string]string{
		"IDENTITY_PUBLIC_ORIGINS":       "http://localhost:47821,https://studio.example.test",
		"IDENTITY_GOOGLE_CLIENT_ID":     "id",
		"IDENTITY_GOOGLE_CLIENT_SECRET": "secret",
	}
	env := config.Environment{Getenv: func(k string) string { return vars[k] }}
	g := fakeChecker{
		"http://localhost:47821/identity/google/callback":      google.CheckOK,
		"https://studio.example.test/identity/google/callback": google.CheckRedirectMismatch,
	}
	var out, errOut bytes.Buffer
	if code := googleCheck(env, g, &out, &errOut); code != 1 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	var got struct {
		Results []struct{ RedirectURI, Result string }
	}
	if err := json.Unmarshal(out.Bytes(), &got); err != nil || len(got.Results) != 2 ||
		got.Results[0].Result != "ok" || got.Results[1].Result != "redirect-mismatch" {
		t.Fatalf("results %s, %v", out.String(), err)
	}
	g["https://studio.example.test/identity/google/callback"] = google.CheckOK
	out.Reset()
	if code := googleCheck(env, g, &out, &errOut); code != 0 {
		t.Fatalf("all ok: exit %d", code)
	}
	vars["IDENTITY_GOOGLE_CLIENT_ID"] = ""
	if code := googleCheck(env, g, &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "IDENTITY_GOOGLE_CLIENT_ID") {
		t.Fatalf("missing client: exit %d: %s", code, errOut.String())
	}
}

// net/http writes a handler's panic and its stack in one call; each line
// reaches the desktop as its own ERROR record.
func TestARequestsPanicIsAnErrorWithItsStack(t *testing.T) {
	var out bytes.Buffer
	logger := serverLog(slog.New(slog.NewJSONHandler(&out, nil)))
	logger.Print("http: TLS handshake error from 127.0.0.1:5000: EOF")
	logger.Print("http: panic serving 127.0.0.1:5001: boom\ngoroutine 7 [running]:\nmain.handler()")
	var levels []string
	for line := range strings.SplitSeq(strings.TrimSpace(out.String()), "\n") {
		var rec struct{ Level, Msg string }
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("line %q: %v", line, err)
		}
		levels = append(levels, rec.Level+" "+rec.Msg)
	}
	want := []string{
		"WARN http: TLS handshake error from 127.0.0.1:5000: EOF",
		"ERROR http: panic serving 127.0.0.1:5001: boom",
		"ERROR goroutine 7 [running]:",
		"ERROR main.handler()",
	}
	if strings.Join(levels, "\n") != strings.Join(want, "\n") {
		t.Fatalf("records %q", levels)
	}
}

func TestUnknownCommandShowsUsage(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := cli([]string{"keys", "old"}, strings.NewReader(""), &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "usage:") {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
}

func TestServeRefusesABadConfigurationNamingIt(t *testing.T) {
	for _, name := range []string{"IDENTITY_PUBLIC_ORIGINS", "IDENTITY_GOOGLE_CLIENT_ID", "IDENTITY_GOOGLE_CLIENT_SECRET",
		"IDENTITY_SEAL_KEYS_FILE", "IDENTITY_LISTEN", "IDENTITY_OPS_LISTEN"} {
		t.Setenv(name, "")
	}
	t.Setenv("IDENTITY_PUBLIC_ORIGINS", "http://studio.example.test")
	var out, errOut bytes.Buffer
	if code := cli(nil, strings.NewReader(""), &out, &errOut); code != 2 {
		t.Fatalf("exit %d", code)
	}
	for _, name := range []string{"IDENTITY_PUBLIC_ORIGINS", "IDENTITY_GOOGLE_CLIENT_ID", "IDENTITY_SEAL_KEYS_FILE"} {
		if !strings.Contains(errOut.String(), name) {
			t.Fatalf("the refusal does not name %s:\n%s", name, errOut.String())
		}
	}
}

func TestServeRefusesAKeyringThatDoesNotRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "seal.keys")
	if err := os.WriteFile(path, []byte("not a key"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("IDENTITY_PUBLIC_ORIGINS", "https://studio.example.test")
	t.Setenv("IDENTITY_GOOGLE_CLIENT_ID", "id")
	t.Setenv("IDENTITY_GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("IDENTITY_SEAL_KEYS_FILE", path)
	var out, errOut bytes.Buffer
	if code := cli(nil, strings.NewReader(""), &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "IDENTITY_SEAL_KEYS_FILE") {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
}

// stdinSecrets sets the environment of a service that takes its secrets on
// standard input, with no secret and no keyring file in it.
func stdinSecrets(t *testing.T) {
	t.Setenv("IDENTITY_PUBLIC_ORIGINS", "https://studio.example.test")
	t.Setenv("IDENTITY_GOOGLE_CLIENT_ID", "id")
	t.Setenv("IDENTITY_GOOGLE_CLIENT_SECRET", "")
	t.Setenv("IDENTITY_SEAL_KEYS_FILE", "")
	t.Setenv("IDENTITY_SECRETS_ON_STDIN", "true")
	t.Setenv("IDENTITY_LISTEN", "127.0.0.1:0")
	t.Setenv("IDENTITY_STOP_ON_STDIN_CLOSE", "true")
}

func TestServeTakesItsSecretsFromStdinAndStopsWhenItCloses(t *testing.T) {
	stdinSecrets(t)
	key, err := seal.NewKey()
	if err != nil {
		t.Fatal(err)
	}
	line, _ := json.Marshal(config.Secrets{GoogleClientSecret: "secret", SealKeys: key + "\n"})
	var out, errOut bytes.Buffer
	if code := cli(nil, strings.NewReader(string(line)+"\n"), &out, &errOut); code != 0 {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
	if !strings.Contains(errOut.String(), "identity service listening") {
		t.Fatalf("the service did not listen:\n%s", errOut.String())
	}
}

func TestServeRefusesAStdinKeyringThatDoesNotRead(t *testing.T) {
	stdinSecrets(t)
	line := `{"googleClientSecret":"secret","sealKeys":"not a key"}` + "\n"
	var out, errOut bytes.Buffer
	if code := cli(nil, strings.NewReader(line), &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "IDENTITY_SECRETS_ON_STDIN") {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
}

func TestServeRefusesAStdinWithoutTheSecretsLine(t *testing.T) {
	stdinSecrets(t)
	var out, errOut bytes.Buffer
	if code := cli(nil, strings.NewReader(""), &out, &errOut); code != 2 || !strings.Contains(errOut.String(), "IDENTITY_SECRETS_ON_STDIN") {
		t.Fatalf("exit %d: %s", code, errOut.String())
	}
}

// slowGoogle holds every code exchange until release is closed.
type slowGoogle struct {
	started chan struct{}
	release chan struct{}
}

func (g *slowGoogle) AuthEndpoint() string { return "https://accounts.example.test/auth" }

func (g *slowGoogle) Exchange(ctx context.Context, _ domain.Credentials, _, _, _ string) (*domain.Tokens, error) {
	close(g.started)
	<-g.release
	return nil, errors.New("refused")
}

func (g *slowGoogle) Refresh(context.Context, domain.Credentials, string) (*domain.Tokens, error) {
	return nil, errors.New("refused")
}

func (g *slowGoogle) Revoke(context.Context, string) error { return nil }

func listen(t *testing.T) net.Listener {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	return ln
}

func TestRunServesThenDrainsTheRequestsInFlight(t *testing.T) {
	ln := listen(t)
	base := "http://" + ln.Addr().String()
	origin, err := domain.ParseOrigin(base)
	if err != nil {
		t.Fatal(err)
	}
	sealer, _ := seal.New(bytes.Repeat([]byte{3}, 32))
	g := &slowGoogle{started: make(chan struct{}), release: make(chan struct{})}
	logs := &bytes.Buffer{}
	ctx, stop := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- run(ctx, service{
			cfg: config.Config{
				Origins: []domain.Origin{origin},
				Google:  domain.Credentials{ClientID: "id", ClientSecret: "secret"},
			},
			sealer: sealer,
			google: g,
			logger: slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
			drain:  5 * time.Second,
		}, ln)
	}()

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
	status := func(u string) int {
		res, err := client.Get(u)
		if err != nil {
			return 0
		}
		res.Body.Close()
		return res.StatusCode
	}
	proof := ""
	post := func(path string, body any) *http.Response {
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, base+path, bytes.NewReader(raw))
		req.Header.Set("X-Phospheare", "1")
		req.Header.Set("X-Phospheare-Session", proof)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	for i := 0; status(base+"/identity/session") == 0; i++ {
		if i > 100 {
			t.Fatal("never answered")
		}
		time.Sleep(20 * time.Millisecond)
	}
	opened := post("/identity/session", map[string]string{"writerId": "w"})
	var session struct{ Proof string }
	_ = json.NewDecoder(opened.Body).Decode(&session)
	opened.Body.Close()
	if opened.StatusCode != http.StatusOK || session.Proof == "" {
		t.Fatalf("open session %d", opened.StatusCode)
	}
	proof = session.Proof
	res := post("/identity/google/flows", map[string]string{"purpose": "identity", "writerId": "w"})
	var begun struct{ FlowID, AuthorizeURL string }
	_ = json.NewDecoder(res.Body).Decode(&begun)
	res.Body.Close()
	u, _ := url.Parse(begun.AuthorizeURL)
	if u.Query().Get("redirect_uri") != base+"/identity/google/callback" {
		t.Fatalf("redirect uri %q", u.Query().Get("redirect_uri"))
	}

	// A callback is waiting on Google when the service is told to stop.
	page := make(chan string, 1)
	go func() {
		res, err := client.Get(base + "/identity/google/callback?" + url.Values{"state": {begun.FlowID}, "code": {"c"}}.Encode())
		if err != nil {
			page <- err.Error()
			return
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		page <- string(body)
	}()
	<-g.started
	stop()
	// Draining takes no new connection while the one in flight finishes.
	for i := 0; ; i++ {
		c, err := net.DialTimeout("tcp", ln.Addr().String(), time.Second)
		if err != nil {
			break
		}
		c.Close()
		if i > 100 {
			t.Fatal("still accepting while draining")
		}
		time.Sleep(20 * time.Millisecond)
	}
	close(g.release)
	if p := <-page; !strings.Contains(p, `data-status="failed"`) {
		t.Fatalf("the request in flight did not finish: %s", p)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, err := net.DialTimeout("tcp", ln.Addr().String(), time.Second); err == nil {
		t.Fatal("still accepting after the drain")
	}
	for _, want := range []string{"identity service listening", "identity service draining", `msg="GET /identity/google/callback"`} {
		if !strings.Contains(logs.String(), want) {
			t.Fatalf("the log misses %q:\n%s", want, logs.String())
		}
	}
}

func TestUntilClosedEndsWhenTheReaderCloses(t *testing.T) {
	r, w := io.Pipe()
	ctx, cancel := untilClosed(context.Background(), r)
	defer cancel()
	if _, err := w.Write([]byte("ignored")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
		t.Fatal("the context ended while the reader was open")
	case <-time.After(50 * time.Millisecond):
	}
	w.Close()
	select {
	case <-ctx.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the context did not end once the reader closed")
	}
}
