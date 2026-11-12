// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package application

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// memConfig is a settings store that is never written.
type memConfig struct {
	mu  sync.Mutex
	cfg domain.Config
}

func (m *memConfig) Get() domain.Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cfg
}

func (m *memConfig) Update(change func(*domain.Config)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	change(&m.cfg)
	return nil
}

type fakeCerts struct {
	mu       sync.Mutex
	cert     *tls.Certificate
	err      error
	renewed  int
	prepared int
	writes   int
	writesAt int
	// terms is the agreement in force, visit a page the authority asks for.
	terms    string
	visit    string
	termsErr error
	// noTerms is an authority that names no agreement.
	noTerms bool
	// heard is reported, then Prepare waits for hold when it is not nil.
	heard *domain.Progress
	hold  chan struct{}
}

// Prepare answers err when set and, like the real source, the context's
// error once it is done.
func (f *fakeCerts) Prepare(ctx context.Context, _ domain.LAN, report func(domain.Progress)) (*tls.Certificate, domain.CertInfo, error) {
	if f.heard != nil {
		report(*f.heard)
	}
	if f.hold != nil {
		<-f.hold
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.prepared++
	err := f.err
	if err == nil {
		err = ctx.Err()
	}
	return f.cert, domain.CertInfo{NotAfter: f.cert.Leaf.NotAfter, Issuer: "Test"}, err
}

func (f *fakeCerts) fail(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

func (f *fakeCerts) prepares() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.prepared
}

// Renew refuses with a TermsError while cfg does not carry the agreement in
// force, as the real source does once the certificate is due.
func (f *fakeCerts) Renew(_ context.Context, cfg domain.LAN, cur domain.CertInfo) (*tls.Certificate, domain.CertInfo, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.renewed++
	if f.terms != "" && cfg.CertTerms != f.terms {
		return nil, cur, &ports.TermsError{URL: f.terms}
	}
	if f.visit != "" {
		return nil, cur, &ports.TermsError{Visit: f.visit}
	}
	return nil, cur, nil
}

// Terms answers the agreement in force, testTerms unless a test set one.
func (f *fakeCerts) Terms(context.Context, domain.LAN) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.noTerms {
		return "", f.termsErr
	}
	if f.terms == "" {
		return testTerms, f.termsErr
	}
	return f.terms, f.termsErr
}

func (f *fakeCerts) set(change func(*fakeCerts)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	change(f)
}

func (f *fakeCerts) renewals() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.renewed
}

// testTerms is the agreement the test settings have accepted.
const testTerms = "https://example.test/terms"

// WriteAddress counts the tries; the record is written at the try
// writesAt, 0 for at once.
func (f *fakeCerts) WriteAddress(context.Context, domain.LAN) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.writes++
	if f.writes < f.writesAt {
		return true, errors.New("deSEC cannot be reached")
	}
	return false, nil
}

func (f *fakeCerts) addressWrites() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.writes
}

func testCert(t *testing.T, host string) *tls.Certificate {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: host}, DNSNames: []string{host},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(90 * 24 * time.Hour),
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	leaf, _ := x509.ParseCertificate(der)
	return &tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key, Leaf: leaf}
}

func waitState(t *testing.T, m *Manager, want State) Status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if s := m.Status(); s.State == want {
			return s
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("state %s, want %s (%s)", m.Status().State, want, m.Status().Message)
	return Status{}
}

func newManager(t *testing.T, fc *fakeCerts) (*Manager, *string) {
	addr := new(string)
	store := &memConfig{cfg: domain.Config{Google: domain.Google{ClientID: "id", ClientSecret: "secret"}, LAN: domain.LAN{
		Port: 47843, Address: "192.168.1.20", DeSEC: domain.DeSEC{Name: "rossi-studio", Token: "t"}, CertTerms: testTerms,
	}}}
	m := &Manager{
		Config: store,
		Certs:  fc,
		Handler: func(origin, host string) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.WriteString(w, origin+" "+host+" "+r.Host)
			})
		},
		Listen: func(network, a string) (net.Listener, error) {
			if !strings.HasPrefix(a, "0.0.0.0:47843") {
				return nil, errors.New("unexpected address " + a)
			}
			ln, err := net.Listen(network, "127.0.0.1:0")
			if err == nil {
				*addr = ln.Addr().String()
			}
			return ln, err
		},
		RenewEvery: 20 * time.Millisecond,
	}
	t.Cleanup(func() { _ = m.Stop() })
	return m, addr
}

func TestManagerStartsServesAndStops(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, addr := newManager(t, fc)
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	s := waitState(t, m, StateRunning)
	if s.URL != "https://rossi-studio.dedyn.io:47843/app" || s.Cert == nil || m.RunningOrigin() != "https://rossi-studio.dedyn.io:47843" {
		t.Fatalf("status %+v", s)
	}
	if err := m.Start(); err == nil {
		t.Fatal("a second start was accepted")
	}

	pool := x509.NewCertPool()
	pool.AddCert(fc.cert.Leaf)
	client := &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: "rossi-studio.dedyn.io"},
	}}
	resp, err := client.Get("https://" + *addr + "/app")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.HasPrefix(string(got), "https://rossi-studio.dedyn.io:47843 rossi-studio.dedyn.io:47843 ") {
		t.Fatalf("handler saw %q", got)
	}

	old := &tls.Config{RootCAs: pool, ServerName: "rossi-studio.dedyn.io", MaxVersion: tls.VersionTLS11, MinVersion: tls.VersionTLS10}
	if conn, err := tls.Dial("tcp", *addr, old); err == nil {
		conn.Close()
		t.Fatal("a TLS 1.1 handshake succeeded")
	}

	time.Sleep(60 * time.Millisecond)
	fc.mu.Lock()
	renewed := fc.renewed
	fc.mu.Unlock()
	if renewed == 0 {
		t.Fatal("the renewal check never ran")
	}

	if err := m.Stop(); err != nil {
		t.Fatal(err)
	}
	if s := m.Status(); s.State != StateOff || m.RunningOrigin() != "" {
		t.Fatalf("after stop %+v", s)
	}
	if _, err := client.Get("https://" + *addr + "/app"); err == nil {
		t.Fatal("the listener still answers after stop")
	}
}

func TestTheSwitchRemembersWhereItWasLeft(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, _ := newManager(t, fc)
	if err := m.TurnOn(); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateRunning)
	if !m.Config.Get().LAN.AutoStart {
		t.Fatal("turning on does not keep it on")
	}
	if err := m.TurnOff(); err != nil {
		t.Fatal(err)
	}
	if m.Status().State != StateOff || m.Config.Get().LAN.AutoStart {
		t.Fatalf("turning off: %+v, autostart %v", m.Status(), m.Config.Get().LAN.AutoStart)
	}
	if err := m.Stop(); err != nil || m.Config.Get().LAN.AutoStart {
		t.Fatal("a plain stop changes the remembered state")
	}
}

func TestManagerReportsCertificateFailure(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), err: errors.New("deSEC does not accept this token.")}
	m, _ := newManager(t, fc)
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	s := waitState(t, m, StateError)
	if !strings.Contains(s.Message, "deSEC does not accept") {
		t.Fatalf("status %+v", s)
	}
	fc.fail(nil)
	if err := m.Start(); err != nil {
		t.Fatalf("restart after an error: %v", err)
	}
	waitState(t, m, StateRunning)
}

// While starting, the status says how far it has come and for how long;
// once running it says neither.
func TestStartingSaysHowFarItHasCome(t *testing.T) {
	heard := domain.Progress{Stage: domain.StagePublish, Done: 9, Total: 15}
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), heard: &heard, hold: make(chan struct{})}
	m, _ := newManager(t, fc)
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for m.Status().Progress == nil && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if s := m.Status(); s.State != StateStarting || s.Progress == nil || *s.Progress != heard {
		t.Fatalf("while starting %+v", s)
	}
	close(fc.hold)
	if s := waitState(t, m, StateRunning); s.Progress != nil || s.Elapsed != 0 {
		t.Fatalf("running %+v", s)
	}
}

func TestStartingThatRunsTooLongSaysSoPlainly(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), hold: make(chan struct{})}
	m, _ := newManager(t, fc)
	m.PrepareTimeout = 20 * time.Millisecond
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	close(fc.hold)
	if s := waitState(t, m, StateError); !strings.Contains(s.Message, "quarter of an hour") {
		t.Fatalf("status %+v", s)
	}
}

// The message of a start that ran out of time keeps what kept it waiting.
func TestStartingThatRunsTooLongSaysWhatHeldItUp(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), hold: make(chan struct{}), err: errors.New("acme order: 503 the authority is busy")}
	m, _ := newManager(t, fc)
	m.PrepareTimeout = 20 * time.Millisecond
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	time.Sleep(50 * time.Millisecond)
	close(fc.hold)
	s := waitState(t, m, StateError)
	if !strings.Contains(s.Message, "quarter of an hour") || !strings.Contains(s.Message, "the authority is busy") {
		t.Fatalf("status %+v", s)
	}
}

// unreachable is the error of a computer that is not on the network yet.
var unreachable = fmt.Errorf("deSEC cannot be reached: %w", &net.DNSError{Err: "no such host", Name: "desec.io"})

func TestAStartAtLoginTriesAgainWithoutNetwork(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), err: unreachable}
	m, _ := newManager(t, fc)
	m.RetryAfter = 30 * time.Millisecond
	if err := m.Resume(); err != nil {
		t.Fatal(err)
	}
	if s := waitState(t, m, StateError); !strings.Contains(s.Message, "Trying again in") {
		t.Fatalf("status %+v", s)
	}
	deadline := time.Now().Add(5 * time.Second)
	for fc.prepares() < 2 {
		if time.Now().After(deadline) {
			t.Fatal("the start at login was not tried again")
		}
		time.Sleep(5 * time.Millisecond)
	}
	fc.fail(nil)
	waitState(t, m, StateRunning)
}

func TestAStartAtLoginGivesUpOnARefusal(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), err: errors.New("deSEC does not accept this token.")}
	m, _ := newManager(t, fc)
	m.RetryAfter = 10 * time.Millisecond
	if err := m.Resume(); err != nil {
		t.Fatal(err)
	}
	if s := waitState(t, m, StateError); strings.Contains(s.Message, "Trying again") {
		t.Fatalf("status %+v", s)
	}
	time.Sleep(100 * time.Millisecond)
	if n := fc.prepares(); n != 1 {
		t.Fatalf("a refusal was tried %d times", n)
	}
}

func TestAStartFromTheSwitchDoesNotTryAgain(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), err: unreachable}
	m, _ := newManager(t, fc)
	m.RetryAfter = 10 * time.Millisecond
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	if s := waitState(t, m, StateError); strings.Contains(s.Message, "Trying again") {
		t.Fatalf("status %+v", s)
	}
	time.Sleep(100 * time.Millisecond)
	if n := fc.prepares(); n != 1 {
		t.Fatalf("a start from the switch was tried %d times", n)
	}
}

func TestStopEndsTheWaitOfAStartAtLogin(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), err: unreachable}
	m, _ := newManager(t, fc)
	m.RetryAfter = time.Hour
	if err := m.Resume(); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateError)
	done := make(chan error, 1)
	go func() { done <- m.TurnOff() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("turning off waited for the retry")
	}
	if m.Status().State != StateOff || fc.prepares() != 1 {
		t.Fatalf("after turning off %+v, %d prepares", m.Status(), fc.prepares())
	}
}

// A connection that outlasts the graceful stop is closed, and the switch
// still remembers it was turned off.
func TestTurningOffClosesConnectionsThatStayOpen(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, addr := newManager(t, fc)
	release := make(chan struct{})
	defer close(release)
	entered := make(chan struct{}, 1)
	m.Handler = func(origin, host string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			entered <- struct{}{}
			<-release
		})
	}
	if err := m.TurnOn(); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateRunning)
	pool := x509.NewCertPool()
	pool.AddCert(fc.cert.Leaf)
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: "rossi-studio.dedyn.io"}}}
	failed := make(chan error, 1)
	go func() {
		resp, err := client.Get("https://" + *addr + "/app")
		if err == nil {
			resp.Body.Close()
		}
		failed <- err
	}()
	<-entered
	start := time.Now()
	if err := m.TurnOff(); err != nil {
		t.Fatal(err)
	}
	if took := time.Since(start); took > 8*time.Second {
		t.Fatalf("turning off took %s", took)
	}
	if m.Config.Get().LAN.AutoStart {
		t.Fatal("the switch does not remember it was turned off")
	}
	select {
	case err := <-failed:
		if err == nil {
			t.Fatal("the held request was answered")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the held connection stayed open")
	}
}

func TestManagerRefusesInvalidConfiguration(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, _ := newManager(t, fc)
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.Address = "8.8.8.8" })
	if err := m.Start(); err == nil {
		t.Fatal("a public address was accepted")
	}
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.Address = "192.168.1.20"; c.LAN.DeSEC.Token = "" })
	if err := m.Start(); err == nil {
		t.Fatal("a name with no token was accepted")
	}
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.DeSEC.Token = "t"; c.Google = domain.Google{} })
	if err := m.Start(); err == nil {
		t.Fatal("a home network without Google was accepted")
	}
	if m.Status().State != StateOff {
		t.Fatal("a refused start changed the state")
	}
}

// The port the listener holds counts as free; any other held port is
// refused with the reason, and the pick skips it.
func TestPortsAreCheckedAndPicked(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, _ := newManager(t, fc)
	var mu sync.Mutex
	held := map[int]domain.PortUse{domain.DefaultLANPort: domain.PortNotAllowed, 47900: domain.PortInUse}
	m.PortUse = func(p int) domain.PortUse {
		mu.Lock()
		defer mu.Unlock()
		if u, ok := held[p]; ok {
			return u
		}
		return domain.PortFree
	}
	if err := m.CheckPort(domain.DefaultLANPort); err == nil || !strings.Contains(err.Error(), "special permission") {
		t.Fatalf("443: %v", err)
	}
	if err := m.CheckPort(47900); err == nil || !strings.Contains(err.Error(), "another program") {
		t.Fatalf("held: %v", err)
	}
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.Port = 47900 })
	if err := m.Start(); err == nil || !strings.Contains(err.Error(), "47900") {
		t.Fatalf("started on a held port: %v", err)
	}
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.Port = 47843 })
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateRunning)
	mu.Lock()
	held[47843] = domain.PortInUse
	mu.Unlock()
	if err := m.CheckPort(47843); err != nil {
		t.Fatalf("the listener's own port: %v", err)
	}
	p := m.Ports()
	if p.Current.Use != domain.PortFree || p.Default.Use != domain.PortNotAllowed || p.Suggested != domain.FallbackLANPort {
		t.Fatalf("ports %+v", p)
	}
	m.PickPort()
	if got := m.Config.Get().LAN.Port; got != domain.FallbackLANPort {
		t.Fatalf("picked %d", got)
	}
}

// A port check while Start probes its port is answered without a second
// probe: two probes of one port at the same time each find it held by the
// other, and Start would refuse a free port.
func TestAPortCheckDuringStartsProbeDoesNotRefuseIt(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, _ := newManager(t, fc)
	var mu sync.Mutex
	inFlight, collided, first := 0, false, true
	entered, release := make(chan struct{}), make(chan struct{})
	m.PortUse = func(p int) domain.PortUse {
		if p != 47843 {
			return domain.PortFree
		}
		mu.Lock()
		inFlight++
		collided = collided || inFlight > 1
		wait := first
		first = false
		mu.Unlock()
		if wait {
			close(entered)
			<-release
		}
		mu.Lock()
		defer mu.Unlock()
		inFlight--
		if collided {
			return domain.PortInUse
		}
		return domain.PortFree
	}
	started := make(chan error, 1)
	go func() { started <- m.Start() }()
	<-entered
	checked := m.CheckPort(47843)
	current := m.Ports().Current.Use
	close(release)
	if err := <-started; err != nil {
		t.Fatalf("Start refused a free port: %v", err)
	}
	if checked != nil || current != domain.PortFree {
		t.Fatalf("the port Start probes: check %v, ports %v", checked, current)
	}
	waitState(t, m, StateRunning)
}

// While the listener serves, an address the start could not write is tried
// again until a try writes it.
func TestTheListenerWritesAnAddressTheStartCouldNot(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), writesAt: 3}
	m, _ := newManager(t, fc)
	m.AddressEvery = 5 * time.Millisecond
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateRunning)
	deadline := time.Now().Add(5 * time.Second)
	for fc.addressWrites() < 3 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if fc.addressWrites() < 3 {
		t.Fatalf("the address was tried %d times", fc.addressWrites())
	}
	if s := m.Status(); s.State != StateRunning {
		t.Fatalf("an unwritten address stopped the listener: %+v", s)
	}
}

// ── The certificate authority's agreement ────────────────────────────────────

func waitTerms(t *testing.T, m *Manager, want string) Status {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if s := m.Status(); s.Terms == want {
			return s
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("terms %q, want %q", m.Status().Terms, want)
	return Status{}
}

const newTerms = "https://example.test/terms-2"

// A start that served the stored certificate under an agreement since
// replaced says so at once, keeps serving, and asks again once the person
// accepts.
func TestAReplacedAgreementIsAskedForWhileTheListenerServes(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), terms: newTerms}
	m, _ := newManager(t, fc)
	m.RenewEvery = time.Hour
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateRunning)
	if s := waitTerms(t, m, newTerms); s.State != StateRunning || s.Cert == nil {
		t.Fatalf("status %+v", s)
	}
	if st, err := m.Terms(context.Background()); err != nil || st.URL != newTerms || st.Accepted {
		t.Fatalf("terms %+v %v", st, err)
	}
	if err := m.AcceptTerms(context.Background(), testTerms); err == nil {
		t.Fatal("the replaced agreement was accepted")
	}
	before := fc.renewals()
	if err := m.AcceptTerms(context.Background(), newTerms); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for fc.renewals() == before && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if fc.renewals() == before {
		t.Fatal("accepting did not ask for the certificate again")
	}
	if s := waitTerms(t, m, ""); s.State != StateRunning || m.Config.Get().LAN.CertTerms != newTerms {
		t.Fatalf("status %+v, accepted %q", s, m.Config.Get().LAN.CertTerms)
	}
	// A second page that accepts the same agreement gets no error.
	if err := m.AcceptTerms(context.Background(), newTerms); err != nil {
		t.Fatalf("accepting twice: %v", err)
	}
	if st, _ := m.Terms(context.Background()); !st.Accepted {
		t.Fatalf("terms %+v", st)
	}
}

// With no agreement accepted the listener does not start; accepting the one
// in force turns it on and keeps it on.
func TestAcceptingTheAgreementTurnsTheListenerOn(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, _ := newManager(t, fc)
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.CertTerms = "" })
	if err := m.TurnOn(); err == nil || fc.prepares() != 0 {
		t.Fatalf("started without an agreement: %v", err)
	}
	if err := m.AcceptTerms(context.Background(), "https://example.test/another"); err == nil || m.Config.Get().LAN.CertTerms != "" {
		t.Fatalf("another address was accepted: %v", err)
	}
	if err := m.AcceptTerms(context.Background(), testTerms); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateRunning)
	if l := m.Config.Get().LAN; l.CertTerms != testTerms || !l.AutoStart {
		t.Fatalf("settings %+v", l)
	}
}

// A page the authority itself asks for is shown, saved nowhere, and the
// request runs again once the person says it is done.
func TestAPageTheAuthorityAsksForIsShownAndNotSaved(t *testing.T) {
	const visit = "https://example.test/agree"
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), visit: visit}
	m, _ := newManager(t, fc)
	m.RenewEvery = time.Hour
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	waitTerms(t, m, visit)
	fc.set(func(f *fakeCerts) { f.visit = "" })
	if err := m.AcceptTerms(context.Background(), visit); err != nil {
		t.Fatal(err)
	}
	waitTerms(t, m, "")
	if got := m.Config.Get().LAN.CertTerms; got != testTerms {
		t.Fatalf("accepted %q", got)
	}
}

// An address that is not https is never shown or accepted.
func TestAnAgreementThatIsNotHTTPSIsRefused(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), terms: "http://example.test/terms"}
	m, _ := newManager(t, fc)
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.CertTerms = "" })
	if _, err := m.Terms(context.Background()); err == nil {
		t.Fatal("a plain http agreement was shown")
	}
	if err := m.AcceptTerms(context.Background(), "http://example.test/terms"); err == nil || m.Config.Get().LAN.CertTerms != "" {
		t.Fatalf("a plain http agreement was accepted: %v", err)
	}
	if got := termsAsked(&ports.TermsError{URL: "javascript:alert(1)"}); got != "" {
		t.Fatalf("status would show %q", got)
	}
}

// A start refused for the agreement says which one to accept.
func TestAStartRefusedForTheAgreementSaysWhichOne(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), err: &ports.TermsError{URL: newTerms}}
	m, _ := newManager(t, fc)
	if err := m.Start(); err != nil {
		t.Fatal(err)
	}
	if s := waitState(t, m, StateError); s.Terms != newTerms {
		t.Fatalf("status %+v", s)
	}
	fc.set(func(f *fakeCerts) { f.err, f.terms = nil, newTerms })
	if err := m.AcceptTerms(context.Background(), newTerms); err != nil {
		t.Fatal(err)
	}
	if s := waitState(t, m, StateRunning); s.Terms != "" {
		t.Fatalf("status %+v", s)
	}
}

// An authority that names no agreement has none to show; turning on is the
// acceptance, and the settings say so.
func TestAnAuthorityWithNoAgreementTurnsOnWithoutOne(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io"), noTerms: true}
	m, _ := newManager(t, fc)
	_ = m.Config.Update(func(c *domain.Config) { c.LAN.CertTerms = "" })
	if st, err := m.Terms(context.Background()); err != nil || st.URL != "" || st.Accepted {
		t.Fatalf("terms %+v %v", st, err)
	}
	if err := m.AcceptTerms(context.Background(), "https://example.test/terms"); !errors.Is(err, ErrTermsChanged) {
		t.Fatalf("an agreement the authority does not name: %v", err)
	}
	if err := m.AcceptTerms(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	waitState(t, m, StateRunning)
	if got := m.Config.Get().LAN.CertTerms; got != domain.NoCertTerms {
		t.Fatalf("accepted %q", got)
	}
	if st, _ := m.Terms(context.Background()); !st.Accepted {
		t.Fatalf("terms %+v", st)
	}
}

// failingConfig keeps nothing.
type failingConfig struct{ memConfig }

func (f *failingConfig) Update(func(*domain.Config)) error { return errors.New("disk full") }

func TestAnAcceptanceThatCannotBeSavedSaysSo(t *testing.T) {
	fc := &fakeCerts{cert: testCert(t, "rossi-studio.dedyn.io")}
	m, _ := newManager(t, fc)
	m.Config = &failingConfig{memConfig{cfg: m.Config.Get()}}
	var unsaved *SaveError
	if err := m.AcceptTerms(context.Background(), testTerms); !errors.As(err, &unsaved) || m.Status().State != StateOff {
		t.Fatalf("%v, state %s", err, m.Status().State)
	}
}
