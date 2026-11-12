// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/configfile"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec/desectest"
	"github.com/perseomazzoni/phospheare/desktop/internal/application"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

type fakeLAN struct {
	status   application.Status
	startErr error
	starts   int
	stops    int
	picks    int
	picked   int
	held     int
	// terms is the agreement in force, accepted the one accepted.
	terms    string
	accepted string
	termsErr error
}

func (f *fakeLAN) Terms(context.Context) (application.TermsState, error) {
	return application.TermsState{URL: f.terms, Accepted: f.terms == f.accepted}, f.termsErr
}

func (f *fakeLAN) AcceptTerms(_ context.Context, address string) error {
	if f.termsErr != nil {
		return f.termsErr
	}
	if address != f.terms {
		return application.ErrTermsChanged
	}
	f.accepted = address
	if f.status.State == application.StateOff {
		f.status = application.Status{State: application.StateStarting}
	}
	return nil
}

func (f *fakeLAN) TurnOn() error {
	f.starts++
	if f.startErr != nil {
		return f.startErr
	}
	f.status = application.Status{State: application.StateStarting}
	return nil
}
func (f *fakeLAN) TurnOff() error {
	f.stops++
	f.status = application.Status{State: application.StateOff}
	return nil
}
func (f *fakeLAN) Status() application.Status { return f.status }
func (f *fakeLAN) Ports() application.PortChoice {
	return application.PortChoice{Suggested: f.picked}
}
func (f *fakeLAN) PickPort() { f.picks++ }
func (f *fakeLAN) CheckPort(port int) error {
	if port == f.held {
		return errors.New("The number can't be used.")
	}
	return nil
}

// Stop is what a wipe calls.
func (f *fakeLAN) Stop() error { return f.TurnOff() }

type fakeAutostart struct {
	exe  string
	args []string
	on   bool
}

func (f *fakeAutostart) Enable(exe string, args []string) error {
	f.exe, f.args, f.on = exe, args, true
	return nil
}
func (f *fakeAutostart) Disable() error         { f.on = false; return nil }
func (f *fakeAutostart) Enabled() (bool, error) { return f.on, nil }

// fakeIdentity stands for the identity service the desktop runs.
type fakeIdentity struct {
	restarts   int
	signOuts   int
	forgets    int
	restartErr error
	checks     []domain.GoogleCheck
}

func (f *fakeIdentity) Restart() error {
	f.restarts++
	return f.restartErr
}
func (f *fakeIdentity) SignOutBrowsers() error { f.signOuts++; return nil }
func (f *fakeIdentity) ForgetKeys() error      { f.forgets++; return nil }
func (f *fakeIdentity) CheckGoogle(context.Context) ([]domain.GoogleCheck, error) {
	return f.checks, nil
}

// forgetNothing stands for the home-network certificate.
type forgetNothing struct{}

func (forgetNothing) Forget() error { return nil }

type fixture struct {
	a     *Admin
	h     http.Handler
	lan   *fakeLAN
	auto  *fakeAutostart
	id    *fakeIdentity
	desec *desectest.Fake
	quit  chan struct{}
}

func newFixture(t *testing.T) *fixture {
	f := &fixture{lan: &fakeLAN{status: application.Status{State: application.StateOff}}, auto: &fakeAutostart{}, id: &fakeIdentity{}, quit: make(chan struct{}, 1)}
	github := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"tag_name": "v1.4.0", "html_url": "https://github.com/perseomazzoni/phospheare/releases/tag/v1.4.0"})
	}))
	t.Cleanup(github.Close)
	f.desec = desectest.New()
	t.Cleanup(f.desec.Close)
	config := configfile.Memory(domain.Config{
		Google: domain.Google{ClientID: "1234-abcd.apps.googleusercontent.com", ClientSecret: "very-secret"},
		LAN:    domain.LAN{Port: 47843},
	})
	// Each read moves the clock on by a millisecond. On Windows time.Now can
	// answer the same instant twice in a row, and the login gap then holds
	// back a check that follows another at once.
	start := time.Now()
	var ticks atomic.Int64
	f.a = &Admin{
		Version:        "1.3.0",
		ProductName:    "Phospheare",
		DataDir:        "/data",
		Host:           "localhost:47821",
		LoopbackOrigin: "http://localhost:47821",
		Key:            testKey,
		Tray:           true,
		Config:         config,
		Identity:       f.id,
		LAN:            f.lan,
		Name: &application.HomeName{
			Config:   config,
			Account:  &desec.Client{BaseURL: f.desec.URL, HTTP: f.desec.Client()},
			Now:      func() time.Time { return start.Add(time.Duration(ticks.Add(1)) * time.Millisecond) },
			LoginGap: time.Nanosecond,
		},
		Addresses: func() ([]domain.Address, error) {
			return []domain.Address{{IP: "192.168.1.20", Interface: "wlan0"}}, nil
		},
		Autostart:  f.auto,
		Wipe:       &application.Wipe{Config: config, Identity: f.id, LAN: f.lan, Certs: forgetNothing{}, Autostart: f.auto},
		Executable: func() (string, error) { return "/opt/phospheare/once-dark-studio-desktop", nil },
		HTTP:       http.DefaultClient,
		ReleaseURL: github.URL,
		Quit:       func() { f.quit <- struct{}{} },
	}
	f.h = f.a.Handler()
	return f
}

func (f *fixture) call(method, path string, body any, headers ...string) *httptest.ResponseRecorder {
	var rd io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Host = "localhost:47821"
	req.Header.Set("X-Phospheare-Admin", "1")
	req.Header.Set(KeyHeader, testKey)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i+1] == "" {
			req.Header.Del(headers[i])
		} else {
			req.Header.Set(headers[i], headers[i+1])
		}
	}
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

func body(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%d %q: %v", rec.Code, rec.Body.String(), err)
	}
	return out
}

func TestAdminRefusesOtherHosts(t *testing.T) {
	f := newFixture(t)
	for _, host := range []string{"127.0.0.1:47821", "evil.example.test:47821", "studio.example.com:47843", "localhost:1"} {
		for _, p := range []string{"/desktop/setup/", "/desktop/setup/api/state"} {
			if rec := f.callHost(host, p); rec.Code != http.StatusMisdirectedRequest {
				t.Fatalf("%s %s: %d", host, p, rec.Code)
			}
		}
	}
}

func (f *fixture) callHost(host, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Host = host
	req.Header.Set("X-Phospheare-Admin", "1")
	req.Header.Set(KeyHeader, testKey)
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

func TestAdminHostCheckUsesRequestHost(t *testing.T) {
	f := newFixture(t)
	if rec := f.callHost("127.0.0.1:47821", "/desktop/setup/api/state"); rec.Code != http.StatusMisdirectedRequest {
		t.Fatalf("rebinding host: %d", rec.Code)
	}
	if rec := f.callHost("localhost:47821", "/desktop/setup/api/state"); rec.Code != http.StatusOK {
		t.Fatalf("own host: %d", rec.Code)
	}
}

func TestAdminAPIRequiresHeaderAndSameOrigin(t *testing.T) {
	f := newFixture(t)
	if rec := f.call(http.MethodGet, "/desktop/setup/api/state", nil, "X-Phospheare-Admin", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("missing header: %d", rec.Code)
	}
	if rec := f.call(http.MethodPost, "/desktop/setup/api/quit", nil, "Sec-Fetch-Site", "cross-site"); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-site: %d", rec.Code)
	}
	select {
	case <-f.quit:
		t.Fatal("a refused request quit the host")
	default:
	}
	if rec := f.call(http.MethodGet, "/desktop/setup/", nil, "X-Phospheare-Admin", ""); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Header().Get("Content-Security-Policy"), "script-src 'self'") {
		t.Fatalf("page: %d %q", rec.Code, rec.Header().Get("Content-Security-Policy"))
	}
}

func TestAdminStateNeverAnswersSecrets(t *testing.T) {
	f := newFixture(t)
	rec := f.call(http.MethodGet, "/desktop/setup/api/state", nil)
	raw := rec.Body.String()
	_ = f.a.Config.Update(func(c *domain.Config) {
		c.LAN.DeSEC = domain.DeSEC{Name: "rossi", Email: "name@example.com", PendingPassword: "pending-secret"}
	})
	raw += f.call(http.MethodGet, "/desktop/setup/api/state", nil).Body.String()
	_ = f.a.Config.Update(func(c *domain.Config) { c.LAN.DeSEC = domain.DeSEC{Name: "rossi", Token: "desec-secret-token"} })
	raw += f.call(http.MethodGet, "/desktop/setup/api/state", nil).Body.String()
	for _, secret := range []string{"very-secret", "pending-secret", "desec-secret-token", "1234-abcd"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("state carries %q: %s", secret, raw)
		}
	}
	g := body(t, rec)["google"].(map[string]any)
	if g["clientIdEnd"] != "abcd" || g["secretSet"] != true || g["clientIdSet"] != true {
		t.Fatalf("google %v", g)
	}
	if uris := g["redirectUris"].([]any); len(uris) != 1 || uris[0].(map[string]any)["uri"] != "http://localhost:47821/identity/google/callback" {
		t.Fatalf("uris %v", uris)
	}
}

func TestAdminSavesGoogleAndKeepsSecretWhenEmpty(t *testing.T) {
	f := newFixture(t)
	if rec := f.call(http.MethodPut, "/desktop/setup/api/google", map[string]string{"clientId": "999-new.apps.googleusercontent.com"}); rec.Code != http.StatusNoContent {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	g := f.a.Config.Get().Google
	if g.ClientID != "999-new.apps.googleusercontent.com" || g.ClientSecret != "very-secret" {
		t.Fatalf("google %+v", g)
	}
	if f.id.restarts != 1 {
		t.Fatalf("the identity service was restarted %d times", f.id.restarts)
	}
	if rec := f.call(http.MethodPut, "/desktop/setup/api/google", map[string]string{"clientId": "not-a-client"}); rec.Code != http.StatusBadRequest || f.id.restarts != 1 {
		t.Fatalf("bad id: %d, %d restarts", rec.Code, f.id.restarts)
	}
}

func TestAdminSaysWhenTheIdentityServiceDoesNotStart(t *testing.T) {
	f := newFixture(t)
	f.id.restartErr = errors.New("the identity service was not ready within 15s")
	rec := f.call(http.MethodPut, "/desktop/setup/api/google", map[string]string{"clientId": "999-new.apps.googleusercontent.com"})
	if rec.Code != http.StatusInternalServerError || body(t, rec)["code"] != "identity-failed" {
		t.Fatalf("failed restart: %d %s", rec.Code, rec.Body.String())
	}
	if f.a.Config.Get().Google.ClientID != "999-new.apps.googleusercontent.com" {
		t.Fatal("the client was not saved")
	}
}

func TestAdminCheckGoogle(t *testing.T) {
	f := newFixture(t)
	f.id.checks = []domain.GoogleCheck{
		{RedirectURI: "http://localhost:47821/identity/google/callback", Result: "ok"},
		{RedirectURI: "https://rossi.dedyn.io:47843/identity/google/callback", Result: "redirect-mismatch", Detail: "redirect_uri_mismatch"},
	}
	results := body(t, f.call(http.MethodPost, "/desktop/setup/api/google/check", nil))["results"].([]any)
	if len(results) != 2 {
		t.Fatalf("results %v", results)
	}
	local, lanResult := results[0].(map[string]any), results[1].(map[string]any)
	if local["result"] != "ok" || lanResult["result"] != "redirect-mismatch" || lanResult["redirectUri"] != "https://rossi.dedyn.io:47843/identity/google/callback" || lanResult["detail"] != "redirect_uri_mismatch" {
		t.Fatalf("results %v", results)
	}
	_ = f.a.Config.Update(func(c *domain.Config) { c.Google = domain.Google{} })
	if rec := f.call(http.MethodPost, "/desktop/setup/api/google/check", nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("check without a client: %d", rec.Code)
	}
}

func TestAdminRedirectURIsNameEveryOrigin(t *testing.T) {
	f := newFixture(t)
	_ = f.a.Config.Update(func(c *domain.Config) {
		c.LAN.DeSEC, c.LAN.Port = domain.DeSEC{Name: "rossi", Token: "t"}, 443
	})
	g := body(t, f.call(http.MethodGet, "/desktop/setup/api/state", nil))["google"].(map[string]any)
	uris := g["redirectUris"].([]any)
	if len(uris) != 2 {
		t.Fatalf("redirect URIs %v", uris)
	}
	computer, home := uris[0].(map[string]any), uris[1].(map[string]any)
	if computer["for"] != "computer" || computer["uri"] != "http://localhost:47821/identity/google/callback" ||
		home["for"] != "home" || home["uri"] != "https://rossi.dedyn.io/identity/google/callback" {
		t.Fatalf("redirect URIs %v", uris)
	}
}

func TestAdminLANControls(t *testing.T) {
	f := newFixture(t)
	// The settings leave the switch alone: only turning it on or off moves it.
	_ = f.a.Config.Update(func(c *domain.Config) { c.LAN.DeSEC, c.LAN.AutoStart = domain.DeSEC{Name: "rossi", Token: "t"}, true })
	save := map[string]any{"port": 47843, "address": "192.168.1.20", "autoStart": false}
	if rec := f.call(http.MethodPut, "/desktop/setup/api/lan", save); rec.Code != http.StatusNoContent {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	c := f.a.Config.Get().LAN
	if c.Address != "192.168.1.20" || !c.AutoStart || c.DeSEC.Token != "t" {
		t.Fatalf("lan %+v", c)
	}
	if f.id.restarts != 0 {
		t.Fatalf("the same origin restarted the identity service %d times", f.id.restarts)
	}
	save["port"] = 47900
	if rec := f.call(http.MethodPut, "/desktop/setup/api/lan", save); rec.Code != http.StatusNoContent || f.id.restarts != 1 {
		t.Fatalf("a new port did not restart the identity service: %d, %d restarts", rec.Code, f.id.restarts)
	}
	save["port"] = 0
	if rec := f.call(http.MethodPut, "/desktop/setup/api/lan", save); rec.Code != http.StatusBadRequest {
		t.Fatalf("port 0: %d", rec.Code)
	}
	// A number that cannot be opened is refused, and the one already set
	// is not checked again.
	f.lan.held = 30483
	save["port"] = 30483
	if rec := f.call(http.MethodPut, "/desktop/setup/api/lan", save); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "can't be used") {
		t.Fatalf("held port: %d %s", rec.Code, rec.Body.String())
	}
	f.lan.held = 47900
	save["port"] = 47900
	if rec := f.call(http.MethodPut, "/desktop/setup/api/lan", save); rec.Code != http.StatusNoContent {
		t.Fatalf("the port already set: %d", rec.Code)
	}
	f.lan.picked = 30484
	if p := body(t, f.call(http.MethodGet, "/desktop/setup/api/lan/ports", nil)); p["suggested"] != float64(30484) {
		t.Fatalf("ports %v", p)
	}
	if rec := f.call(http.MethodPost, "/desktop/setup/api/lan/start", nil); rec.Code != http.StatusAccepted || f.lan.starts != 1 {
		t.Fatalf("start: %d", rec.Code)
	}
	f.lan.startErr = errors.New("choose this computer's home-network address")
	if rec := f.call(http.MethodPost, "/desktop/setup/api/lan/start", nil); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "home-network address") {
		t.Fatalf("refused start: %d %s", rec.Code, rec.Body.String())
	}
	if rec := f.call(http.MethodPost, "/desktop/setup/api/lan/stop", nil); rec.Code != http.StatusOK || f.lan.stops != 1 {
		t.Fatalf("stop: %d", rec.Code)
	}
	addrs := body(t, f.call(http.MethodGet, "/desktop/setup/api/lan/addresses", nil))["addresses"].([]any)
	if len(addrs) != 1 || addrs[0].(map[string]any)["ip"] != "192.168.1.20" {
		t.Fatalf("addresses %v", addrs)
	}
}

func TestAdminNameSignUp(t *testing.T) {
	f := newFixture(t)
	pw := body(t, f.call(http.MethodPost, "/desktop/setup/api/lan/name/password", nil))["password"].(string)
	if len(pw) != 23 {
		t.Fatalf("password %q", pw)
	}
	rec := f.call(http.MethodPost, "/desktop/setup/api/lan/name", map[string]any{"email": "name@example.com", "name": "taken", "password": pw, "accepted": true})
	if rec.Code != http.StatusBadRequest || body(t, rec)["code"] != "refused-name" {
		t.Fatalf("taken name: %d %s", rec.Code, rec.Body.String())
	}
	rec = f.call(http.MethodPost, "/desktop/setup/api/lan/name", map[string]any{"email": "nope", "name": "rossi", "password": pw, "accepted": true})
	if rec.Code != http.StatusBadRequest || body(t, rec)["code"] != "refused-email" {
		t.Fatalf("bad email: %d %s", rec.Code, rec.Body.String())
	}
	rec = f.call(http.MethodPost, "/desktop/setup/api/lan/name", map[string]any{"email": "name@example.com", "name": "rossi", "password": pw, "accepted": true})
	if rec.Code != http.StatusOK || body(t, rec)["state"] != "waiting" {
		t.Fatalf("register: %d %s", rec.Code, rec.Body.String())
	}
	if st := body(t, f.call(http.MethodGet, "/desktop/setup/api/lan/name", nil)); st["state"] != "waiting" || f.id.restarts != 0 {
		t.Fatalf("before the link: %v", st)
	}
	f.desec.Activate("name@example.com")
	st := body(t, f.call(http.MethodGet, "/desktop/setup/api/lan/name", nil))
	if st["state"] != "linked" || st["domain"] != "rossi.dedyn.io" || f.id.restarts != 1 || f.lan.picks != 1 {
		t.Fatalf("after the link: %v, %d restarts, %d port picks", st, f.id.restarts, f.lan.picks)
	}
	if d := f.a.Config.Get().LAN.DeSEC; d.PendingPassword != "" || d.Token == "" {
		t.Fatalf("the password must be forgotten: %+v", d)
	}
	if all, narrowed := f.desec.Tokens(); all != 1 || narrowed != 1 {
		t.Fatalf("tokens %d, narrowed %d", all, narrowed)
	}
	st = body(t, f.call(http.MethodDelete, "/desktop/setup/api/lan/name", nil))
	if st["state"] != "none" || f.lan.stops != 1 || f.id.restarts != 2 || f.a.Config.Get().LAN.DeSEC.Token != "" {
		t.Fatalf("unlink: %v, %d stops, %d restarts", st, f.lan.stops, f.id.restarts)
	}
}

func TestAdminLinksAnExistingAccount(t *testing.T) {
	f := newFixture(t)
	token := f.desec.AddAccount("name@example.com", "rossi.dedyn.io")
	rec := f.call(http.MethodPut, "/desktop/setup/api/lan/name", map[string]string{"name": "other.dedyn.io", "token": token})
	if rec.Code != http.StatusBadRequest || body(t, rec)["code"] != "refused-name" {
		t.Fatalf("wrong name: %d %s", rec.Code, rec.Body.String())
	}
	rec = f.call(http.MethodPut, "/desktop/setup/api/lan/name", map[string]string{"name": "rossi.dedyn.io", "token": "wrong"})
	if rec.Code != http.StatusBadRequest || body(t, rec)["code"] != "refused-token" {
		t.Fatalf("wrong token: %d %s", rec.Code, rec.Body.String())
	}
	rec = f.call(http.MethodPut, "/desktop/setup/api/lan/name", map[string]string{"name": "rossi.dedyn.io", "token": token})
	if rec.Code != http.StatusOK || body(t, rec)["state"] != "linked" || f.id.restarts != 1 {
		t.Fatalf("link: %d %s", rec.Code, rec.Body.String())
	}
}

func TestAdminQRIsPNGOfRunningAddress(t *testing.T) {
	f := newFixture(t)
	if rec := f.call(http.MethodGet, "/desktop/setup/api/lan/qr.png", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("qr while off: %d", rec.Code)
	}
	f.lan.status = application.Status{State: application.StateRunning, URL: "https://studio.example.com:47843/app"}
	rec := f.call(http.MethodGet, "/desktop/setup/api/lan/qr.png", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("qr: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	img, err := png.Decode(bytes.NewReader(rec.Body.Bytes()))
	if err != nil || img.Bounds().Dx() < 100 {
		t.Fatalf("png: %v", err)
	}
}

func TestAdminStartAtLogin(t *testing.T) {
	f := newFixture(t)
	if rec := f.call(http.MethodPut, "/desktop/setup/api/start-at-login", map[string]bool{"enabled": true}); rec.Code != http.StatusNoContent {
		t.Fatalf("enable: %d", rec.Code)
	}
	if !f.auto.on || f.auto.exe != "/opt/phospheare/once-dark-studio-desktop" || !f.a.Config.Get().StartAtLogin {
		t.Fatalf("autostart %+v", f.auto)
	}
	if body(t, f.call(http.MethodGet, "/desktop/setup/api/state", nil))["startAtLogin"] != true {
		t.Fatal("state does not report start at login")
	}
	f.call(http.MethodPut, "/desktop/setup/api/start-at-login", map[string]bool{"enabled": false})
	if f.auto.on || f.a.Config.Get().StartAtLogin {
		t.Fatal("disable")
	}
}

func TestAdminSignOutReplacesKeys(t *testing.T) {
	f := newFixture(t)
	if rec := f.call(http.MethodPost, "/desktop/setup/api/sign-out-browsers", nil); rec.Code != http.StatusNoContent || f.id.signOuts != 1 {
		t.Fatalf("sign out: %d, %d sign-outs", rec.Code, f.id.signOuts)
	}
}

func TestAdminWipesGoogle(t *testing.T) {
	f := newFixture(t)
	f.auto.on = true
	if rec := f.call(http.MethodPost, "/desktop/setup/api/wipe/google", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("wipe: %d %s", rec.Code, rec.Body.String())
	}
	if g := f.a.Config.Get().Google; g.Configured() || f.id.signOuts != 1 || !f.auto.on || f.lan.stops != 0 {
		t.Fatalf("google %+v, %d sign-outs, autostart %v, %d stops", g, f.id.signOuts, f.auto.on, f.lan.stops)
	}
}

func TestAdminWipesEverything(t *testing.T) {
	f := newFixture(t)
	f.auto.on = true
	_ = f.a.Config.Update(func(c *domain.Config) {
		c.StartAtLogin = true
		c.LAN.DeSEC = domain.DeSEC{Name: "rossi-studio", Token: "token"}
	})
	if rec := f.call(http.MethodPost, "/desktop/setup/api/wipe/everything", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("wipe: %d %s", rec.Code, rec.Body.String())
	}
	cfg := f.a.Config.Get()
	if cfg.Google.Configured() || cfg.LAN.DeSEC.Name != "" || cfg.StartAtLogin || f.auto.on || f.lan.stops != 1 || f.id.forgets != 1 {
		t.Fatalf("config %+v, autostart %v, %d stops, %d key forgets", cfg, f.auto.on, f.lan.stops, f.id.forgets)
	}
}

func TestAdminChecksUpdatesOnRequest(t *testing.T) {
	f := newFixture(t)
	out := body(t, f.call(http.MethodPost, "/desktop/setup/api/updates/check", nil))
	if out["latest"] != "v1.4.0" || out["newer"] != true || out["known"] != true || !strings.Contains(out["url"].(string), "/releases/tag/v1.4.0") {
		t.Fatalf("updates %v", out)
	}
}

func TestAdminQuit(t *testing.T) {
	f := newFixture(t)
	if rec := f.call(http.MethodPost, "/desktop/setup/api/quit", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("quit: %d", rec.Code)
	}
	<-f.quit
}

func TestStaticFilesCarryLicenseHeader(t *testing.T) {
	for _, name := range []string{"static/index.html", "static/admin.css", "static/admin.js"} {
		raw, err := static.ReadFile(name)
		if err != nil || !strings.Contains(string(raw[:400]), "SPDX-License-Identifier: AGPL-3.0-or-later") {
			t.Fatalf("%s: %v", name, err)
		}
		if bytes.Contains(raw, []byte("http://")) && name != "static/index.html" {
			t.Fatalf("%s loads something from outside the host", name)
		}
	}
}

func TestAdminAPIRefusesAnotherOrigin(t *testing.T) {
	f := newFixture(t)
	rec := f.call(http.MethodPost, "/desktop/setup/api/quit", nil, "Sec-Fetch-Site", "", "Origin", "http://evil.example.test")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("another origin: %d", rec.Code)
	}
	select {
	case <-f.quit:
		t.Fatal("a refused request quit the program")
	default:
	}
}

func TestDesktopInfoNamesTheProgram(t *testing.T) {
	f := newFixture(t)
	out := body(t, f.call(http.MethodGet, "/desktop/info", nil, "X-Phospheare-Admin", ""))
	if out["program"] != "once-dark-studio-desktop" || out["version"] != f.a.Version {
		t.Fatalf("info %v", out)
	}
	if rec := f.call(http.MethodGet, "/desktop/nothing", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown desktop path: %d", rec.Code)
	}
}

// testKey is the fixture's launch key.
const testKey = "launch-key-for-the-tests"

// Every API call needs the launch's key; the page, its files and the copy
// check do not.
func TestAdminAPIRequiresTheLaunchKey(t *testing.T) {
	f := newFixture(t)
	for _, key := range []string{"", "wrong", testKey + "x"} {
		rec := f.call(http.MethodPost, "/desktop/setup/api/quit", nil, KeyHeader, key)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("key %q: %d", key, rec.Code)
		}
		p := body(t, rec)
		if p["code"] != "setup-key-refused" || p["title"] != "This page can't change settings. Open Setup from the Phospheare icon's menu in the tray." {
			t.Fatalf("key %q: %v", key, p)
		}
	}
	select {
	case <-f.quit:
		t.Fatal("a call without the key quit the host")
	default:
	}
	for _, p := range []string{"/desktop/setup/", "/desktop/setup/admin.js", "/desktop/setup/admin.css", "/desktop/info"} {
		if rec := f.call(http.MethodGet, p, nil, KeyHeader, ""); rec.Code != http.StatusOK {
			t.Fatalf("%s without the key: %d", p, rec.Code)
		}
	}
	f.a.Key = ""
	if rec := f.call(http.MethodGet, "/desktop/setup/api/state", nil, KeyHeader, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("an admin with no key answered: %d", rec.Code)
	}
}

func TestNewKeysAreLongAndDiffer(t *testing.T) {
	a, err := NewKey()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := NewKey()
	if len(a) < 22 || a == b || strings.ContainsAny(a, "+/=&#") {
		t.Fatalf("keys %q %q", a, b)
	}
	if got := SetupURL("http://localhost:47821", a, "phones"); got != "http://localhost:47821/desktop/setup/#k="+a+"&phones" {
		t.Fatalf("setup URL %q", got)
	}
}

func TestAdminStartAtLoginRepeatsTheArguments(t *testing.T) {
	f := newFixture(t)
	f.a.LoginArgs = []string{"--port", "47900"}
	if rec := f.call(http.MethodPut, "/desktop/setup/api/start-at-login", map[string]bool{"enabled": true}); rec.Code != http.StatusNoContent {
		t.Fatalf("enable: %d", rec.Code)
	}
	if strings.Join(f.auto.args, " ") != "--port 47900" {
		t.Fatalf("arguments %q", f.auto.args)
	}
}

// Under --dev the app runs on the dev server's origin, so the setup page
// lists that redirect address for this computer.
func TestAdminListsTheAppOriginsRedirect(t *testing.T) {
	f := newFixture(t)
	f.a.AppOrigin = "http://localhost:5173"
	s := body(t, f.call(http.MethodGet, "/desktop/setup/api/state", nil))
	uris := s["google"].(map[string]any)["redirectUris"].([]any)
	if uris[0].(map[string]any)["uri"] != "http://localhost:5173/identity/google/callback" || s["local"] != "http://localhost:5173/app" {
		t.Fatalf("state %v", s)
	}
}

// A second launch asks the running copy to open the browser without the
// key, but only as the program does: with its header, from no other site.
func TestASecondLaunchOpensTheBrowserWithoutTheKey(t *testing.T) {
	f := newFixture(t)
	opened := make(chan struct{}, 4)
	f.a.OpenAgain = func() { opened <- struct{}{} }
	if rec := f.call(http.MethodPost, OpenAgainPath, nil, KeyHeader, ""); rec.Code != http.StatusAccepted {
		t.Fatalf("without the key: %d", rec.Code)
	}
	select {
	case <-opened:
	case <-time.After(5 * time.Second):
		t.Fatal("the browser was not opened")
	}
	for _, h := range [][]string{
		{AdminHeader, ""},
		{"Sec-Fetch-Site", "cross-site"},
		{"Origin", "http://evil.example.test"},
	} {
		if rec := f.call(http.MethodPost, OpenAgainPath, nil, h...); rec.Code != http.StatusForbidden {
			t.Fatalf("%v: %d", h, rec.Code)
		}
	}
	if rec := f.call(http.MethodGet, OpenAgainPath, nil); rec.Code == http.StatusAccepted {
		t.Fatal("a GET opened the browser")
	}
	select {
	case <-opened:
		t.Fatal("a refused call opened the browser")
	default:
	}
}

// The page reads the agreement in force, accepts it, and a second page that
// accepts it again gets the same answer.
func TestTheAgreementIsReadAndAccepted(t *testing.T) {
	f := newFixture(t)
	const terms = "https://example.test/terms"
	f.lan.terms = terms
	st := body(t, f.call(http.MethodGet, "/desktop/setup/api/lan/terms", nil))
	if st["url"] != terms || st["accepted"] != false {
		t.Fatalf("before: %v", st)
	}
	if rec := f.call(http.MethodPost, "/desktop/setup/api/lan/terms", map[string]string{"url": "https://example.test/old"}); rec.Code != http.StatusConflict || body(t, rec)["code"] != "terms-changed" {
		t.Fatalf("another address: %d %s", rec.Code, rec.Body.String())
	}
	if rec := f.call(http.MethodPost, "/desktop/setup/api/lan/terms", map[string]string{}); rec.Code != http.StatusConflict {
		t.Fatalf("no address: %d", rec.Code)
	}
	for i := range 2 {
		rec := f.call(http.MethodPost, "/desktop/setup/api/lan/terms", map[string]string{"url": terms})
		if rec.Code != http.StatusAccepted || body(t, rec)["state"] != "starting" {
			t.Fatalf("acceptance %d: %d %s", i+1, rec.Code, rec.Body.String())
		}
	}
	if st := body(t, f.call(http.MethodGet, "/desktop/setup/api/lan/terms", nil)); st["accepted"] != true {
		t.Fatalf("after: %v", st)
	}
	if rec := f.call(http.MethodPost, "/desktop/setup/api/lan/terms", map[string]string{"url": terms}, KeyHeader, ""); rec.Code != http.StatusForbidden {
		t.Fatalf("an acceptance without the key: %d", rec.Code)
	}
}

// An agreement that cannot be read is said in the page's language.
func TestAnAgreementThatCannotBeReadIsSaidInThePagesLanguage(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPut, "/desktop/setup/api/language", map[string]string{"language": "it"})
	f.lan.termsErr = application.ErrTermsUnreachable
	rec := f.call(http.MethodGet, "/desktop/setup/api/lan/terms", nil)
	if got := body(t, rec); rec.Code != http.StatusBadGateway || got["code"] != "terms-unreachable" || !strings.HasPrefix(got["title"].(string), "Let's Encrypt non risponde") {
		t.Fatalf("%d %v", rec.Code, got)
	}
}

// The state says whether an agreement was accepted, and asks no one.
func TestTheStateSaysWhetherAnAgreementWasAccepted(t *testing.T) {
	f := newFixture(t)
	lan := func() map[string]any {
		return body(t, f.call(http.MethodGet, "/desktop/setup/api/state", nil))["lan"].(map[string]any)["config"].(map[string]any)
	}
	if lan()["termsAccepted"] != false {
		t.Fatal("accepted before any acceptance")
	}
	_ = f.a.Config.Update(func(c *domain.Config) { c.LAN.CertTerms = "https://example.test/terms" })
	if lan()["termsAccepted"] != true {
		t.Fatal("not accepted after the acceptance")
	}
}

// A name is not asked of deSEC without the person's agreement.
func TestANameNeedsThePersonsAgreement(t *testing.T) {
	f := newFixture(t)
	pw := body(t, f.call(http.MethodPost, "/desktop/setup/api/lan/name/password", nil))["password"].(string)
	rec := f.call(http.MethodPost, "/desktop/setup/api/lan/name", map[string]string{"email": "name@example.com", "name": "rossi", "password": pw})
	if rec.Code != http.StatusBadRequest || body(t, rec)["code"] != "refused-accepted" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if st := body(t, f.call(http.MethodGet, "/desktop/setup/api/lan/name", nil)); st["state"] != "none" {
		t.Fatalf("state %v", st)
	}
}

// An acceptance the settings could not keep is a save failure, in the
// page's language.
func TestAnAcceptanceThatCannotBeSavedIsASaveFailure(t *testing.T) {
	f := newFixture(t)
	f.lan.terms = "https://example.test/terms"
	f.lan.termsErr = &application.SaveError{Err: errors.New("disk full")}
	rec := f.call(http.MethodPost, "/desktop/setup/api/lan/terms", map[string]string{"url": f.lan.terms})
	if got := body(t, rec); rec.Code != http.StatusInternalServerError || got["code"] != "save-failed" || !strings.Contains(got["title"].(string), "disk full") {
		t.Fatalf("%d %v", rec.Code, got)
	}
}

// The program's own refusals about the two agreements are said in the
// page's language.
func TestRefusalsAboutTheAgreementsAreSaidInThePagesLanguage(t *testing.T) {
	f := newFixture(t)
	f.call(http.MethodPut, "/desktop/setup/api/language", map[string]string{"language": "it"})
	pw := body(t, f.call(http.MethodPost, "/desktop/setup/api/lan/name/password", nil))["password"].(string)
	rec := f.call(http.MethodPost, "/desktop/setup/api/lan/name", map[string]string{"email": "name@example.com", "name": "rossi", "password": pw})
	if got := body(t, rec)["title"].(string); !strings.HasPrefix(got, "Conferma che i limiti") {
		t.Fatalf("a name without the acceptance: %q", got)
	}
	f.lan.startErr = domain.ErrNoCertTerms
	rec = f.call(http.MethodPost, "/desktop/setup/api/lan/start", nil)
	if got := body(t, rec)["title"].(string); rec.Code != http.StatusBadRequest || !strings.HasPrefix(got, "Prima accetta") {
		t.Fatalf("a start without an agreement: %d %q", rec.Code, got)
	}
	f.lan.status = application.Status{State: application.StateError, Message: "Let's Encrypt gives a certificate only once its agreement is accepted.", Terms: "https://example.test/terms"}
	st := body(t, f.call(http.MethodGet, "/desktop/setup/api/state", nil))["lan"].(map[string]any)["status"].(map[string]any)
	if got := st["message"].(string); !strings.HasPrefix(got, "Let's Encrypt rilascia") {
		t.Fatalf("a start refused for the agreement: %q", got)
	}
}
