// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package certs

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/acme"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec/desectest"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/vault"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

func keyAuthDigest(token, thumbprint string) string {
	sum := sha256.Sum256([]byte(token + "." + thumbprint))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// ── DNS-01 issuance ──────────────────────────────────────────────────────────

func newAccountKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	thumb, err := acme.JWKThumbprint(key.Public())
	if err != nil {
		t.Fatal(err)
	}
	return key, thumb
}

type mapDNS struct {
	d       *txtTable
	removed []string
}

func (m *mapDNS) SetTXT(_ context.Context, fqdn, value string) (func(context.Context) error, error) {
	m.d.set(fqdn, value)
	return func(context.Context) error {
		m.d.set(fqdn, "")
		m.removed = append(m.removed, fqdn)
		return nil
	}, nil
}

func TestIssuerObtainsByDNS01(t *testing.T) {
	resolver := newTXTTable()
	key, thumb := newAccountKey(t)
	ca := newFakeACME(t, resolver, thumb)
	dns := &mapDNS{d: resolver}
	propagated := false
	var heard []domain.Progress
	is := &Issuer{
		DirectoryURL:  ca.url("/directory"),
		AccountKey:    key,
		AcceptedTerms: fakeTerms,
		HTTP:          http.DefaultClient,
		DNS:           dns,
		Propagated: func(ctx context.Context, fqdn, value string, report func(done, total int, timed bool)) error {
			propagated = fqdn == "_acme-challenge.studio.example.com" && value == keyAuthDigest(ca.token, thumb)
			report(9, 15, false)
			return nil
		},
		Report: func(p domain.Progress) { heard = append(heard, p) },
	}
	certPEM, keyPEM, err := is.Obtain(context.Background(), "studio.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !propagated {
		t.Fatal("the issuer did not wait for the challenge record")
	}
	want := []domain.Progress{{Stage: domain.StagePublish}, {Stage: domain.StagePublish, Done: 9, Total: 15}, {Stage: domain.StageCheck}}
	if !slices.Equal(heard, want) {
		t.Fatalf("progress %+v, want %+v", heard, want)
	}
	if len(dns.removed) != 1 {
		t.Fatalf("challenge records left behind: %v", dns.removed)
	}
	cert, info, err := Load(certPEM, keyPEM, "studio.example.com", time.Now())
	if err != nil || cert == nil {
		t.Fatal(err)
	}
	if info.Issuer != "Test Authority Fake ACME CA" || strings.Count(string(certPEM), "BEGIN CERTIFICATE") != 2 {
		t.Fatalf("info %+v", info)
	}
}

func TestIssuerFailsWhenChallengeRecordIsWrong(t *testing.T) {
	resolver := newTXTTable()
	key, _ := newAccountKey(t)
	ca := newFakeACME(t, resolver, "another-thumbprint")
	is := &Issuer{DirectoryURL: ca.url("/directory"), AccountKey: key, AcceptedTerms: fakeTerms, HTTP: http.DefaultClient, DNS: &mapDNS{d: resolver}}
	if _, _, err := is.Obtain(context.Background(), "studio.example.com"); err == nil {
		t.Fatal("a wrong challenge record produced a certificate")
	}
}

// A record the authority cannot find is asked about once more, with a new
// order, and then said plainly.
func TestIssuerAsksOnceMoreWhenTheRecordIsNotSeen(t *testing.T) {
	resolver := newTXTTable()
	key, _ := newAccountKey(t)
	ca := newFakeACME(t, resolver, "another-thumbprint")
	var logged []string
	is := &Issuer{
		DirectoryURL: ca.url("/directory"), AccountKey: key, AcceptedTerms: fakeTerms, HTTP: http.DefaultClient, DNS: &mapDNS{d: resolver},
		Logf: func(format string, args ...any) { logged = append(logged, fmt.Sprintf(format, args...)) },
	}
	_, _, err := is.Obtain(context.Background(), "studio.example.com")
	var ns *NotSeenError
	if !errors.As(err, &ns) || ns.Host != "studio.example.com" || strings.Contains(err.Error(), "NXDOMAIN") {
		t.Fatalf("err %v", err)
	}
	ca.mu.Lock()
	orders := ca.orders
	ca.mu.Unlock()
	if orders != 2 || len(logged) != 2 || !strings.Contains(logged[1], "NXDOMAIN") {
		t.Fatalf("orders %d, logged %q", orders, logged)
	}
}

// ── Source ───────────────────────────────────────────────────────────────────

func TestSourceWritesTheRecordsAndObtains(t *testing.T) {
	resolver := newTXTTable()
	f := desectest.New()
	defer f.Close()
	f.OnTXT = resolver.set
	token := f.AddAccount("name@example.com", "rossi.dedyn.io")
	dir := Dir{Path: filepath.Join(t.TempDir(), "tls"), Vault: vault.Memory()}
	key, err := dir.AccountKey()
	if err != nil {
		t.Fatal(err)
	}
	thumb, _ := acme.JWKThumbprint(key.Public())
	ca := newFakeACME(t, resolver, thumb)
	var waited []string
	src := &Source{
		Dir: dir, ACMEDirectory: ca.url("/directory"), Records: &desec.Client{BaseURL: f.URL, HTTP: f.Client()},
		HTTP: http.DefaultClient,
		Propagated: func(_ context.Context, fqdn, value string, _ func(int, int, bool)) error {
			if !resolver.has(fqdn, value) {
				return fmt.Errorf("%s does not carry %s yet", fqdn, value)
			}
			waited = append(waited, fqdn)
			return nil
		},
	}
	lan := domain.LAN{Port: 47843, Address: "192.168.1.20", DeSEC: domain.DeSEC{Name: "rossi", Token: token}, CertTerms: fakeTerms}
	_, info, err := src.Prepare(context.Background(), lan, nil)
	if err != nil {
		t.Fatal(err)
	}
	if a := f.Record("rossi.dedyn.io", "", "A"); len(a) != 1 || a[0] != "192.168.1.20" {
		t.Fatalf("address record %v", a)
	}
	if len(waited) != 1 || waited[0] != "_acme-challenge.rossi.dedyn.io" {
		t.Fatalf("the source did not wait on the challenge record: %v", waited)
	}
	if f.Record("rossi.dedyn.io", "_acme-challenge", "TXT") != nil {
		t.Fatal("the challenge record stays")
	}
	if time.Until(info.NotAfter) < 80*24*time.Hour {
		t.Fatalf("info %+v", info)
	}
	if _, err := os.Stat(filepath.Join(dir.Path, "cert.pem")); err != nil {
		t.Fatal("the certificate was not stored")
	}

	// A second start with a fresh certificate and a new address rewrites
	// the record and reuses the certificate.
	lan.Address = "192.168.1.30"
	if _, _, err := src.Prepare(context.Background(), lan, nil); err != nil {
		t.Fatal(err)
	}
	if ca.orders != 1 {
		t.Fatalf("a fresh certificate was replaced: %d orders", ca.orders)
	}
	if a := f.Record("rossi.dedyn.io", "", "A"); a[0] != "192.168.1.30" {
		t.Fatalf("the address record was not refreshed: %v", a)
	}
	// Renewal is a no-op while more than 30 days remain, and runs after.
	if cert, _, err := src.Renew(context.Background(), lan, info); err != nil || cert != nil {
		t.Fatalf("early renewal: %v %v", cert, err)
	}
	src.Now = func() time.Time { return time.Now().Add(70 * 24 * time.Hour) }
	if cert, _, err := src.Renew(context.Background(), lan, info); err != nil || cert == nil || ca.orders != 2 {
		t.Fatalf("due renewal: %v %v orders=%d", cert, err, ca.orders)
	}
}

func TestSourceNeedsALinkedName(t *testing.T) {
	src := &Source{}
	if _, _, err := src.Prepare(context.Background(), domain.LAN{DeSEC: domain.DeSEC{Name: "rossi"}}, nil); err == nil {
		t.Fatal("a name without a token prepared a certificate")
	}
}

func TestLoadChecksTheCertificate(t *testing.T) {
	good, goodKey := selfSigned(t, "rossi.dedyn.io", time.Now().Add(time.Hour*24*60))
	old, oldKey := selfSigned(t, "rossi.dedyn.io", time.Now().Add(-time.Hour))
	if _, info, err := Load(good, goodKey, "rossi.dedyn.io", time.Now()); err != nil || info.Issuer != "rossi.dedyn.io" {
		t.Fatalf("good: %v %+v", err, info)
	}
	if _, _, err := Load(good, goodKey, "other.dedyn.io", time.Now()); err == nil || !strings.Contains(err.Error(), "does not cover") {
		t.Fatalf("wrong host: %v", err)
	}
	if _, _, err := Load(old, oldKey, "rossi.dedyn.io", time.Now()); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expired: %v", err)
	}
	if _, _, err := Load(good, oldKey, "rossi.dedyn.io", time.Now()); err == nil {
		t.Fatal("a key from another certificate loaded")
	}
}

func selfSigned(t *testing.T, host string, notAfter time.Time) (certPEM, keyPEM []byte) {
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(9),
		Subject:      pkix.Name{CommonName: host},
		Issuer:       pkix.Name{CommonName: host},
		DNSNames:     []string{host},
		NotBefore:    time.Now().Add(-48 * time.Hour),
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	kd, _ := x509.MarshalECPrivateKey(key)
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kd})
}

func TestAccountKeyIsCreatedOnceAndKeptInTheVault(t *testing.T) {
	dir := Dir{Path: filepath.Join(t.TempDir(), "tls"), Vault: vault.Memory()}
	a, err := dir.AccountKey()
	if err != nil {
		t.Fatal(err)
	}
	b, err := dir.AccountKey()
	if err != nil {
		t.Fatal(err)
	}
	if !a.(*ecdsa.PrivateKey).Equal(b) {
		t.Fatal("the account key changed between reads")
	}
	if kept, _ := dir.Vault.Get(domain.SecretACMEAccountKey); !strings.HasPrefix(kept, "-----BEGIN EC PRIVATE KEY-----") {
		t.Fatalf("the vault keeps %q", kept)
	}
	if entries, _ := os.ReadDir(dir.Path); len(entries) != 0 {
		t.Fatalf("the folder holds %v", entries)
	}
}

func TestTheCertificateKeyIsKeptInTheVaultOnly(t *testing.T) {
	dir := Dir{Path: filepath.Join(t.TempDir(), "tls"), Vault: vault.Memory()}
	certPEM, keyPEM := selfSigned(t, "rossi.dedyn.io", time.Now().Add(time.Hour))
	if err := dir.SaveIssued(certPEM, keyPEM); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(dir.Path)
	if len(entries) != 1 || entries[0].Name() != "cert.pem" {
		t.Fatalf("the folder holds %v", entries)
	}
	gotCert, gotKey, err := dir.Issued()
	if err != nil || string(gotCert) != string(certPEM) || string(gotKey) != string(keyPEM) {
		t.Fatalf("issued: %v", err)
	}
	_ = dir.Vault.Set(domain.SecretTLSKey, "")
	if _, _, err := dir.Issued(); err == nil {
		t.Fatal("a certificate without its key read")
	}
}

func TestForgetRemovesTheCertificateAndBothKeys(t *testing.T) {
	dir := Dir{Path: filepath.Join(t.TempDir(), "tls"), Vault: vault.Memory()}
	if err := dir.Forget(); err != nil {
		t.Fatalf("forgetting nothing: %v", err)
	}
	if _, err := dir.AccountKey(); err != nil {
		t.Fatal(err)
	}
	certPEM, keyPEM := selfSigned(t, "rossi.dedyn.io", time.Now().Add(time.Hour))
	if err := dir.SaveIssued(certPEM, keyPEM); err != nil {
		t.Fatal(err)
	}
	if err := dir.Forget(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{domain.SecretTLSKey, domain.SecretACMEAccountKey} {
		if kept, _ := dir.Vault.Get(name); kept != "" {
			t.Fatalf("the vault still keeps %s", name)
		}
	}
	if _, err := os.Stat(filepath.Join(dir.Path, "cert.pem")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the certificate stays: %v", err)
	}
}

// records fails every write with err, or none when err is nil.
type records struct{ err error }

func (r records) SetA(context.Context, string, string, string) error           { return r.err }
func (r records) SetTXT(context.Context, string, string, string, string) error { return r.err }
func (r records) DeleteTXT(context.Context, string, string, string) error      { return nil }

// storedSource answers a source whose folder holds a certificate for
// rossi.dedyn.io valid until notAfter, and whose authority cannot be
// reached.
func storedSource(t *testing.T, notAfter time.Time, rec records) (*Source, *[]string) {
	t.Helper()
	dir := Dir{Path: filepath.Join(t.TempDir(), "tls"), Vault: vault.Memory()}
	if !notAfter.IsZero() {
		certPEM, keyPEM := selfSigned(t, "rossi.dedyn.io", notAfter)
		if err := dir.SaveIssued(certPEM, keyPEM); err != nil {
			t.Fatal(err)
		}
	}
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()
	logged := new([]string)
	return &Source{
		Dir: dir, ACMEDirectory: closed.URL + "/directory", Records: rec, HTTP: http.DefaultClient,
		Logf: func(format string, args ...any) { *logged = append(*logged, fmt.Sprintf(format, args...)) },
	}, logged
}

var rossi = domain.LAN{Port: 47843, Address: "192.168.1.20", DeSEC: domain.DeSEC{Name: "rossi", Token: "t"}}

func TestAStoredCertificateServesWhenTheAddressCannotBeWritten(t *testing.T) {
	src, logged := storedSource(t, time.Now().Add(60*24*time.Hour), records{err: errors.New("deSEC cannot be reached")})
	cert, _, err := src.Prepare(context.Background(), rossi, nil)
	if err != nil || cert == nil {
		t.Fatalf("prepare: %v %v", cert, err)
	}
	if len(*logged) != 1 || !strings.Contains((*logged)[0], "deSEC cannot be reached") {
		t.Fatalf("logged %q", *logged)
	}
	none, _ := storedSource(t, time.Time{}, records{err: errors.New("deSEC cannot be reached")})
	if _, _, err := none.Prepare(context.Background(), rossi, nil); err == nil || !strings.Contains(err.Error(), "address record") {
		t.Fatalf("without a stored certificate: %v", err)
	}
}

func TestAStoredCertificateServesWhenARenewalFails(t *testing.T) {
	src, logged := storedSource(t, time.Now().Add(10*24*time.Hour), records{})
	cert, info, err := src.Prepare(context.Background(), rossi, nil)
	if err != nil || cert == nil || time.Until(info.NotAfter) > 11*24*time.Hour {
		t.Fatalf("prepare: %v %+v %v", cert, info, err)
	}
	if len(*logged) != 1 || !strings.Contains((*logged)[0], "could not be renewed") {
		t.Fatalf("logged %q", *logged)
	}
	expired, _ := storedSource(t, time.Now().Add(-time.Hour), records{})
	if _, _, err := expired.Prepare(context.Background(), rossi, nil); err == nil {
		t.Fatal("an expired certificate served")
	}
}

// A rate limit is reported at once, in words, instead of being waited out.
func TestTheIssuerReportsARateLimitAtOnce(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Replay-Nonce", "nonce")
		switch r.URL.Path {
		case "/directory":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"newNonce": srv.URL + "/nonce", "newAccount": srv.URL + "/account", "newOrder": srv.URL + "/order",
			})
		case "/nonce":
			w.WriteHeader(http.StatusOK)
		default:
			w.Header().Set("Content-Type", "application/problem+json")
			w.Header().Set("Retry-After", "3600")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = io.WriteString(w, `{"type":"urn:ietf:params:acme:error:rateLimited","detail":"too many certificates already issued"}`)
		}
	}))
	defer srv.Close()
	key, _ := newAccountKey(t)
	var logged []string
	iss := &Issuer{DirectoryURL: srv.URL + "/directory", AccountKey: key, HTTP: srv.Client(),
		Logf: func(format string, args ...any) { logged = append(logged, fmt.Sprintf(format, args...)) }}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	start := time.Now()
	_, _, err := iss.Obtain(ctx, "rossi.dedyn.io")
	var limited *RateLimitedError
	if !errors.As(err, &limited) || time.Since(start) > 5*time.Second {
		t.Fatalf("after %s: %v", time.Since(start), err)
	}
	if !strings.Contains(err.Error(), "Let's Encrypt asks to wait") || len(logged) != 1 || !strings.Contains(logged[0], "too many certificates") {
		t.Fatalf("error %q, logged %q", err, logged)
	}
}

// countingRecords fails SetA while err is set, and counts the calls.
type countingRecords struct {
	records
	setA *int
}

func (r countingRecords) SetA(ctx context.Context, token, domain, ip string) error {
	*r.setA++
	return r.err
}

// An address record the start could not write is written by a later call,
// and once written no call asks deSEC again.
func TestAnAddressLeftUnwrittenIsWrittenLater(t *testing.T) {
	calls := 0
	src, logged := storedSource(t, time.Now().Add(60*24*time.Hour), records{})
	src.Records = countingRecords{records{err: errors.New("deSEC cannot be reached")}, &calls}
	if cert, _, err := src.Prepare(context.Background(), rossi, nil); err != nil || cert == nil {
		t.Fatalf("prepare: %v %v", cert, err)
	}
	if owed, err := src.WriteAddress(context.Background(), rossi); !owed || err == nil {
		t.Fatalf("while deSEC is unreachable: %v %v", owed, err)
	}
	src.Records = countingRecords{records{}, &calls}
	if owed, err := src.WriteAddress(context.Background(), rossi); owed || err != nil {
		t.Fatalf("once deSEC answers: %v %v", owed, err)
	}
	before := calls
	if owed, err := src.WriteAddress(context.Background(), rossi); owed || err != nil || calls != before {
		t.Fatalf("after the write: %v %v, %d more calls", owed, err, calls-before)
	}
	if last := (*logged)[len(*logged)-1]; !strings.Contains(last, "address record is written") {
		t.Fatalf("logged %q", *logged)
	}
}

// A start that writes the address owes nothing.
func TestAWrittenAddressOwesNothing(t *testing.T) {
	calls := 0
	src, _ := storedSource(t, time.Now().Add(60*24*time.Hour), records{})
	src.Records = countingRecords{records{}, &calls}
	if _, _, err := src.Prepare(context.Background(), rossi, nil); err != nil {
		t.Fatal(err)
	}
	if owed, err := src.WriteAddress(context.Background(), rossi); owed || err != nil || calls != 1 {
		t.Fatalf("%v %v after %d calls", owed, err, calls)
	}
}

// ── The authority's agreement ────────────────────────────────────────────────

// counts answers how many account and order requests the authority got.
func (a *fakeACME) counts() (accounts, orders int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.accounts, a.orders
}

// Without the agreement in force accepted, the authority gets no account
// request and no order, whether the account key is new or already known.
func TestNoAgreementAsksTheAuthorityForNothing(t *testing.T) {
	resolver := newTXTTable()
	key, thumb := newAccountKey(t)
	ca := newFakeACME(t, resolver, thumb)
	is := &Issuer{DirectoryURL: ca.url("/directory"), AccountKey: key, HTTP: http.DefaultClient, DNS: &mapDNS{d: resolver}}
	refused := func(accepted string) {
		t.Helper()
		before, _ := ca.counts()
		is.AcceptedTerms = accepted
		_, _, err := is.Obtain(context.Background(), "studio.example.com")
		var terms *TermsError
		if !errors.As(err, &terms) || terms.URL != ca.terms || terms.Visit != "" {
			t.Fatalf("accepted %q: %v", accepted, err)
		}
		if accounts, orders := ca.counts(); accounts != before || orders != 0 {
			t.Fatalf("accepted %q: %d account requests, %d orders", accepted, accounts-before, orders)
		}
	}
	refused("")
	refused("https://example.test/another")

	// The key becomes one the authority knows; a newer agreement still stops
	// every request made with it.
	is.AcceptedTerms = fakeTerms
	if _, _, err := is.Obtain(context.Background(), "studio.example.com"); err != nil {
		t.Fatal(err)
	}
	ca.mu.Lock()
	ca.terms, ca.orders = "https://example.test/terms-2", 0
	ca.mu.Unlock()
	refused(fakeTerms)
}

// A step the authority asks of the person itself is a TermsError that
// carries the authority's page, and no order follows.
func TestAnActionTheAuthorityAsksForIsATermsError(t *testing.T) {
	resolver := newTXTTable()
	key, thumb := newAccountKey(t)
	ca := newFakeACME(t, resolver, thumb)
	ca.action = "https://example.test/agree"
	var logged []string
	is := &Issuer{
		DirectoryURL: ca.url("/directory"), AccountKey: key, AcceptedTerms: fakeTerms, HTTP: http.DefaultClient, DNS: &mapDNS{d: resolver},
		Logf: func(format string, args ...any) { logged = append(logged, fmt.Sprintf(format, args...)) },
	}
	_, _, err := is.Obtain(context.Background(), "studio.example.com")
	var terms *TermsError
	if !errors.As(err, &terms) || terms.Visit != "https://example.test/agree" || terms.URL != "" {
		t.Fatalf("err %v", err)
	}
	if _, orders := ca.counts(); orders != 0 || len(logged) != 1 || !strings.Contains(logged[0], "the agreement changed") {
		t.Fatalf("orders %d, logged %q", orders, logged)
	}
}

// The source hands the accepted agreement to the issuer, and answers the
// agreement in force from memory until it is an hour old.
func TestSourceAsksUnderTheAcceptedAgreementOnly(t *testing.T) {
	resolver := newTXTTable()
	dir := Dir{Path: filepath.Join(t.TempDir(), "tls"), Vault: vault.Memory()}
	key, err := dir.AccountKey()
	if err != nil {
		t.Fatal(err)
	}
	thumb, _ := acme.JWKThumbprint(key.Public())
	ca := newFakeACME(t, resolver, thumb)
	now := time.Now()
	src := &Source{Dir: dir, ACMEDirectory: ca.url("/directory"), Records: records{}, HTTP: http.DefaultClient, Now: func() time.Time { return now }}

	_, _, err = src.Prepare(context.Background(), rossi, nil)
	var terms *TermsError
	if !errors.As(err, &terms) || terms.URL != fakeTerms {
		t.Fatalf("prepare without an agreement: %v", err)
	}
	if accounts, orders := ca.counts(); accounts != 0 || orders != 0 {
		t.Fatalf("%d account requests, %d orders", accounts, orders)
	}

	if got, err := src.Terms(context.Background(), rossi); err != nil || got != fakeTerms {
		t.Fatalf("terms: %q %v", got, err)
	}
	ca.mu.Lock()
	ca.terms = "https://example.test/terms-2"
	ca.mu.Unlock()
	if got, _ := src.Terms(context.Background(), rossi); got != fakeTerms {
		t.Fatalf("within the hour: %q", got)
	}
	// A request refused for the agreement drops what Terms remembers, so
	// the acceptance that follows reads the one in force.
	accepted := rossi
	accepted.CertTerms = fakeTerms
	if _, _, err := src.Prepare(context.Background(), accepted, nil); !errors.As(err, &terms) || terms.URL != "https://example.test/terms-2" {
		t.Fatalf("prepare under the replaced agreement: %v", err)
	}
	if got, _ := src.Terms(context.Background(), rossi); got != "https://example.test/terms-2" {
		t.Fatalf("after the refusal: %q", got)
	}
	ca.mu.Lock()
	ca.terms = "https://example.test/terms-3"
	ca.mu.Unlock()
	if got, _ := src.Terms(context.Background(), rossi); got != "https://example.test/terms-2" {
		t.Fatalf("within the next hour: %q", got)
	}
	now = now.Add(2 * time.Hour)
	if got, err := src.Terms(context.Background(), rossi); err != nil || got != "https://example.test/terms-3" {
		t.Fatalf("after the hour: %q %v", got, err)
	}

	// An authority that names no agreement is asked without one.
	ca.mu.Lock()
	ca.terms = ""
	ca.mu.Unlock()
	none := rossi
	none.CertTerms = domain.NoCertTerms
	if _, _, err := src.Prepare(context.Background(), none, nil); errors.As(err, &terms) {
		t.Fatalf("no agreement named: %v", err)
	}
	if accounts, _ := ca.counts(); accounts == 0 {
		t.Fatal("the authority was not asked")
	}
}
