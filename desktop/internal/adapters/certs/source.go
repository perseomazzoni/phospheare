// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package certs provides the home-network listener's certificate.
//
// The home network's name is a free `dedyn.io` name at deSEC. The host
// points the name's `A` record at its home address and obtains a Let's
// Encrypt certificate by DNS-01, so a phone trusts the address with no
// certificate installed and Google accepts it as an origin.
package certs

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// RenewBefore is how long before expiry a certificate is replaced.
const RenewBefore = 30 * 24 * time.Hour

// Records is the part of deSEC the certificate needs: the name's `A`
// record and its challenge records.
type Records interface {
	SetA(ctx context.Context, token, domain, ip string) error
	SetTXT(ctx context.Context, token, domain, subname, value string) error
	DeleteTXT(ctx context.Context, token, domain, subname string) error
}

// Source prepares and renews the certificate for the linked name.
type Source struct {
	Dir           Dir
	ACMEDirectory string
	Records       Records
	// Propagated returns once deSEC's name servers answer fqdn with value.
	Propagated func(ctx context.Context, fqdn, value string, report func(done, total int, timed bool)) error
	// Settle is the issuer's wait after Propagated.
	Settle time.Duration
	// Log may be nil.
	Log  *slog.Logger
	HTTP *http.Client
	Now  func() time.Time

	// owed is set while the last address write failed; WriteAddress clears
	// it once the record is written.
	mu   sync.Mutex
	owed bool
	// terms is the last agreement read from termsFrom, at termsRead.
	terms     string
	termsFrom string
	termsRead time.Time
}

// termsFresh is how long Terms answers from memory. The authority changes
// its agreement a few times in ten years; Obtain reads the directory itself
// on every request, so an old answer here never lets a request through.
const termsFresh = time.Hour

func (s *Source) directory(cfg domain.LAN) string {
	if cfg.ACMEDirectory != "" {
		return cfg.ACMEDirectory
	}
	return s.ACMEDirectory
}

// Terms answers the address of the agreement the authority has in force for
// cfg, or "" when it names none. It registers nothing with the authority.
func (s *Source) Terms(ctx context.Context, cfg domain.LAN) (string, error) {
	directory := s.directory(cfg)
	s.mu.Lock()
	terms, fresh := s.terms, s.termsFrom == directory && s.now().Sub(s.termsRead) < termsFresh
	s.mu.Unlock()
	if fresh {
		return terms, nil
	}
	terms, err := currentTerms(ctx, directory, s.HTTP)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.terms, s.termsFrom, s.termsRead = terms, directory, s.now()
	s.mu.Unlock()
	return terms, nil
}

func (s *Source) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Prepare answers a certificate for cfg's name. It first points the name's
// `A` record at the chosen address, then reuses the stored certificate
// while more than RenewBefore remains, and obtains a new one otherwise,
// telling report how far it has come.
//
// A stored certificate that is still valid keeps the start from depending
// on deSEC and Let's Encrypt answering: when the address record cannot be
// written, or a renewal inside RenewBefore fails, the failure is logged and
// the stored certificate is used. The listener's renewal check tries the
// certificate again, and WriteAddress the address record.
func (s *Source) Prepare(ctx context.Context, cfg domain.LAN, report func(domain.Progress)) (*tls.Certificate, domain.CertInfo, error) {
	host := cfg.Hostname()
	if host == "" {
		return nil, domain.CertInfo{}, errors.New("the home network has no name yet")
	}
	addressErr := s.Records.SetA(ctx, cfg.DeSEC.Token, host, cfg.Address)
	s.mu.Lock()
	s.owed = addressErr != nil
	s.mu.Unlock()
	cert, info, storedErr := s.stored(host)
	usable := storedErr == nil
	if addressErr != nil {
		if !usable {
			return nil, domain.CertInfo{}, fmt.Errorf("the address record could not be written: %w", addressErr)
		}
		s.log().Warn("The address record could not be written. The stored certificate serves.", "error", addressErr)
	}
	if usable && s.now().Add(RenewBefore).Before(info.NotAfter) {
		s.log().Info("The stored certificate is still valid.", "until", info.NotAfter.Format(time.DateOnly))
		return cert, info, nil
	}
	fresh, freshInfo, err := s.obtain(ctx, cfg, report)
	if err != nil && usable {
		s.log().Warn("The certificate could not be renewed. The stored one serves.", "until", info.NotAfter.Format(time.DateOnly), "error", err)
		return cert, info, nil
	}
	return fresh, freshInfo, err
}

func (s *Source) log() *slog.Logger {
	if s.Log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return s.Log
}

// Forget removes the stored certificate, its key and the `ACME` account
// key; the next Prepare obtains a new certificate with a new account.
func (s *Source) Forget() error { return s.Dir.Forget() }

// Renew answers a replacement certificate when the current one is due, and
// nil when it is not.
func (s *Source) Renew(ctx context.Context, cfg domain.LAN, current domain.CertInfo) (*tls.Certificate, domain.CertInfo, error) {
	if s.now().Add(RenewBefore).Before(current.NotAfter) {
		return nil, current, nil
	}
	return s.obtain(ctx, cfg, nil)
}

// WriteAddress writes the name's `A` record when Prepare could not, so a
// start that served the stored certificate while deSEC was unreachable
// still points phones at the address chosen.
func (s *Source) WriteAddress(ctx context.Context, cfg domain.LAN) (bool, error) {
	s.mu.Lock()
	owed := s.owed
	s.mu.Unlock()
	if !owed {
		return false, nil
	}
	if err := s.Records.SetA(ctx, cfg.DeSEC.Token, cfg.Hostname(), cfg.Address); err != nil {
		return true, fmt.Errorf("the address record could not be written: %w", err)
	}
	s.mu.Lock()
	s.owed = false
	s.mu.Unlock()
	s.log().Info("The address record is written.")
	return false, nil
}

func (s *Source) stored(hostname string) (*tls.Certificate, domain.CertInfo, error) {
	certPEM, keyPEM, err := s.Dir.Issued()
	if err != nil {
		return nil, domain.CertInfo{}, err
	}
	return Load(certPEM, keyPEM, hostname, s.now())
}

func (s *Source) obtain(ctx context.Context, cfg domain.LAN, report func(domain.Progress)) (*tls.Certificate, domain.CertInfo, error) {
	key, err := s.Dir.AccountKey()
	if err != nil {
		return nil, domain.CertInfo{}, err
	}
	host := cfg.Hostname()
	issuer := &Issuer{
		DirectoryURL:  s.directory(cfg),
		AccountKey:    key,
		AcceptedTerms: cfg.CertTerms,
		HTTP:          s.HTTP,
		DNS:           desecDNS{records: s.Records, token: cfg.DeSEC.Token, domain: host},
		Propagated:    s.Propagated,
		Settle:        s.Settle,
		Log:           s.Log,
		Report:        report,
	}
	certPEM, keyPEM, err := issuer.Obtain(ctx, host)
	if err != nil {
		var refused *TermsError
		if errors.As(err, &refused) {
			// The agreement in force is not the one Terms remembers; the
			// acceptance that follows must read it again.
			s.mu.Lock()
			s.termsFrom = ""
			s.mu.Unlock()
		}
		return nil, domain.CertInfo{}, err
	}
	if err := s.Dir.SaveIssued(certPEM, keyPEM); err != nil {
		return nil, domain.CertInfo{}, err
	}
	cert, info, err := Load(certPEM, keyPEM, host, s.now())
	if err == nil {
		s.log().Info("The certificate is saved.", "issuer", info.Issuer, "until", info.NotAfter.Format(time.DateOnly))
	}
	return cert, info, err
}

// desecDNS writes challenge records inside one deSEC domain.
type desecDNS struct {
	records Records
	token   string
	domain  string
}

func (d desecDNS) SetTXT(ctx context.Context, fqdn, value string) (func(context.Context) error, error) {
	subname, ok := strings.CutSuffix(fqdn, "."+d.domain)
	if !ok {
		return nil, fmt.Errorf("%s is not inside %s", fqdn, d.domain)
	}
	if err := d.records.SetTXT(ctx, d.token, d.domain, subname, value); err != nil {
		return nil, fmt.Errorf("the challenge record could not be written: %w", err)
	}
	return func(ctx context.Context) error { return d.records.DeleteTXT(ctx, d.token, d.domain, subname) }, nil
}
