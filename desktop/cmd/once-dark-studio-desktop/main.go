// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Command once-dark-studio-desktop is the desktop program: it serves the
// writing app on `http://localhost:47821`, runs the identity service bundled
// beside it as a child and passes `/identity/` to it, opens the browser
// there, and on request serves the home network over HTTPS through a second
// listener. On Windows and on a Linux desktop with a tray it shows an icon
// whose menu opens the app and quits it; elsewhere, or with `--no-tray`, it
// runs in its terminal. It runs until the tray or the setup page quits it
// or, where it has a terminal, until the terminal closes. On every system
// it keeps its log in the data folder's `logs/desktop.log`. The Windows
// build has no terminal: a failure to start is shown in a message box.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/admin"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/autostart"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/browser"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/certs"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/configfile"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/console"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/front"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/identityproc"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/instance"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/locale"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/logs"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/netif"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/tray"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/vault"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/web"
	"github.com/perseomazzoni/phospheare/desktop/internal/application"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// Set by the release build with -ldflags "-X main.version=... -X
// main.productName=...", the product name from `product.json`.
var (
	version     = "dev"
	productName = "Phospheare"
)

type options struct {
	port          int
	dataDir       string
	spaDir        string
	identityBin   string
	noBrowser     bool
	noTray        bool
	dev           bool
	devOrigin     string
	acmeDirectory string
	desecAPI      string
	logLevel      slog.Level
	devWiring     devWiring
}

// devWiring is what a development build changes once its flags are read.
// The release build leaves every field empty.
type devWiring struct {
	// check refuses flags that do not go together.
	check func(options) error
	// certs changes the certificate source once it is made.
	certs func(*certs.Source)
	// autostart replaces the operating system's login list.
	autostart ports.Autostart
	// listen opens the home network's listener.
	listen func(network, addr string) (net.Listener, error)
	// setupPage wraps the setup page's handler.
	setupPage func(http.Handler) http.Handler
}

// devFlags sets up a development build before its flags are read. The
// release build does nothing.
var devFlags = func(*flag.FlagSet, *options) {}

func parseFlags(args []string) (options, error) {
	var o options
	fl := flag.NewFlagSet("once-dark-studio-desktop", flag.ContinueOnError)
	fl.IntVar(&o.port, "port", 0, "loopback port (default 47821, or the port in config.json)")
	fl.StringVar(&o.dataDir, "data-dir", "", "data folder (default: the per-user configuration folder)")
	fl.StringVar(&o.spaDir, "spa-dir", "", "serve the SPA from this folder instead of the embedded copy")
	fl.StringVar(&o.identityBin, "identity", "", "the identity service's binary (default: identity beside this program)")
	fl.BoolVar(&o.noBrowser, "no-browser", false, "do not open the browser")
	fl.BoolVar(&o.noTray, "no-tray", false, "show no tray icon; run as in a terminal")
	fl.BoolVar(&o.dev, "dev", false, "development: serve only /identity/ and /desktop/, behind the Vite dev server")
	fl.StringVar(&o.devOrigin, "dev-origin", "", "development: the browser origin that proxies /identity (e.g. http://localhost:5173)")
	fl.StringVar(&o.acmeDirectory, "acme-directory", certs.LetsEncrypt, "ACME directory URL for home-network certificates")
	fl.StringVar(&o.desecAPI, "desec-api", desec.API, "deSEC API base for the home network's name")
	fl.Func("log-level", "the lowest level the log files keep: debug, info, warn or error (default info)", func(s string) error {
		l, err := logs.ParseLevel(s)
		o.logLevel = l
		return err
	})
	devFlags(fl, &o)
	if err := fl.Parse(args); err != nil {
		return o, err
	}
	if o.dev && o.devOrigin == "" {
		return o, errors.New("--dev needs --dev-origin, for example --dev-origin http://localhost:5173")
	}
	if o.devWiring.check != nil {
		if err := o.devWiring.check(o); err != nil {
			return o, err
		}
	}
	return o, nil
}

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	o, err := parseFlags(args)
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return 0
		}
		console.Fail(productName, err.Error())
		return 2
	}

	dataDir := o.dataDir
	if dataDir == "" {
		if dataDir, err = configfile.DefaultDir(); err != nil {
			console.Fail(productName, "The data folder could not be found: "+err.Error())
			return 1
		}
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		console.Fail(productName, "The data folder could not be created: "+err.Error())
		return 1
	}
	con := console.Open()
	// The settings are read after the log opens, so the log reads the
	// personal values in them once they are there.
	var settings atomic.Pointer[configfile.Store]
	redact := &logs.Redactor{Known: personal(settings.Load)}
	level := new(slog.LevelVar)
	level.Set(o.logLevel)
	desktopLog, err := openLog(dataDir, logs.Desktop)
	if err == nil {
		defer desktopLog.Close()
	}
	identityLog, ierr := openLog(dataDir, logs.Identity)
	if err = errors.Join(err, ierr); err != nil {
		console.Fail(productName, "The log in the data folder could not be opened: "+err.Error())
		return 1
	}
	defer identityLog.Close()
	logger := slog.New(logs.NewHandler(logs.NewSink(redact, desktopLog, con.Errors), logs.Desktop, level))
	identityLogger := slog.New(logs.NewHandler(logs.NewSink(redact, identityLog, con.Errors), logs.Identity, level))
	area := func(name string) *slog.Logger { return logger.With(logs.AreaKey, name) }
	// The tray library logs through the standard logger.
	log.SetFlags(0)
	log.SetOutput(logs.Standard(area("system"), slog.LevelWarn))
	// The data folder by its kind, never its path: a path names the person.
	dataKind := "default"
	if o.dataDir != "" {
		dataKind = "chosen"
	}
	area("start").Info("Starting.", "version", version, "data", dataKind, "level", logs.LevelName(o.logLevel))
	detail := &logs.Detail{Level: level, Base: o.logLevel, Log: area("logs")}
	logDir := filepath.Join(dataDir, logs.Dir)
	// A crash writes only to standard error, which a program started from
	// a launcher loses; the runtime copies it to a file the next start
	// reads into the log.
	crashed, err := logs.KeepCrashes(filepath.Join(dataDir, logs.CrashFile))
	if err != nil {
		area("crash").Warn("A crash cannot be kept for the next start.", "error", err)
	}
	// The crash goes into the log once the settings are read, so the
	// redactor knows the personal values they hold, such as the home
	// network's name. A start that stops before them writes it with the
	// values it knows, since the file is empty now.
	noteCrash := func() {
		if len(crashed) == 0 {
			return
		}
		area("crash").Error("The last run stopped with a crash.")
		for _, line := range crashed {
			area("crash").Error(line)
		}
		crashed = nil
	}
	fail := func(message string) int {
		noteCrash()
		area("start").Error(message)
		console.Fail(productName, message)
		return 1
	}

	// The secrets live in the system's own store, or in a file where the
	// first start found none (internal/adapters/vault).
	var secrets ports.Vault
	store, err := configfile.Open(filepath.Join(dataDir, "config.json"), func(place domain.SecretPlace) (ports.Vault, error) {
		v, err := vault.Open(dataDir, place)
		secrets = v
		return v, err
	})
	switch {
	case errors.Is(err, vault.ErrNoStore):
		return fail("Your passwords and keys are kept in this computer's password store, which did not answer. Unlock it, or sign in to your desktop, and start " + productName + " again. (" + err.Error() + ")")
	case err != nil:
		return fail("The settings could not be read: " + err.Error())
	}
	settings.Store(store)
	noteCrash()
	// A detailed log turned on before a restart goes on until its end.
	detail.Set(store.Get().LogDetailedUntil)
	identityBin := o.identityBin
	if identityBin == "" {
		if identityBin, err = besideExecutable("identity"); err != nil {
			return fail("The identity service could not be found: " + err.Error())
		}
	}

	port := o.port
	if port == 0 {
		port = store.Get().Port
	}
	local := domain.LoopbackOrigin(port)
	lns, outcome, err := instance.Claim(context.Background(), port)
	switch outcome {
	case instance.Running:
		fmt.Fprintf(con.Out, "%s is already running at %s/app\n", productName, local)
		if !o.noBrowser {
			// A copy too old to be asked leaves the app to open here.
			if instance.OpenAgain(context.Background(), port) != nil {
				_ = browser.Open(local + "/app")
			}
		}
		return 0
	case instance.Occupied:
		area("start").Error("The port is taken by another program.", "port", port, "error", err)
		return fail(instance.OccupiedMessage(productName, port))
	}

	var spa fs.FS
	immutable := false
	switch {
	case o.dev:
	case o.spaDir != "":
		if spa, err = web.FromDisk(o.spaDir); err != nil {
			return fail("--spa-dir holds no index.html: " + err.Error())
		}
	default:
		spa, immutable = web.Embedded(), true
	}

	// The identity service answers the browser's origin: the loopback one,
	// or in development the Vite dev server's, and the home network's.
	browserOrigin := local
	if o.dev {
		browserOrigin = o.devOrigin
	}
	id := &identityproc.Supervisor{
		Binary:      identityBin,
		Vault:       secrets,
		ProductName: productName,
		Settings: func() identityproc.Settings {
			cfg := store.Get()
			return identityproc.Settings{
				Origins:      domain.Origins(cfg, browserOrigin),
				ClientID:     cfg.Google.ClientID,
				ClientSecret: cfg.Google.ClientSecret,
			}
		},
		Log:    area("identity"),
		Output: logs.NewRelay(identityLogger),
		// The service logs everything; the desktop's level, which the
		// detailed log changes while the service runs, decides what stays.
		LogLevel: func() string { return "debug" },
	}
	defer id.Stop()
	requestLog := area("http")

	configured := func() bool { return store.Get().Google.Configured() }
	httpClient := &http.Client{Timeout: 30 * time.Second}
	deSEC := &desec.Client{BaseURL: o.desecAPI, HTTP: httpClient, TokenName: productName + " on this computer", Log: area("desec")}
	certSource := &certs.Source{
		Dir:           certs.Dir{Path: filepath.Join(dataDir, "tls"), Vault: secrets},
		ACMEDirectory: o.acmeDirectory,
		Records:       deSEC,
		Propagated:    desec.Servers{Addrs: desec.NameServers, Log: area("cert")}.Wait,
		// A short margin once every server shows the record, for one that
		// answered from an old copy just before it took the change.
		Settle: 15 * time.Second,
		Log:    area("cert"),
		HTTP:   httpClient,
	}
	if o.devWiring.certs != nil {
		o.devWiring.certs(certSource)
	}
	lanManager := &application.Manager{
		Config:  store,
		PortUse: netif.PortUse,
		Certs:   certSource,
		Listen:  o.devWiring.listen,
		Handler: func(origin, hostHeader string) http.Handler {
			return front.Handler(front.Options{
				Listener:         front.Listener{Origin: origin, ExpectedHost: hostHeader},
				WrongHost:        productName + " answers only at its home-network name. Google sign-in and the browser's saved work both depend on that exact name, so a numeric address does not work.",
				FromThisComputer: netif.FromThisComputer,
				LocalOrigin:      local,
				Identity:         id,
				Configured:       configured,
				SPA:              spa,
				SPAImmutable:     immutable,
				Logger:           requestLog,
				HTTPS:            true,
			})
		},
		Log:      area("homenet"),
		ErrorLog: logs.ServerLog(area("homenet")),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	quit := make(chan struct{}, 1)

	key, err := admin.NewKey()
	if err != nil {
		return fail("The setup page's key could not be made: " + err.Error())
	}
	useTray := !o.noTray && !o.dev && tray.Available()
	systemLanguage := locale.System()
	adminHost := domain.LoopbackHost("localhost", port)
	var login ports.Autostart = autostart.System{}
	if o.devWiring.autostart != nil {
		login = o.devWiring.autostart
	}
	auto := &autostart.Remembered{List: login}
	loginWith := loginArgs(o, dataDir)
	wipe := &application.Wipe{Config: store, Identity: id, LAN: lanManager, Certs: certSource, Autostart: auto,
		Logs: logFiles{files: []*logs.File{desktopLog, identityLog}, detail: detail}}
	adm := &admin.Admin{
		Version:        version,
		ProductName:    productName,
		DataDir:        dataDir,
		Host:           adminHost,
		LoopbackOrigin: local,
		AppOrigin:      browserOrigin,
		Key:            key,
		Tray:           useTray,
		SystemLanguage: systemLanguage,
		Config:         store,
		Identity:       id,
		LAN:            lanManager,
		Name:           &application.HomeName{Config: store, Account: deSEC, Log: area("desec")},
		Addresses:      netif.PrivateAddresses,
		Autostart:      auto,
		Wipe:           wipe,
		Executable:     admin.Executable,
		LoginArgs:      loginWith,
		HTTP:           httpClient,
		ReleaseURL:     admin.LatestReleaseURL,
		Quit: func() {
			select {
			case quit <- struct{}{}:
			default:
			}
		},
		OpenAgain: func() {
			target := local + "/app"
			if !useTray {
				target = admin.SetupURL(local, key, "")
			}
			if err := browser.Open(target); err != nil {
				// The setup address holds the key, which the log never holds.
				area("start").Warn("The browser did not open for a second launch.", "error", err)
			}
		},
		LogDir:     logDir,
		OpenFolder: browser.OpenFolder,
		Detail:     detail,
		Log:        area("setup"),
	}
	listener := front.Listener{Origin: local, ExpectedHost: adminHost}
	alias := domain.LoopbackHost("127.0.0.1", port)
	if o.dev {
		listener.Origin = o.devOrigin
		listener.ExpectedHost = ""
		alias = ""
	}
	setupPage := adm.Handler()
	if o.devWiring.setupPage != nil {
		setupPage = o.devWiring.setupPage(setupPage)
	}
	srv := &http.Server{
		Handler: front.Handler(front.Options{
			Listener:     listener,
			AliasHost:    alias,
			WrongHost:    productName + " answers only at its own address.",
			Identity:     id,
			Desktop:      setupPage,
			Configured:   configured,
			SPA:          spa,
			SPAImmutable: immutable,
			Logger:       requestLog,
		}),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		ErrorLog:          logs.ServerLog(requestLog),
	}
	// The port answers before the identity service starts, so a second
	// launch finds this copy rather than a silent port; until the service
	// is ready, its routes answer that it is unavailable.
	served := make(chan error, len(lns))
	for _, ln := range lns {
		go func() { served <- srv.Serve(ln) }()
	}
	if err := id.Start(); err != nil {
		area("identity").Error("The identity service did not start. Trying again.", "error", err)
	}

	setup := admin.SetupURL(local, key, "")
	target := local + "/app"
	if o.dev {
		fmt.Fprintf(con.Out, "%s %s identity service (development) on %s, for %s\n", productName, version, local, o.devOrigin)
		if con.Terminal != nil {
			fmt.Fprintf(con.Terminal, "Setup: %s\n", setup)
		}
	} else {
		stops := "Closing this window stops " + productName + "."
		switch {
		case useTray:
			stops = "Quit in the tray icon's menu or on the setup page stops " + productName + "."
		case runtime.GOOS == "windows":
			stops = "Quit on the setup page stops " + productName + "."
		}
		fmt.Fprintf(con.Out, "%s %s is running.\n\n  Open: %s/app\n", productName, version, local)
		// The setup address holds the key, so it goes to a terminal only.
		switch {
		case con.Terminal != nil:
			fmt.Fprintf(con.Terminal, "  Setup: %s\n", setup)
		case useTray:
			fmt.Fprintf(con.Out, "  Setup: in the tray icon's menu\n")
		}
		fmt.Fprintf(con.Out, "  Data: %s\n\n%s\n\n", dataDir, stops)
	}
	if !o.noBrowser && !o.dev {
		if err := browser.Open(target); err != nil {
			fmt.Fprintf(con.Out, "Open %s in your browser.\n", target)
		}
	}
	if store.Get().LAN.AutoStart && !o.dev {
		if err := lanManager.Resume(); err != nil {
			area("homenet").Error("The home network did not turn on at start.", "error", err)
		}
	}

	wait := func() {
		select {
		case <-ctx.Done():
		case <-quit:
		case err := <-served:
			requestLog.Error("The server stopped.", "error", err)
		}
	}
	if useTray {
		tray.Run(trayActions(local, key, systemLanguage, logDir, store, lanManager, auto, admin.Executable, loginWith, adm.Quit, area("tray")), wait)
	} else {
		wait()
	}
	fmt.Fprintf(con.Out, "Stopping %s.\n", productName)
	area("start").Info("Stopping.")
	id.Stop()
	_ = lanManager.Stop()
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	return 0
}

// loginArgs answers the flags the login entry repeats: the port and the
// data folder when they were given, the folder made absolute, since the
// login starts the program from another working folder.
func loginArgs(o options, dataDir string) []string {
	var out []string
	if o.port != 0 {
		out = append(out, "--port", strconv.Itoa(o.port))
	}
	if o.dataDir != "" {
		if abs, err := filepath.Abs(dataDir); err == nil {
			dataDir = abs
		}
		out = append(out, "--data-dir", dataDir)
	}
	return out
}

// besideExecutable answers the path of the program name in this program's
// folder, the way the release archive lays them out.
func besideExecutable(name string) (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(filepath.Dir(exe), name), nil
}

// logFiles are the log files, which a wipe of every setting empties, with
// the detailed time, which it ends.
type logFiles struct {
	files  []*logs.File
	detail *logs.Detail
}

func (l logFiles) Clear() error {
	l.detail.Set(time.Time{})
	var errs []error
	for _, f := range l.files {
		errs = append(errs, f.Clear())
	}
	return errors.Join(errs...)
}

// openLog opens source's log in the data folder.
func openLog(dataDir, source string) (*logs.File, error) {
	return logs.Open(filepath.Join(dataDir, logs.Dir), source, func(started time.Time) string {
		return logs.Header(productName, version, runtime.GOOS+"/"+runtime.GOARCH, source, started)
	})
}

// personal answers the personal values the log removes: the home folder,
// the user's and the computer's names, and the home network's name and
// the email of its deSEC account, read from the settings of store.
func personal(store func() *configfile.Store) func() []logs.Known {
	home, _ := os.UserHomeDir()
	host, _ := os.Hostname()
	fixed := []logs.Known{
		{Value: home, As: logs.AsHome},
		{Value: filepath.ToSlash(home), As: logs.AsHome},
		{Value: filepath.Base(home), As: logs.AsUser, Word: true},
		{Value: host, As: logs.AsComputer, Word: true},
	}
	if u, err := user.Current(); err == nil {
		// On Windows the name carries its computer or domain before a
		// backslash.
		fixed = append(fixed, logs.Known{Value: u.Username, As: logs.AsUser, Word: true})
		if _, name, ok := strings.Cut(u.Username, "\\"); ok {
			fixed = append(fixed, logs.Known{Value: name, As: logs.AsUser, Word: true})
		}
	}
	return func() []logs.Known {
		s := store()
		if s == nil {
			return fixed
		}
		d := s.Get().LAN.DeSEC
		return append(slices.Clone(fixed),
			logs.Known{Value: d.Domain(), As: logs.AsName},
			logs.Known{Value: d.Name, As: logs.AsName, Word: true},
			logs.Known{Value: d.Email, As: logs.AsEmail})
	}
}
