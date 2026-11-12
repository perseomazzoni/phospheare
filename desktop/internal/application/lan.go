// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package application runs the desktop's use cases. Manager runs the
// optional home-network listener: HTTPS only, TLS 1.2 or later, on all
// interfaces at the configured port, answering only for the configured
// hostname. It is off until the user starts it. HomeName gives that
// listener its free name at deSEC.
package application

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// State is where the listener is.
type State string

const (
	StateOff      State = "off"
	StateStarting State = "starting"
	StateRunning  State = "running"
	StateError    State = "error"
)

// Status is what the setup page shows.
type Status struct {
	State    State            `json:"state"`
	Message  string           `json:"message,omitempty"`
	URL      string           `json:"url,omitempty"`
	Hostname string           `json:"hostname,omitempty"`
	Port     int              `json:"port,omitempty"`
	Address  string           `json:"address,omitempty"`
	Cert     *domain.CertInfo `json:"certificate,omitempty"`
	// Progress and Elapsed, in seconds, say how far starting has come.
	Progress *domain.Progress `json:"progress,omitempty"`
	Elapsed  int              `json:"elapsed,omitempty"`
	// Terms is the address of the certificate authority's agreement the
	// person must accept before the next certificate, "" when none waits.
	Terms string `json:"terms,omitempty"`
}

// TermsState is the certificate authority's agreement in force and whether
// it is the one the person accepted.
type TermsState struct {
	URL      string `json:"url"`
	Accepted bool   `json:"accepted"`
}

// HandlerFor answers the handler for a listener with origin, answering
// only for host.
type HandlerFor func(origin, host string) http.Handler

// Manager starts and stops the listener.
type Manager struct {
	Config  ports.ConfigStore
	Certs   ports.CertSource
	Handler HandlerFor
	// Listen opens the TCP listener; net.Listen when nil.
	Listen func(network, addr string) (net.Listener, error)
	// RenewEvery is the certificate check period, 12 hours when zero.
	RenewEvery time.Duration
	// AddressEvery is how often an address record the start could not
	// write is tried again, 5 minutes when zero; deSEC allows a few dozen
	// record writes an hour.
	AddressEvery time.Duration
	// PortUse tells whether a port can be opened now.
	PortUse func(port int) domain.PortUse
	// PrepareTimeout bounds obtaining a certificate, 15 minutes when zero:
	// the setup page promises at most a quarter of an hour.
	PrepareTimeout time.Duration
	// RetryAfter is the first pause before a start at login that found no
	// network tries again; each pause doubles it. 30 seconds when zero.
	RetryAfter time.Duration
	Logf       func(format string, args ...any)

	// ops makes Start and Stop take turns, so a Start never joins the wait
	// of a Stop under way.
	ops     sync.Mutex
	mu      sync.Mutex
	status  Status
	server  *http.Server
	cert    *tls.Certificate
	stop    context.CancelFunc
	started time.Time
	running sync.WaitGroup
	// probing is the port Start is probing, 0 when none. The setup page
	// counts it as this program's, since two probes of one port at the same
	// time each find it held by the other.
	probing int
	// wake makes the running listener check its certificate now.
	wake chan struct{}
}

// Status answers the current status.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.status
	if s.State == "" {
		s.State = StateOff
	}
	if s.State == StateStarting {
		s.Elapsed = int(time.Since(m.started) / time.Second)
	}
	return s
}

// RunningOrigin answers the origin while the listener runs, and "".
func (m *Manager) RunningOrigin() string {
	s := m.Status()
	if s.State != StateRunning {
		return ""
	}
	return domain.Origin(s.Hostname, s.Port)
}

// loginRetries is how often a start at login tries again; with the pauses
// doubling from 30 seconds, it gives up after about half an hour.
const loginRetries = 6

// Start validates the configuration and starts the listener in the
// background; Status reports the outcome. It refuses while the listener is
// starting or running.
func (m *Manager) Start() error {
	m.ops.Lock()
	defer m.ops.Unlock()
	return m.start(false)
}

// Resume starts the listener as Start does, when the program starts with
// the switch left on. A computer that has just logged in may not be on the
// network yet, so a start that fails for lack of network tries again after
// a growing pause, up to loginRetries times; Start and Stop end the waiting.
func (m *Manager) Resume() error {
	m.ops.Lock()
	defer m.ops.Unlock()
	return m.start(true)
}

func (m *Manager) start(resume bool) error {
	c := m.Config.Get()
	if err := domain.Validate(c); err != nil {
		return err
	}
	cfg := c.LAN
	m.mu.Lock()
	busy := m.status.State == StateStarting || m.status.State == StateRunning
	if !busy {
		m.probing = cfg.Port
	}
	m.mu.Unlock()
	if busy {
		return errors.New("Home-network access is already on.")
	}
	// The port is checked before the certificate, which can take minutes, and
	// outside m.mu, so Status answers while the probe waits. m.ops keeps any
	// other Start or Stop out meanwhile.
	use := m.probe(cfg.Port)
	m.mu.Lock()
	m.probing = 0
	if use != domain.PortFree {
		m.mu.Unlock()
		return errors.New(portRefused(cfg.Port, use, false))
	}
	if m.stop != nil {
		m.stop()
	}
	if m.server != nil {
		_ = m.server.Close()
		m.server = nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.stop = cancel
	m.started = time.Now()
	m.status = Status{State: StateStarting, Message: "Preparing the certificate", Hostname: cfg.Hostname(), Port: cfg.Port, Address: cfg.Address}
	wake := make(chan struct{}, 1)
	m.wake = wake
	m.running.Add(1)
	m.mu.Unlock()
	go m.run(ctx, cfg, resume, wake)
	return nil
}

// termsAsked answers the address err sends the person to, when err is the
// authority's agreement not accepted and the address is one to show.
func termsAsked(err error) string {
	var te *ports.TermsError
	if errors.As(err, &te) && domain.TermsAddress(te.Address()) {
		return te.Address()
	}
	return ""
}

const termsTimeout = 30 * time.Second

// SaveError is an acceptance the settings store could not keep.
type SaveError struct{ Err error }

func (e *SaveError) Error() string { return e.Err.Error() }
func (e *SaveError) Unwrap() error { return e.Err }

// Why the agreement could not be read or accepted.
var (
	ErrTermsUnreachable = errors.New("Let's Encrypt could not be reached to read its agreement. Try again in a few minutes.")
	ErrTermsUnshown     = errors.New("The certificate authority names no agreement this program can show.")
	ErrTermsChanged     = errors.New("The agreement changed while the page was open. Read it again.")
)

// Terms asks the certificate authority which agreement is in force and
// answers whether the person accepted it. An authority that names none
// answers an empty address; turning the listener on is then the acceptance.
func (m *Manager) Terms(ctx context.Context) (TermsState, error) {
	cfg := m.Config.Get().LAN
	tctx, cancel := context.WithTimeout(ctx, termsTimeout)
	defer cancel()
	current, err := m.Certs.Terms(tctx, cfg)
	if err != nil {
		m.logf("home network: the agreement could not be read: %v", err)
		return TermsState{}, ErrTermsUnreachable
	}
	if current == "" {
		return TermsState{Accepted: cfg.CertTerms == domain.NoCertTerms}, nil
	}
	if !domain.TermsAddress(current) {
		m.logf("home network: the authority names no agreement to show: %q", current)
		return TermsState{}, ErrTermsUnshown
	}
	return TermsState{URL: current, Accepted: cfg.CertTerms == current}, nil
}

// AcceptTerms records that the person accepted the agreement at address and
// goes on with what waited for it: it turns the listener on when it is off,
// and has a running listener ask for its certificate again. It refuses an
// address that is neither the agreement in force nor the page the authority
// asked the person to act on. The agreement in force is the only address it
// saves; for an authority that names none, address is "" and it saves
// NoCertTerms.
func (m *Manager) AcceptTerms(ctx context.Context, address string) error {
	state, err := m.Terms(ctx)
	if err != nil {
		return err
	}
	m.ops.Lock()
	defer m.ops.Unlock()
	m.mu.Lock()
	asked := m.status.Terms
	m.mu.Unlock()
	switch {
	case address == state.URL:
		accepted := state.URL
		if accepted == "" {
			accepted = domain.NoCertTerms
		}
		if err := m.Config.Update(func(c *domain.Config) { c.LAN.CertTerms = accepted }); err != nil {
			return &SaveError{Err: err}
		}
	case address != "" && address == asked:
	default:
		return ErrTermsChanged
	}
	m.mu.Lock()
	st, wake := m.status.State, m.wake
	if st == StateRunning {
		m.status.Terms = ""
	}
	m.mu.Unlock()
	switch st {
	case StateStarting:
		return nil
	case StateRunning:
		select {
		case wake <- struct{}{}:
		default:
		}
		return nil
	}
	if err := m.start(false); err != nil {
		return err
	}
	if err := m.Config.Update(func(c *domain.Config) { c.LAN.AutoStart = true }); err != nil {
		return &SaveError{Err: err}
	}
	return nil
}

func (m *Manager) logf(format string, args ...any) {
	if m.Logf != nil {
		m.Logf(format, args...)
	}
}

func (m *Manager) fail(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.status.State = StateError
	m.status.Message = err.Error()
	m.status.URL = ""
	m.status.Progress = nil
	m.status.Terms = termsAsked(err)
	m.logf("home network: %v", err)
}

func (m *Manager) prepareOnce(ctx context.Context, cfg domain.LAN) (*tls.Certificate, domain.CertInfo, error) {
	timeout := m.PrepareTimeout
	if timeout == 0 {
		timeout = 15 * time.Minute
	}
	pctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cert, info, err := m.Certs.Prepare(pctx, cfg, func(p domain.Progress) {
		m.mu.Lock()
		defer m.mu.Unlock()
		if ctx.Err() == nil && m.status.State == StateStarting {
			m.status.Progress = &p
		}
	})
	if err != nil && ctx.Err() == nil && errors.Is(pctx.Err(), context.DeadlineExceeded) {
		// The last failure says what kept it waiting, unless it is only the
		// deadline itself.
		if err != nil && err.Error() != context.DeadlineExceeded.Error() {
			return nil, info, fmt.Errorf("It took longer than a quarter of an hour (%v). Try again in a few minutes.", err)
		}
		return nil, info, errors.New("It took longer than a quarter of an hour. Try again in a few minutes.")
	}
	return cert, info, err
}

// prepare obtains the certificate and, for a resumed start, tries again
// while the network is missing. It answers false when the start ended, with
// Status saying why.
func (m *Manager) prepare(ctx context.Context, cfg domain.LAN, resume bool) (*tls.Certificate, domain.CertInfo, bool) {
	pause := m.RetryAfter
	if pause == 0 {
		pause = 30 * time.Second
	}
	for try := 1; ; try++ {
		cert, info, err := m.prepareOnce(ctx, cfg)
		if ctx.Err() != nil {
			return nil, info, false
		}
		if err == nil {
			return cert, info, true
		}
		if !resume || try > loginRetries || !offline(err) {
			m.fail(err)
			return nil, info, false
		}
		m.fail(errors.New(strings.TrimSuffix(err.Error(), ".") + ". Trying again in " + inWords(pause) + "."))
		if wait(ctx, pause) != nil {
			return nil, info, false
		}
		m.mu.Lock()
		if ctx.Err() != nil {
			m.mu.Unlock()
			return nil, info, false
		}
		m.started = time.Now()
		m.status = Status{State: StateStarting, Message: "Preparing the certificate", Hostname: cfg.Hostname(), Port: cfg.Port, Address: cfg.Address}
		m.mu.Unlock()
		pause *= 2
	}
}

// offline reports a failure to reach a server at all, as on a computer not
// yet on the network, rather than a server's refusal.
func offline(err error) bool {
	var ne net.Error
	return errors.As(err, &ne)
}

// inWords says d the way the setup page shows a wait.
func inWords(d time.Duration) string {
	if d < time.Minute {
		return strconv.Itoa(int(d/time.Second)) + " seconds"
	}
	if n := int(d / time.Minute); n > 1 {
		return strconv.Itoa(n) + " minutes"
	}
	return "a minute"
}

func wait(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (m *Manager) run(ctx context.Context, cfg domain.LAN, resume bool, wake chan struct{}) {
	defer m.running.Done()
	cert, info, ok := m.prepare(ctx, cfg, resume)
	if !ok {
		return
	}
	listen := m.Listen
	if listen == nil {
		listen = net.Listen
	}
	ln, err := listen("tcp", net.JoinHostPort("0.0.0.0", strconv.Itoa(cfg.Port)))
	if err != nil {
		m.logf("home network: port %d: %v", cfg.Port, err)
		m.fail(errors.New(portRefused(cfg.Port, m.probe(cfg.Port), false)))
		return
	}
	origin := domain.Origin(cfg.Hostname(), cfg.Port)
	srv := &http.Server{
		Handler:           m.Handler(origin, domain.HostHeader(cfg.Hostname(), cfg.Port)),
		ReadHeaderTimeout: 10 * time.Second,
		// Any device on the home network can connect, so a slow reader or
		// writer is cut off rather than held open.
		ReadTimeout:  time.Minute,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
		TLSConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			GetCertificate: func(*tls.ClientHelloInfo) (*tls.Certificate, error) {
				m.mu.Lock()
				defer m.mu.Unlock()
				return m.cert, nil
			},
		},
	}
	m.mu.Lock()
	if ctx.Err() != nil {
		m.mu.Unlock()
		ln.Close()
		return
	}
	m.cert = cert
	m.server = srv
	m.status.State = StateRunning
	m.status.Message = ""
	m.status.Progress = nil
	m.status.URL = origin + "/app"
	m.status.Cert = &info
	m.mu.Unlock()
	m.logf("home network: serving %s", origin)

	served := make(chan error, 1)
	go func() { served <- srv.Serve(tls.NewListener(ln, srv.TLSConfig)) }()
	m.renewLoop(ctx, cfg, info, served, wake)
}

// renewLoop keeps the certificate and the address record current while the
// listener serves. It checks the certificate once at the start, then every
// RenewEvery and whenever wake fires: a start that served the stored
// certificate hides a refused request, and the first check brings it out.
func (m *Manager) renewLoop(ctx context.Context, cfg domain.LAN, info domain.CertInfo, served chan error, wake chan struct{}) {
	renewErr := ""
	renew := func() {
		// The agreement may be accepted while the listener runs; the rest
		// of cfg stays as it was at the start.
		cfg.CertTerms = m.Config.Get().LAN.CertTerms
		rctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
		cert, next, err := m.Certs.Renew(rctx, cfg, info)
		cancel()
		if ctx.Err() != nil {
			return
		}
		m.mu.Lock()
		m.status.Terms = termsAsked(err)
		if err == nil && cert != nil {
			info = next
			m.cert = cert
			m.status.Cert = &next
		}
		m.mu.Unlock()
		switch {
		case err == nil:
			renewErr = ""
			if cert != nil {
				m.logf("home network: certificate renewed")
			}
		case err.Error() != renewErr:
			// A renewal still refused is logged once per reason.
			renewErr = err.Error()
			m.logf("home network: certificate renewal: %v", err)
		}
	}
	renew()
	every := m.RenewEvery
	if every == 0 {
		every = 12 * time.Hour
	}
	t := time.NewTicker(every)
	defer t.Stop()
	addressEvery := m.AddressEvery
	if addressEvery == 0 {
		addressEvery = 5 * time.Minute
	}
	address := time.NewTicker(addressEvery)
	defer address.Stop()
	addressErr := ""
	for {
		select {
		case <-ctx.Done():
			return
		case err := <-served:
			if !errors.Is(err, http.ErrServerClosed) {
				m.fail(err)
			}
			return
		case <-address.C:
			// A record still unwritten is logged once per reason, not at
			// every try.
			actx, cancel := context.WithTimeout(ctx, time.Minute)
			_, err := m.Certs.WriteAddress(actx, cfg)
			cancel()
			if err == nil {
				addressErr = ""
			} else if err.Error() != addressErr {
				addressErr = err.Error()
				m.logf("home network: %v", err)
			}
		case <-wake:
			renew()
		case <-t.C:
			renew()
		}
	}
}

// PortChoice is what the setup page shows about the home network's port:
// the one set, the two it prefers, and a free one to suggest, 0 when none
// was found.
type PortChoice struct {
	Current   domain.PortCheck `json:"current"`
	Default   domain.PortCheck `json:"default"`
	Fallback  domain.PortCheck `json:"fallback"`
	Suggested int              `json:"suggested"`
}

// probe tells whether port can be opened now, free when nothing probes.
func (m *Manager) probe(port int) domain.PortUse {
	if m.PortUse == nil {
		return domain.PortFree
	}
	return m.PortUse(port)
}

// use tells whether port can be opened now; the port the listener itself
// holds, or Start is probing, counts as free.
func (m *Manager) use(port int) domain.PortUse {
	if m.ours(port) {
		return domain.PortFree
	}
	return m.probe(port)
}

func (m *Manager) ours(port int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if port != 0 && port == m.probing {
		return true
	}
	return (m.status.State == StateRunning || m.status.State == StateStarting) && m.status.Port == port
}

// Ports answers the port choice as it stands now. The ports shown are
// probed at the same time, each one once (`probing`), and the suggestion
// reuses their answers.
func (m *Manager) Ports() PortChoice {
	current := m.Config.Get().LAN.Port
	var probed []int
	for _, p := range []int{current, domain.DefaultLANPort, domain.FallbackLANPort} {
		if !slices.Contains(probed, p) {
			probed = append(probed, p)
		}
	}
	found := make([]domain.PortUse, len(probed))
	var wg sync.WaitGroup
	for i, p := range probed {
		wg.Go(func() { found[i] = m.use(p) })
	}
	wg.Wait()
	known := func(p int) domain.PortUse {
		if i := slices.Index(probed, p); i >= 0 {
			return found[i]
		}
		return m.use(p)
	}
	check := func(p int) domain.PortCheck { return domain.PortCheck{Port: p, Use: known(p)} }
	return PortChoice{
		Current:   check(current),
		Default:   check(domain.DefaultLANPort),
		Fallback:  check(domain.FallbackLANPort),
		Suggested: domain.PickPort(known),
	}
}

// PickPort sets the port to the first free one of PickPort's order. It is
// done once, when the name is linked; after that the port is the person's
// to change. When none is free, or the setting cannot be saved, the port
// set stays, and the page offers to change it.
func (m *Manager) PickPort() {
	p := domain.PickPort(m.use)
	if p == 0 {
		m.logf("home network: no free port found from %d", domain.DefaultLANPort)
		return
	}
	if err := m.Config.Update(func(c *domain.Config) { c.LAN.Port = p }); err != nil {
		m.logf("home network: the port could not be saved: %v", err)
	}
}

// CheckPort refuses a port that cannot be opened now, saying why plainly.
func (m *Manager) CheckPort(port int) error {
	use := m.use(port)
	if use == domain.PortFree {
		return nil
	}
	return errors.New(portRefused(port, use, true))
}

// portRefused says why port cannot be opened, as use found it; choosing says
// it while the person picks a number rather than after turning on failed.
func portRefused(port int, use domain.PortUse, choosing bool) string {
	why := "another program on this computer uses it"
	if use == domain.PortNotAllowed {
		why = "this computer keeps it for programs with special permission"
	}
	if choosing {
		return fmt.Sprintf("The number %d can't be used: %s. Choose another one.", port, why)
	}
	return fmt.Sprintf("The number %d can't be used: %s. Choose another one under \"The number at the end of the address\".", port, why)
}

// TurnOn starts the listener and keeps it on: it starts again with the
// process.
func (m *Manager) TurnOn() error {
	if err := m.Start(); err != nil {
		return err
	}
	return m.Config.Update(func(c *domain.Config) { c.LAN.AutoStart = true })
}

// TurnOff stops the listener and keeps it off, even when the listener's
// connections had to be cut.
func (m *Manager) TurnOff() error {
	stopped := m.Stop()
	if err := m.Config.Update(func(c *domain.Config) { c.LAN.AutoStart = false }); err != nil {
		return err
	}
	return stopped
}

// Stop closes the listener and waits for its goroutines. Open connections
// get 5 seconds to finish; then they are closed.
func (m *Manager) Stop() error {
	m.ops.Lock()
	defer m.ops.Unlock()
	m.mu.Lock()
	stop, srv := m.stop, m.server
	m.stop, m.server, m.cert = nil, nil, nil
	m.status = Status{State: StateOff}
	m.mu.Unlock()
	if stop != nil {
		stop()
	}
	var err error
	if srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if graceful := srv.Shutdown(ctx); graceful != nil {
			m.logf("home network: closing the connections still open: %v", graceful)
			err = srv.Close()
		}
		cancel()
	}
	m.running.Wait()
	return err
}
