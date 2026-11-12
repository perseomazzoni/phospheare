// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package admin serves the desktop program's own `/desktop/` paths: the
// setup page at `/desktop/setup/` with its JSON API, `/desktop/info`,
// which tells a second launch that this copy holds the port, and
// `/desktop/open-again`, where that launch asks this copy to open the
// browser, so a copy started at login with no tray still leads to its
// setup page.
//
// Only the loopback listener mounts it, and it answers only for
// `Host: localhost:<port>`, so a page on another origin that resolves its
// name to 127.0.0.1 (DNS rebinding) cannot reach it. Every API call needs
// `X-Phospheare-Admin: 1`, which a cross-origin page cannot send without a
// CORS preflight that is never granted, and `Sec-Fetch-Site` and `Origin`,
// when the browser sends them, must name this page. The API never answers
// the client secret, the deSEC token or a saved deSEC password; it answers
// a deSEC password once, when it is made, so the person can save it.
//
// Any program on the computer can reach the loopback port, so every API
// call also carries the launch's key in `X-Phospheare-Setup-Key`. The key
// is made at start and never written to disk; the program hands it only to
// the browser it opens on the setup page, in the address's fragment, which
// no request, log or Referer carries. The page, its files and
// `/desktop/info` answer without it.
package admin

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html"
	"html/template"
	"io"
	"io/fs"
	"net/http"
	"os"
	"runtime"
	"slices"
	"strings"
	"time"

	"rsc.io/qr"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/problem"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/words"
	"github.com/perseomazzoni/phospheare/desktop/internal/application"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

//go:embed static
var static embed.FS

var page = template.Must(template.ParseFS(static, "static/index.html"))

// LatestReleaseURL is the GitHub API answer for the newest release.
const LatestReleaseURL = "https://api.github.com/repos/perseomazzoni/phospheare/releases/latest"

const pageCSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; " +
	"connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// LAN is the home-network listener as the page controls it.
type LAN interface {
	TurnOn() error
	TurnOff() error
	Status() application.Status
	Ports() application.PortChoice
	PickPort()
	CheckPort(port int) error
	// Terms asks the certificate authority which agreement is in force.
	Terms(ctx context.Context) (application.TermsState, error)
	// AcceptTerms records the person's acceptance of the agreement at
	// address and turns the listener on, or has it ask again.
	AcceptTerms(ctx context.Context, address string) error
}

// Admin is the setup page's handler.
type Admin struct {
	Version     string
	ProductName string
	DataDir     string
	// Host is the only accepted `Host` header, `localhost:<port>`, or
	// `localhost` on port 80.
	Host string
	// LoopbackOrigin is the setup page's origin, `http://localhost:<port>`.
	LoopbackOrigin string
	// AppOrigin is the origin the app and the identity service answer on
	// this computer: LoopbackOrigin, or the dev server's under `--dev`.
	// Empty means LoopbackOrigin.
	AppOrigin string
	// Key is this launch's key, from NewKey, which every API call must
	// carry. Empty refuses every call.
	Key string
	// Tray says whether the tray menu opens the setup page; a call that
	// arrives without the key is told to open it from there, or else from
	// the address the terminal shows.
	Tray bool
	// SystemLanguage is the system's locale, which the page follows until
	// a language is chosen.
	SystemLanguage string
	Config         ports.ConfigStore
	// Identity is the identity service the desktop runs, restarted when a
	// setting it reads changes.
	Identity ports.IdentityService
	LAN      LAN
	// Name gives the home network its free name at deSEC.
	Name      *application.HomeName
	Addresses func() ([]domain.Address, error)
	Autostart ports.Autostart
	// Wipe forgets the settings, so the setup can start over.
	Wipe *application.Wipe
	// Executable answers the path registered to start at login.
	Executable func() (string, error)
	// LoginArgs are the arguments registered with it.
	LoginArgs  []string
	HTTP       *http.Client
	ReleaseURL string
	// Quit asks the process to stop.
	Quit func()
	// OpenAgain opens the browser for a second launch: at the app where
	// the tray leads to the setup page, and at the setup page, with the
	// key, where nothing else does.
	OpenAgain func()

	mux *http.ServeMux
}

// Handler answers the page and its API.
func (a *Admin) Handler() http.Handler {
	mux := http.NewServeMux()
	files, _ := fs.Sub(static, "static")
	mux.HandleFunc("GET /desktop/info", a.info)
	mux.HandleFunc("POST "+OpenAgainPath, a.openAgain)
	mux.HandleFunc("GET /desktop/setup/{$}", a.page)
	mux.HandleFunc("GET /desktop/setup/admin.css", func(w http.ResponseWriter, r *http.Request) { a.file(w, r, files, "admin.css") })
	mux.HandleFunc("GET /desktop/setup/admin.js", func(w http.ResponseWriter, r *http.Request) { a.file(w, r, files, "admin.js") })
	mux.HandleFunc("GET /desktop/setup/api/state", a.state)
	mux.HandleFunc("PUT /desktop/setup/api/google", a.putGoogle)
	mux.HandleFunc("POST /desktop/setup/api/google/check", a.checkGoogle)
	mux.HandleFunc("GET /desktop/setup/api/lan/addresses", a.addresses)
	mux.HandleFunc("GET /desktop/setup/api/lan/ports", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, a.LAN.Ports()) })
	mux.HandleFunc("PUT /desktop/setup/api/lan", a.putLAN)
	mux.HandleFunc("POST /desktop/setup/api/lan/name/password", a.namePassword)
	mux.HandleFunc("POST /desktop/setup/api/lan/name", a.registerName)
	mux.HandleFunc("GET /desktop/setup/api/lan/name", a.checkName)
	mux.HandleFunc("PUT /desktop/setup/api/lan/name", a.linkName)
	mux.HandleFunc("DELETE /desktop/setup/api/lan/name", a.unlinkName)
	mux.HandleFunc("GET /desktop/setup/api/lan/terms", a.terms)
	mux.HandleFunc("POST /desktop/setup/api/lan/terms", a.acceptTerms)
	mux.HandleFunc("POST /desktop/setup/api/lan/start", a.startLAN)
	mux.HandleFunc("POST /desktop/setup/api/lan/stop", a.stopLAN)
	mux.HandleFunc("GET /desktop/setup/api/lan/qr.png", a.qr)
	mux.HandleFunc("PUT /desktop/setup/api/start-at-login", a.putStartAtLogin)
	mux.HandleFunc("PUT /desktop/setup/api/language", a.putLanguage)
	mux.HandleFunc("POST /desktop/setup/api/sign-out-browsers", a.signOutBrowsers)
	mux.HandleFunc("POST /desktop/setup/api/wipe/google", func(w http.ResponseWriter, r *http.Request) { a.wipe(w, a.Wipe.Google) })
	mux.HandleFunc("POST /desktop/setup/api/wipe/everything", func(w http.ResponseWriter, r *http.Request) { a.wipe(w, a.Wipe.Everything) })
	mux.HandleFunc("POST /desktop/setup/api/updates/check", a.checkUpdates)
	mux.HandleFunc("POST /desktop/setup/api/quit", a.quit)
	mux.HandleFunc("/desktop/", func(w http.ResponseWriter, r *http.Request) {
		problem.Write(w, http.StatusNotFound, "not-found", "No such page")
	})
	a.mux = mux
	return http.HandlerFunc(a.serve)
}

func (a *Admin) serve(w http.ResponseWriter, r *http.Request) {
	if !strings.EqualFold(r.Host, a.Host) {
		problem.Write(w, http.StatusMisdirectedRequest, "wrong-host", "The setup page answers only at http://"+a.Host+"/desktop/setup/")
		return
	}
	api := strings.HasPrefix(r.URL.Path, "/desktop/setup/api/")
	if api || r.URL.Path == OpenAgainPath {
		if r.Header.Get(AdminHeader) != "1" {
			problem.Write(w, http.StatusForbidden, "csrf-refused", "The X-Phospheare-Admin header is missing")
			return
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" {
			problem.Write(w, http.StatusForbidden, "csrf-refused", "Cross-site request refused")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != a.LoopbackOrigin {
			problem.Write(w, http.StatusForbidden, "csrf-refused", "Cross-origin request refused")
			return
		}
	}
	if api {
		key := r.Header.Get(KeyHeader)
		if a.Key == "" || subtle.ConstantTimeCompare([]byte(key), []byte(a.Key)) != 1 {
			way := "api.keyRefusedTerminal"
			if a.Tray {
				way = "api.keyRefusedTray"
			}
			problem.Write(w, http.StatusForbidden, "setup-key-refused", a.say(way))
			return
		}
	}
	w.Header().Set("Content-Security-Policy", pageCSP)
	a.mux.ServeHTTP(w, r)
}

func (a *Admin) appOrigin() string {
	if a.AppOrigin != "" {
		return a.AppOrigin
	}
	return a.LoopbackOrigin
}

// KeyHeader carries the launch's key on every API call.
const KeyHeader = "X-Phospheare-Setup-Key"

// AdminHeader marks a call as the program's own.
const AdminHeader = "X-Phospheare-Admin"

// OpenAgainPath is where a second launch asks this copy to open the
// browser. It needs no key: it hands nothing back, and the browser it opens
// is the one the tray's Setup would open.
const OpenAgainPath = "/desktop/open-again"

// openAgain opens the browser where OpenAgain says, after answering.
func (a *Admin) openAgain(w http.ResponseWriter, r *http.Request) {
	if a.OpenAgain == nil {
		problem.Write(w, http.StatusNotFound, "not-found", "No such page")
		return
	}
	w.WriteHeader(http.StatusAccepted)
	go a.OpenAgain()
}

// NewKey answers a launch's key: 256 random bits, URL-safe.
func NewKey() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// SetupURL answers the setup page's address on origin, with key in the
// fragment and then the place on the page, "" for its top.
func SetupURL(origin, key, place string) string {
	u := origin + "/desktop/setup/#k=" + key
	if place != "" {
		u += "&" + place
	}
	return u
}

// Program names the desktop program in `/desktop/info`.
const Program = "once-dark-studio-desktop"

func (a *Admin) info(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"program": Program, "version": a.Version})
}

func (a *Admin) words() words.Words {
	return words.For(domain.Language(a.Config.Get().Language, a.SystemLanguage), a.ProductName)
}

func (a *Admin) say(key string, pairs ...string) string {
	return a.words().T(key, pairs...)
}

// pageData is what `static/index.html` is rendered with.
type pageData struct {
	w                words.Words
	product, version string
	Lang             string
	// Script holds the texts the page's script shows, as `admin.js` names
	// them, with `{product}` and the other values left for it to fill.
	Script    map[string]string
	Languages []languageOption
	// SecretsKey names the text that says where the secrets are kept.
	SecretsKey string
}

// languageOption is one choice of the page's language list; Value "" is
// the system's language.
type languageOption struct {
	Value, Label string
	Chosen       bool
}

// T answers key's text as markup, with the product's name and the version
// escaped into it.
func (p pageData) T(key string) template.HTML {
	return template.HTML(p.w.T(key, "product", html.EscapeString(p.product), "version", html.EscapeString(p.version)))
}

// Plain answers key's text for an attribute, which the template escapes.
func (p pageData) Plain(key string) string {
	return p.w.T(key, "version", p.version)
}

func secretsKey(place domain.SecretPlace) string {
	if place == domain.SecretsInSystem {
		return "page.secrets." + runtime.GOOS
	}
	return "page.secrets.file"
}

func (a *Admin) page(w http.ResponseWriter, r *http.Request) {
	chosen := a.Config.Get().Language
	wd := a.words()
	system := domain.Language("", a.SystemLanguage)
	options := []languageOption{{
		Label:  wd.T("language.system", "name", words.For(system, a.ProductName).T("language.name")),
		Chosen: !domain.KnownLanguage(chosen),
	}}
	for _, lang := range domain.Languages {
		options = append(options, languageOption{
			Value:  lang,
			Label:  words.For(lang, a.ProductName).T("language.name"),
			Chosen: lang == chosen,
		})
	}
	var out bytes.Buffer
	err := page.Execute(&out, pageData{
		w: wd, product: a.ProductName, version: a.Version,
		Lang: wd.Lang(), Script: wd.Raw("script."), Languages: options,
		SecretsKey: secretsKey(a.Config.Get().Secrets),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(out.Bytes())
}

func (a *Admin) file(w http.ResponseWriter, r *http.Request, files fs.FS, name string) {
	raw, err := fs.ReadFile(files, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(raw))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func readJSON(r *http.Request, v any) bool {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	return err == nil && json.Unmarshal(raw, v) == nil
}

func badRequest(w http.ResponseWriter, message string) {
	problem.Write(w, http.StatusBadRequest, "invalid", message)
}

// ── State ────────────────────────────────────────────────────────────────────

// redirectURI is one address Google returns the browser to, with whose
// browser uses it: "computer" for this computer, "home" for the phones and
// tablets at home.
type redirectURI struct {
	For string `json:"for"`
	URI string `json:"uri"`
}

func (a *Admin) redirectURIs(cfg domain.Config) []redirectURI {
	var out []redirectURI
	for i, origin := range domain.Origins(cfg, a.appOrigin()) {
		who := "computer"
		if i > 0 {
			who = "home"
		}
		out = append(out, redirectURI{For: who, URI: origin + domain.CallbackPath})
	}
	return out
}

// restartIdentity starts the identity service again with the settings just
// saved, answering whether it is running.
func (a *Admin) restartIdentity(w http.ResponseWriter) bool {
	if err := a.Identity.Restart(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "identity-failed", a.say("api.identityFailed", "error", err.Error()))
		return false
	}
	return true
}

// clientIDEnd answers the last four characters of the client ID before the
// suffix every Google client ID shares, enough to tell two clients apart.
func clientIDEnd(id string) string {
	id = strings.TrimSuffix(id, ".apps.googleusercontent.com")
	if len(id) <= 4 {
		return id
	}
	return id[len(id)-4:]
}

func (a *Admin) state(w http.ResponseWriter, r *http.Request) {
	cfg := a.Config.Get()
	startAtLogin, err := a.Autostart.Enabled()
	startAtLoginError := ""
	if err != nil {
		startAtLoginError = err.Error()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"product": a.ProductName,
		"version": a.Version,
		"dataDir": a.DataDir,
		"local":   a.appOrigin() + "/app",
		"google": map[string]any{
			"clientIdSet":  cfg.Google.ClientID != "",
			"clientIdEnd":  clientIDEnd(cfg.Google.ClientID),
			"secretSet":    cfg.Google.ClientSecret != "",
			"redirectUris": a.redirectURIs(cfg),
		},
		"lan": map[string]any{
			"config": map[string]any{
				"port":      cfg.LAN.Port,
				"address":   cfg.LAN.Address,
				"autoStart": cfg.LAN.AutoStart,
				// Whether an agreement was ever accepted; lan/terms
				// answers whether it is the one in force.
				"termsAccepted": cfg.LAN.CertTerms != "",
			},
			"name":   a.Name.State(),
			"status": a.lanStatus(),
		},
		"startAtLogin":      startAtLogin,
		"startAtLoginError": startAtLoginError,
	})
}

// ── Google ───────────────────────────────────────────────────────────────────

// putGoogle stores the client. An empty secret keeps the stored one, so the
// page can change the id without asking for the secret again.
func (a *Admin) putGoogle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ClientID     string `json:"clientId"`
		ClientSecret string `json:"clientSecret"`
	}
	if !readJSON(r, &body) {
		badRequest(w, a.say("api.malformed"))
		return
	}
	id := strings.TrimSpace(body.ClientID)
	secret := strings.TrimSpace(body.ClientSecret)
	if id == "" || !strings.HasSuffix(id, ".apps.googleusercontent.com") {
		badRequest(w, a.say("api.clientId"))
		return
	}
	if secret == "" && a.Config.Get().Google.ClientSecret == "" {
		badRequest(w, a.say("api.secret"))
		return
	}
	err := a.Config.Update(func(c *domain.Config) {
		c.Google.ClientID = id
		if secret != "" {
			c.Google.ClientSecret = secret
		}
	})
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "save-failed", a.say("api.saveFailed", "error", err.Error()))
		return
	}
	if a.restartIdentity(w) {
		w.WriteHeader(http.StatusNoContent)
	}
}

func (a *Admin) checkGoogle(w http.ResponseWriter, r *http.Request) {
	cfg := a.Config.Get()
	if !cfg.Google.Configured() {
		badRequest(w, a.say("api.saveClientFirst"))
		return
	}
	out, err := a.Identity.CheckGoogle(r.Context())
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "check-failed", a.say("api.checkFailed", "error", err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": out})
}

// ── Home network ─────────────────────────────────────────────────────────────

func (a *Admin) addresses(w http.ResponseWriter, r *http.Request) {
	list, err := a.Addresses()
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "addresses-failed", a.say("api.addressesFailed", "error", err.Error()))
		return
	}
	if list == nil {
		list = []domain.Address{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"addresses": list})
}

// putLAN stores the home-network settings; a running listener keeps the
// settings it started with until it is stopped and started again.
func (a *Admin) putLAN(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Port    int    `json:"port"`
		Address string `json:"address"`
	}
	if !readJSON(r, &body) {
		badRequest(w, a.say("api.malformed"))
		return
	}
	if body.Port < 1 || body.Port > 65535 {
		badRequest(w, a.say("api.portRange"))
		return
	}
	if body.Port != a.Config.Get().LAN.Port {
		if err := a.LAN.CheckPort(body.Port); err != nil {
			badRequest(w, err.Error())
			return
		}
	}
	before := domain.Origins(a.Config.Get(), a.appOrigin())
	err := a.Config.Update(func(c *domain.Config) {
		c.LAN.Port = body.Port
		c.LAN.Address = strings.TrimSpace(body.Address)
	})
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "save-failed", a.say("api.saveFailed", "error", err.Error()))
		return
	}
	if a.restartIfMoved(w, before) {
		w.WriteHeader(http.StatusNoContent)
	}
}

// restartIfMoved restarts the identity service when the origins it answers
// differ from before, answering whether the caller may reply success.
func (a *Admin) restartIfMoved(w http.ResponseWriter, before []string) bool {
	return slices.Equal(before, domain.Origins(a.Config.Get(), a.appOrigin())) || a.restartIdentity(w)
}

// nameFailed answers a refusal with the field it concerns, as code
// `refused-email`, `refused-name`, `refused-token` or `refused-accepted`,
// and any other failure as deSEC being unreachable. The refusal for a missing
// acceptance is the program's own, so it is said in the page's language.
func (a *Admin) nameFailed(w http.ResponseWriter, err error) {
	var r *ports.Refusal
	if errors.As(err, &r) {
		code, message := "refused", r.Message
		if r.Field != "" {
			code += "-" + r.Field
		}
		if r.Field == "accepted" {
			message = a.say("api.acceptLimits")
		}
		problem.Write(w, http.StatusBadRequest, code, message)
		return
	}
	problem.Write(w, http.StatusBadGateway, "desec-failed", err.Error())
}

// namePassword answers a new password for a deSEC account. Nothing keeps
// it until the page sends it back to register.
func (a *Admin) namePassword(w http.ResponseWriter, r *http.Request) {
	p, err := domain.NewPassword(rand.Reader)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "password-failed", err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"password": p})
}

func (a *Admin) registerName(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
		Accepted bool   `json:"accepted"`
	}
	if !readJSON(r, &body) {
		badRequest(w, a.say("api.malformed"))
		return
	}
	if err := a.Name.Register(r.Context(), body.Email, body.Name, body.Password, body.Accepted); err != nil {
		a.nameFailed(w, err)
		return
	}
	writeJSON(w, http.StatusOK, a.Name.State())
}

// checkName asks deSEC once whether the activation link was used; the page
// asks again while it waits. Once the name is ready the identity service
// restarts with the home network's origin.
func (a *Admin) checkName(w http.ResponseWriter, r *http.Request) {
	st, linked, err := a.Name.Check(r.Context())
	if err != nil {
		st.Problem = err.Error()
	}
	if linked {
		// The port is chosen before the page shows the address Google
		// must accept.
		a.LAN.PickPort()
		if !a.restartIdentity(w) {
			return
		}
	}
	writeJSON(w, http.StatusOK, st)
}

func (a *Admin) linkName(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Token string `json:"token"`
	}
	if !readJSON(r, &body) {
		badRequest(w, a.say("api.malformed"))
		return
	}
	before := domain.Origins(a.Config.Get(), a.appOrigin())
	if err := a.Name.Link(r.Context(), body.Name, body.Token); err != nil {
		a.nameFailed(w, err)
		return
	}
	a.LAN.PickPort()
	if a.restartIfMoved(w, before) {
		writeJSON(w, http.StatusOK, a.Name.State())
	}
}

func (a *Admin) unlinkName(w http.ResponseWriter, r *http.Request) {
	if err := a.LAN.TurnOff(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "stop-failed", err.Error())
		return
	}
	before := domain.Origins(a.Config.Get(), a.appOrigin())
	if err := a.Name.Unlink(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "save-failed", a.say("api.saveFailed", "error", err.Error()))
		return
	}
	if a.restartIfMoved(w, before) {
		writeJSON(w, http.StatusOK, a.Name.State())
	}
}

// termsFailed answers why the agreement could not be read or accepted, in
// the page's language where the reason is one the page knows.
func (a *Admin) termsFailed(w http.ResponseWriter, err error) {
	var unsaved *application.SaveError
	switch {
	case errors.As(err, &unsaved):
		problem.Write(w, http.StatusInternalServerError, "save-failed", a.say("api.saveFailed", "error", unsaved.Error()))
	case errors.Is(err, application.ErrTermsUnreachable):
		problem.Write(w, http.StatusBadGateway, "terms-unreachable", a.say("api.termsUnreachable"))
	case errors.Is(err, application.ErrTermsUnshown):
		problem.Write(w, http.StatusBadGateway, "terms-unshown", a.say("api.termsUnshown"))
	case errors.Is(err, application.ErrTermsChanged):
		problem.Write(w, http.StatusConflict, "terms-changed", a.say("api.termsChanged"))
	case errors.Is(err, domain.ErrNoCertTerms):
		badRequest(w, a.say("api.acceptFirst"))
	default:
		badRequest(w, err.Error())
	}
}

// lanStatus answers the listener's status for the page. A start refused for
// the authority's agreement says so in the page's language.
func (a *Admin) lanStatus() application.Status {
	st := a.LAN.Status()
	if st.State == application.StateError && st.Terms != "" {
		st.Message = a.say("api.termsNeeded")
	}
	return st
}

// terms answers the agreement the certificate authority has in force and
// whether it is accepted. It asks the authority, so the page calls it only
// when it must show the agreement, never while it polls the state.
func (a *Admin) terms(w http.ResponseWriter, r *http.Request) {
	st, err := a.LAN.Terms(r.Context())
	if err != nil {
		a.termsFailed(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, st)
}

// acceptTerms records the acceptance of the agreement at the address the
// page showed, "" where the authority names none. A second page that accepts
// the same agreement gets the same answer.
func (a *Admin) acceptTerms(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL string `json:"url"`
	}
	if !readJSON(r, &body) {
		badRequest(w, a.say("api.malformed"))
		return
	}
	if err := a.LAN.AcceptTerms(r.Context(), body.URL); err != nil {
		a.termsFailed(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, a.LAN.Status())
}

func (a *Admin) startLAN(w http.ResponseWriter, r *http.Request) {
	if err := a.LAN.TurnOn(); err != nil {
		message := err.Error()
		if errors.Is(err, domain.ErrNoCertTerms) {
			message = a.say("api.acceptFirst")
		}
		badRequest(w, message)
		return
	}
	writeJSON(w, http.StatusAccepted, a.LAN.Status())
}

func (a *Admin) stopLAN(w http.ResponseWriter, r *http.Request) {
	if err := a.LAN.TurnOff(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "stop-failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, a.LAN.Status())
}

// qr answers the running listener's address as a QR code, and nothing else.
func (a *Admin) qr(w http.ResponseWriter, r *http.Request) {
	s := a.LAN.Status()
	if s.State != application.StateRunning || s.URL == "" {
		problem.Write(w, http.StatusNotFound, "lan-off", a.say("api.lanOff"))
		return
	}
	code, err := qr.Encode(s.URL, qr.M)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "qr-failed", err.Error())
		return
	}
	code.Scale = 8
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(code.PNG())
}

// ── Login, browsers, updates, quit ───────────────────────────────────────────

func (a *Admin) putStartAtLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if !readJSON(r, &body) {
		badRequest(w, a.say("api.malformed"))
		return
	}
	var err error
	if body.Enabled {
		var exe string
		if exe, err = a.Executable(); err == nil {
			err = a.Autostart.Enable(exe, a.LoginArgs)
		}
	} else {
		err = a.Autostart.Disable()
	}
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "autostart-failed", a.say("api.autostartFailed", "error", err.Error()))
		return
	}
	if err := a.Config.Update(func(c *domain.Config) { c.StartAtLogin = body.Enabled }); err != nil {
		problem.Write(w, http.StatusInternalServerError, "save-failed", a.say("api.saveFailed", "error", err.Error()))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// putLanguage chooses the language of the setup page and the tray menu;
// "" follows the system's. The page loads again to show it.
func (a *Admin) putLanguage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Language string `json:"language"`
	}
	if !readJSON(r, &body) {
		badRequest(w, a.say("api.malformed"))
		return
	}
	if body.Language != "" && !domain.KnownLanguage(body.Language) {
		badRequest(w, a.say("api.language"))
		return
	}
	if err := a.Config.Update(func(c *domain.Config) { c.Language = body.Language }); err != nil {
		problem.Write(w, http.StatusInternalServerError, "save-failed", a.say("api.saveFailed", "error", err.Error()))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// signOutBrowsers replaces every sealing key, so every writer session and
// every Drive connection held by any browser stops opening.
func (a *Admin) signOutBrowsers(w http.ResponseWriter, r *http.Request) {
	if err := a.Identity.SignOutBrowsers(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "rotate-failed", a.say("api.rotateFailed", "error", err.Error()))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// wipe runs one of the wipes. A wipe that fails part way keeps what it
// already did, and the page shows the settings as they now are.
func (a *Admin) wipe(w http.ResponseWriter, run func() error) {
	if err := run(); err != nil {
		problem.Write(w, http.StatusInternalServerError, "wipe-failed", a.say("api.wipeFailed", "error", err.Error()))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// checkUpdates asks GitHub for the newest release, only when the user asks.
// Nothing is downloaded.
func (a *Admin) checkUpdates(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.ReleaseURL, nil)
	if err != nil {
		problem.Write(w, http.StatusInternalServerError, "updates-failed", err.Error())
		return
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := a.HTTP.Do(req)
	if err != nil {
		problem.Write(w, http.StatusBadGateway, "updates-unreachable", a.say("api.updatesUnreachable"))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		problem.Write(w, http.StatusNotFound, "no-release", a.say("api.noRelease"))
		return
	}
	if resp.StatusCode != http.StatusOK {
		problem.Write(w, http.StatusBadGateway, "updates-unreachable", a.say("api.noReleaseAnswer"))
		return
	}
	var rel struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rel); err != nil || rel.TagName == "" {
		problem.Write(w, http.StatusBadGateway, "updates-unreachable", a.say("api.updatesUnreadable"))
		return
	}
	newer, known := domain.Newer(rel.TagName, a.Version)
	writeJSON(w, http.StatusOK, map[string]any{
		"current": a.Version,
		"latest":  rel.TagName,
		"url":     rel.HTMLURL,
		"newer":   newer,
		"known":   known,
	})
}

func (a *Admin) quit(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusAccepted)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		a.Quit()
	}()
}

// Executable answers the running program's path.
func Executable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", errors.New("the program's location could not be found")
	}
	return exe, nil
}
