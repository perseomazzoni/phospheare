// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package domain holds the desktop layer's rules: its settings, what a
// home-network listener may be configured with, and how release versions
// compare. It does no I/O.
package domain

import "time"

const (
	// DefaultPort is the loopback port. The browser keeps the SPA's data per
	// origin, so changing it hides what was stored under the old address.
	DefaultPort = 47821
	// DefaultLANPort is the home-network HTTPS port: the address needs no
	// number on it.
	DefaultLANPort = 443
	// FallbackLANPort is the home-network port when DefaultLANPort cannot be
	// opened; the address then carries it.
	FallbackLANPort = 30483

	// NameZone is the deSEC zone a home network's free name sits under.
	NameZone = "dedyn.io"
)

// Google is the Web-application OAuth client. ClientSecret is a vault
// secret (Config.Secrets).
type Google struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"-"`
}

// Configured reports whether both halves of the client are present.
func (g Google) Configured() bool {
	return g.ClientID != "" && g.ClientSecret != ""
}

// DeSEC is the home network's free name at deSEC. Name is the label in
// front of NameZone. While the account waits for its activation link,
// PendingPassword holds the account's password and Requested the time the
// link was asked for; both are cleared once Token exists. Token and
// PendingPassword are vault secrets (Config.Secrets).
type DeSEC struct {
	Name            string    `json:"name,omitempty"`
	Email           string    `json:"email,omitempty"`
	Token           string    `json:"-"`
	PendingPassword string    `json:"-"`
	Requested       time.Time `json:"requested,omitzero"`
}

// Linked reports a name with a token that writes its records.
func (d DeSEC) Linked() bool { return d.Name != "" && d.Token != "" }

// Waiting reports an account that waits for its activation link.
func (d DeSEC) Waiting() bool { return d.Name != "" && d.Token == "" && d.PendingPassword != "" }

// Domain answers the full name, or "" when no name is chosen.
func (d DeSEC) Domain() string {
	if d.Name == "" {
		return ""
	}
	return d.Name + "." + NameZone
}

// LAN is the home-network listener's configuration. Its running state is
// not stored; AutoStart only decides whether it starts with the process.
// CertTerms is the address of the certificate authority's agreement the
// person accepted, or NoCertTerms; no certificate is asked for under any
// other agreement.
type LAN struct {
	Port          int    `json:"port"`
	Address       string `json:"address"`
	DeSEC         DeSEC  `json:"desec"`
	AutoStart     bool   `json:"autoStart"`
	ACMEDirectory string `json:"acmeDirectory,omitempty"`
	CertTerms     string `json:"certTerms,omitempty"`
}

// NoCertTerms is LAN.CertTerms once the person turned the home network on
// with a certificate authority that names no agreement.
const NoCertTerms = "none"

// Hostname answers the listener's name once it is linked, and "" before.
func (l LAN) Hostname() string {
	if !l.DeSEC.Linked() {
		return ""
	}
	return l.DeSEC.Domain()
}

// Config is the whole of the desktop's settings.
type Config struct {
	Google       Google `json:"google"`
	Port         int    `json:"port"`
	LAN          LAN    `json:"lan"`
	StartAtLogin bool   `json:"startAtLogin"`
	// Language is the setup page's and the tray menu's language, one of
	// Languages; empty follows the system's.
	Language string `json:"language,omitempty"`
	// Secrets is where the vault secrets, the Google client secret, the deSEC
	// token and the pending password, are kept, chosen at the first start.
	// They never reach `config.json`; `configfile` keeps them apart.
	Secrets SecretPlace `json:"secrets,omitempty"`
}

// Defaults answers the configuration of a first run.
func Defaults() Config {
	return Config{
		Port: DefaultPort,
		LAN:  LAN{Port: DefaultLANPort},
	}
}

// Normalize fills the fields a stored configuration may leave empty.
func Normalize(c *Config) {
	if c.Port == 0 {
		c.Port = DefaultPort
	}
	if c.LAN.Port == 0 {
		c.LAN.Port = DefaultLANPort
	}
}

// CallbackPath is where Google returns the browser on every origin; each
// origin's redirect URI is the origin followed by it.
const CallbackPath = "/identity/google/callback"

// Origins answers the browser origins the identity service answers: base
// (the loopback origin, or the development one), and the home-network origin
// once its name is linked, whether or not that listener runs now.
func Origins(c Config, base string) []string {
	out := []string{base}
	if h := c.LAN.Hostname(); h != "" {
		out = append(out, Origin(h, c.LAN.Port))
	}
	return out
}

// GoogleCheck is what checking the Google client found for one redirect URI.
type GoogleCheck struct {
	RedirectURI string `json:"redirectUri"`
	// Result is ok, wrong-credentials, redirect-mismatch, unreachable or
	// unexpected.
	Result string `json:"result"`
	Detail string `json:"detail,omitempty"`
}
