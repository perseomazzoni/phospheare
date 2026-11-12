// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package ports declares what the desktop layer needs from the outside: its
// settings store, the store its secrets are kept in, the home network's name
// and certificate and the operating system's login list.
package ports

import (
	"context"
	"crypto/tls"
	"errors"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// ConfigStore holds the desktop's settings.
type ConfigStore interface {
	// Get answers a copy of the settings.
	Get() domain.Config
	// Update applies change and persists it; the change is kept only when
	// it persists.
	Update(change func(*domain.Config)) error
}

// Vault keeps the desktop's secrets, each under one of domain's Secret*
// names.
type Vault interface {
	// Get answers the secret, or "" when none is kept under name.
	Get(name string) (string, error)
	// Set keeps value under name; "" removes the secret.
	Set(name, value string) error
	// Place answers where the secrets are kept.
	Place() domain.SecretPlace
}

// CertSource prepares and renews the home-network listener's certificate.
type CertSource interface {
	// Prepare tells report, when not nil, how far it has come.
	Prepare(ctx context.Context, cfg domain.LAN, report func(domain.Progress)) (*tls.Certificate, domain.CertInfo, error)
	// Renew answers a nil certificate while current is still good.
	Renew(ctx context.Context, cfg domain.LAN, current domain.CertInfo) (*tls.Certificate, domain.CertInfo, error)
	// WriteAddress points the name at cfg's address again when Prepare
	// could not, and answers whether the record is still unwritten. It asks
	// nothing of deSEC while no write is owed.
	WriteAddress(ctx context.Context, cfg domain.LAN) (owed bool, err error)
	// Terms answers the address of the agreement the certificate authority
	// has in force, or "" when it names none. It registers nothing there.
	Terms(ctx context.Context, cfg domain.LAN) (string, error)
}

// TermsError is a certificate refused because the person has not accepted
// the authority's agreement in force. Nothing was registered or ordered.
// URL is the agreement the authority names, to accept. Visit is a page of
// the authority to act on, when the authority itself asks for a step that
// its named agreement does not settle.
type TermsError struct {
	URL   string
	Visit string
	Err   error
}

func (e *TermsError) Error() string {
	return "Let's Encrypt gives a certificate only once its agreement is accepted."
}

func (e *TermsError) Unwrap() error { return e.Err }

// Address answers the address the person is sent to.
func (e *TermsError) Address() string {
	if e.URL != "" {
		return e.URL
	}
	return e.Visit
}

// NameAccount is the account side of deSEC, which gives the home network its
// free name.
type NameAccount interface {
	// Register asks for an account that owns domain. deSEC then emails the
	// activation link; an address it already knows gets no email.
	Register(ctx context.Context, email, password, domain string) error
	// Login answers a short-lived login token, or ErrNotActivated while the
	// activation link is unused.
	Login(ctx context.Context, email, password string) (string, error)
	// MakeToken uses loginToken to make a token that does not expire and,
	// where deSEC allows it, writes only the records the home network
	// needs on domain. Narrowed reports whether it could be limited so.
	MakeToken(ctx context.Context, loginToken, domain string) (token string, narrowed bool, err error)
	// Logout ends loginToken.
	Logout(ctx context.Context, loginToken string) error
	// Owns answers nil when token manages domain.
	Owns(ctx context.Context, token, domain string) error
}

// ErrNotActivated is Login's answer before the activation link is used.
var ErrNotActivated = errors.New("the deSEC account is not activated yet")

// Refusal is a request declined before or by deSEC. Field names what the
// person should change, "email", "name", "token" or "accepted", or is
// empty when it is none.
type Refusal struct {
	Field   string
	Message string
}

func (r *Refusal) Error() string { return r.Message }

// Autostart is the operating system's login list.
type Autostart interface {
	// Enable registers exe to start at login with args, which carry what
	// decides where the running copy runs.
	Enable(exe string, args []string) error
	Disable() error
	Enabled() (bool, error)
}

// IdentityService is the identity service the desktop runs beside itself.
type IdentityService interface {
	// Restart stops the service and starts it again with the saved
	// settings, answering once it is ready. Without a Google client it
	// leaves the service stopped.
	Restart() error
	// SignOutBrowsers replaces every seal key and restarts the service, so
	// no session or Drive connection any browser holds opens again.
	SignOutBrowsers() error
	// ForgetKeys removes the seal keyring and restarts the service, which
	// makes a new one when it next starts with a Google client. No session
	// or Drive connection any browser holds opens again.
	ForgetKeys() error
	// CheckGoogle checks the saved Google client against the redirect URI
	// of every origin.
	CheckGoogle(ctx context.Context) ([]domain.GoogleCheck, error)
}
