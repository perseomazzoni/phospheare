// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package certs

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/crypto/acme"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

// LetsEncrypt is the production directory of Let's Encrypt.
const LetsEncrypt = "https://acme-v02.api.letsencrypt.org/directory"

// DNS publishes a DNS-01 challenge record and answers how to remove it.
type DNS interface {
	SetTXT(ctx context.Context, fqdn, value string) (cleanup func(context.Context) error, err error)
}

// Issuer obtains certificates by DNS-01 validation.
type Issuer struct {
	DirectoryURL string
	AccountKey   crypto.Signer
	// AcceptedTerms is the address of the authority's agreement the person
	// accepted. Obtain asks the authority for nothing while the directory
	// names another one.
	AcceptedTerms string
	HTTP          *http.Client
	DNS           DNS
	// Propagated returns once fqdn carries value where the authority looks;
	// report hears how many servers show it, or the seconds of a timed wait.
	Propagated func(ctx context.Context, fqdn, value string, report func(done, total int, timed bool)) error
	// Settle is how long to wait once Propagated returns, for the copies of
	// the name servers it cannot ask; the one retry waits twice as long.
	Settle time.Duration
	// Log hears the authority's own words for a refusal the error says
	// plainly; it may be nil.
	Log *slog.Logger
	// Report hears how far Obtain has come; it may be nil.
	Report func(domain.Progress)
}

// NotSeenError is a refusal because the authority could not see the
// challenge record from every place it checks from, twice.
type NotSeenError struct {
	Host string
	Err  error
}

func (e *NotSeenError) Error() string {
	return "Let's Encrypt could not yet see " + e.Host + " from everywhere it checks: deSEC is still sending the name around the world. Try again in a few minutes."
}

func (e *NotSeenError) Unwrap() error { return e.Err }

// RateLimitedError is a refusal because the authority has issued as many
// certificates for the name, or the account, as its limits allow for now.
type RateLimitedError struct {
	Err error
}

func (e *RateLimitedError) Error() string {
	return "Let's Encrypt asks to wait before it issues another certificate for this name. Try again in a few hours."
}

func (e *RateLimitedError) Unwrap() error { return e.Err }

// TermsError is the refusal Obtain answers while the agreement in force is
// not the one accepted.
type TermsError = ports.TermsError

// actionAsked answers the page the authority sends a person to before it
// goes on, and whether err is that refusal.
func actionAsked(err error) (string, bool) {
	var ae *acme.Error
	if errors.As(err, &ae) && ae.ProblemType == "urn:ietf:params:acme:error:userActionRequired" {
		return ae.Instance, true
	}
	return "", false
}

const userAgent = "once-dark-studio-desktop"

// currentTerms answers the address of the agreement the directory names, or
// "" when it names none. It reads public metadata and registers nothing.
func currentTerms(ctx context.Context, directory string, client *http.Client) (string, error) {
	cl := &acme.Client{DirectoryURL: directory, HTTPClient: client, UserAgent: userAgent, RetryBackoff: retryBackoff}
	dir, err := cl.Discover(ctx)
	if err != nil {
		return "", fmt.Errorf("acme directory: %w", err)
	}
	return dir.Terms, nil
}

func rateLimited(err error) bool {
	var ae *acme.Error
	return errors.As(err, &ae) && (ae.StatusCode == http.StatusTooManyRequests || ae.ProblemType == "urn:ietf:params:acme:error:rateLimited")
}

// retryBackoff is the pause before the acme client asks again after a
// server error: the authority's Retry-After when it gives one, up to a
// minute, and a pause that doubles up to 10 seconds otherwise. A rate limit
// is not asked again: its limits last hours, far past the quarter of an hour
// a start may take, and waiting it out hides the reason.
func retryBackoff(n int, _ *http.Request, resp *http.Response) time.Duration {
	if resp != nil && resp.StatusCode == http.StatusTooManyRequests {
		return -1
	}
	if resp != nil {
		if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && s >= 0 {
			return min(time.Duration(s)*time.Second, time.Minute)
		}
	}
	return min(time.Second<<min(n, 4), 10*time.Second)
}

// retryBackoff is the package's pause, with a line for each retry, so a
// wait on a failing authority shows in the log.
func (i *Issuer) retryBackoff(n int, r *http.Request, resp *http.Response) time.Duration {
	d := retryBackoff(n, r, resp)
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	if d < 0 {
		i.log().Warn("Let's Encrypt refused a request. Not asking again.", "status", status)
	} else {
		i.log().Warn("Let's Encrypt did not answer as expected. Asking again.", "status", status, "try", n+1, "after", d)
	}
	return d
}

// Obtain answers a PEM certificate chain and its PEM private key for
// hostname. Every challenge record it creates is removed before it returns.
// The authority checks the record from several places; when one of them
// cannot see it yet, Obtain waits and asks once more with a new order.
//
// It answers a TermsError, and registers no account and places no order,
// while the directory names an agreement other than AcceptedTerms.
func (i *Issuer) Obtain(ctx context.Context, hostname string) (certPEM, keyPEM []byte, err error) {
	certPEM, keyPEM, err = i.obtainOnce(ctx, hostname, false)
	if visit, asked := actionAsked(err); asked {
		i.log().Warn("Let's Encrypt asks for its agreement to be accepted again.", "error", err)
		return nil, nil, &TermsError{Visit: visit, Err: err}
	}
	if rateLimited(err) {
		i.log().Warn("Let's Encrypt asks to wait before it issues another certificate.", "error", err)
		return nil, nil, &RateLimitedError{Err: err}
	}
	if !notSeen(err) {
		return certPEM, keyPEM, err
	}
	i.log().Warn("Let's Encrypt could not see the proof from every place it checks. Asking again.", "error", err)
	i.report(domain.Progress{Stage: domain.StagePublish, Again: true})
	if err := wait(ctx, 2*i.Settle); err != nil {
		return nil, nil, err
	}
	certPEM, keyPEM, err = i.obtainOnce(ctx, hostname, true)
	if rateLimited(err) {
		i.log().Warn("Let's Encrypt asks to wait before it issues another certificate.", "error", err)
		return nil, nil, &RateLimitedError{Err: err}
	}
	if notSeen(err) {
		i.log().Warn("Let's Encrypt could not see the proof from every place it checks, twice.", "error", err)
		return nil, nil, &NotSeenError{Host: hostname, Err: err}
	}
	return certPEM, keyPEM, err
}

// notSeen reports whether err is the authority failing to find the
// challenge record over DNS.
func notSeen(err error) bool {
	var ae *acme.AuthorizationError
	if !errors.As(err, &ae) {
		return false
	}
	for _, e := range ae.Errors {
		var pe *acme.Error
		if errors.As(e, &pe) && pe.ProblemType == "urn:ietf:params:acme:error:dns" {
			return true
		}
	}
	return false
}

func wait(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (i *Issuer) log() *slog.Logger {
	if i.Log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return i.Log
}

func (i *Issuer) report(p domain.Progress) {
	if i.Report != nil {
		i.Report(p)
	}
}

// obtainOnce runs one order for hostname; again marks the second.
func (i *Issuer) obtainOnce(ctx context.Context, hostname string, again bool) (certPEM, keyPEM []byte, err error) {
	cl := &acme.Client{Key: i.AccountKey, DirectoryURL: i.DirectoryURL, HTTPClient: i.HTTP, UserAgent: userAgent, RetryBackoff: i.retryBackoff}
	log := i.log().With("again", again)
	log.Debug("Reading the ACME directory.")
	dir, err := cl.Discover(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("acme directory: %w", err)
	}
	// The agreement is compared here and not in Register's prompt: Register
	// sends the account request whatever the prompt answers, and an account
	// key the authority already knows passes without any agreement.
	// A directory that names no agreement asks for none.
	if dir.Terms != "" && dir.Terms != i.AcceptedTerms {
		return nil, nil, &TermsError{URL: dir.Terms}
	}
	if _, err := cl.Register(ctx, &acme.Account{}, acme.AcceptTOS); err != nil && !errors.Is(err, acme.ErrAccountAlreadyExists) {
		return nil, nil, fmt.Errorf("acme account: %w", err)
	}
	log.Debug("The ACME account is ready.")
	log.Info("Asking Let's Encrypt for an order.")
	order, err := cl.AuthorizeOrder(ctx, acme.DomainIDs(hostname))
	if err != nil {
		return nil, nil, fmt.Errorf("acme order: %w", err)
	}
	log.Info("The order is placed.", "proofs", len(order.AuthzURLs))
	for _, u := range order.AuthzURLs {
		if err := i.authorize(ctx, cl, u, again); err != nil {
			return nil, nil, err
		}
	}
	order, err = cl.WaitOrder(ctx, order.URI)
	if err != nil {
		return nil, nil, fmt.Errorf("acme order: %w", err)
	}
	log.Info("Let's Encrypt is issuing the certificate.")
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{DNSNames: []string{hostname}}, key)
	if err != nil {
		return nil, nil, err
	}
	chain, _, err := cl.CreateOrderCert(ctx, order.FinalizeURL, csr, true)
	if err != nil {
		// CreateOrderCert waits on the finalize answer's `Location` header,
		// which RFC 8555 does not require and some authorities omit while
		// the order is processing; the order's own URL serves the wait.
		chain, err = i.fetchIssued(ctx, cl, order.URI, err)
		if err != nil {
			return nil, nil, fmt.Errorf("acme certificate: %w", err)
		}
	}
	log.Info("Let's Encrypt issued the certificate.", "chain", len(chain))
	for _, der := range chain {
		certPEM = append(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM, nil
}

// fetchIssued waits for the order at orderURL and fetches its chain; it
// answers finalizeErr when the order does not become valid.
func (i *Issuer) fetchIssued(ctx context.Context, cl *acme.Client, orderURL string, finalizeErr error) ([][]byte, error) {
	order, err := cl.WaitOrder(ctx, orderURL)
	if err != nil || order.Status != acme.StatusValid || order.CertURL == "" {
		return nil, finalizeErr
	}
	return cl.FetchCert(ctx, order.CertURL, true)
}

func (i *Issuer) authorize(ctx context.Context, cl *acme.Client, authzURL string, again bool) error {
	log := i.log().With("again", again)
	z, err := cl.GetAuthorization(ctx, authzURL)
	if err != nil {
		return fmt.Errorf("acme authorization: %w", err)
	}
	if z.Status == acme.StatusValid {
		log.Info("Let's Encrypt still holds a valid proof for the name.")
		return nil
	}
	var chal *acme.Challenge
	for _, c := range z.Challenges {
		if c.Type == "dns-01" {
			chal = c
			break
		}
	}
	if chal == nil {
		return errors.New("acme: the authority offers no dns-01 challenge")
	}
	value, err := cl.DNS01ChallengeRecord(chal.Token)
	if err != nil {
		return err
	}
	fqdn := "_acme-challenge." + z.Identifier.Value
	i.report(domain.Progress{Stage: domain.StagePublish, Again: again})
	log.Info("Writing the proof record at deSEC.")
	cleanup, err := i.DNS.SetTXT(ctx, fqdn, value)
	if err != nil {
		return fmt.Errorf("challenge record: %w", err)
	}
	log.Info("The proof record is written at deSEC.")
	defer func() {
		if err := cleanup(context.WithoutCancel(ctx)); err != nil {
			log.Warn("The proof record could not be removed from deSEC.", "error", err)
		} else {
			log.Debug("The proof record is removed from deSEC.")
		}
	}()
	if i.Propagated != nil {
		started := time.Now()
		err := i.Propagated(ctx, fqdn, value, func(done, total int, timed bool) {
			i.report(domain.Progress{Stage: domain.StagePublish, Done: done, Total: total, Timed: timed, Again: again})
		})
		if err != nil {
			return err
		}
		log.Info("deSEC's servers show the proof.", "after", time.Since(started).Round(time.Second))
	}
	if i.Settle > 0 {
		log.Debug("Waiting a short margin for copies of the servers.", "for", i.Settle)
	}
	if err := wait(ctx, i.Settle); err != nil {
		return err
	}
	i.report(domain.Progress{Stage: domain.StageCheck, Again: again})
	log.Info("Asking Let's Encrypt to check the proof.")
	started := time.Now()
	if _, err := cl.Accept(ctx, chal); err != nil {
		return fmt.Errorf("acme challenge: %w", err)
	}
	if _, err := cl.WaitAuthorization(ctx, z.URI); err != nil {
		return fmt.Errorf("acme authorization: %w", err)
	}
	log.Info("Let's Encrypt accepted the proof.", "after", time.Since(started).Round(time.Second))
	return nil
}
