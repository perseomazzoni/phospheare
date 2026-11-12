// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package identity is the one package a program imports to run the identity
// service: Google sign-in, the writer session and the sealed Drive
// connections, as the `/identity/` routes of
// `docs/identity-contract.md`. Whoever runs it supplies the Google client,
// the sealer and the listeners; it serves nothing outside `/identity/`.
package identity

import (
	"net/http"

	"github.com/perseomazzoni/phospheare/identity/adapters/httpapi"
	"github.com/perseomazzoni/phospheare/identity/application"
	"github.com/perseomazzoni/phospheare/identity/ports"
)

// Prefix is the path every identity route lives under.
const Prefix = httpapi.Prefix

// Listener describes one origin a handler serves.
type Listener = httpapi.Listener

// Observer watches every request with one log line. Its zero value watches
// nothing.
type Observer = httpapi.Observer

// CallbackPath is where Google returns the browser.
const CallbackPath = httpapi.CallbackPath

// ListenerFor answers the listener of a parsed origin.
var ListenerFor = httpapi.ListenerFor

// Options are what the identity service needs from whoever runs it.
type Options struct {
	ProductName string
	Clients     ports.ClientSource
	Sealer      ports.Sealer
	Google      ports.Google
	// Drive is the Google Drive call of the trial sign-in.
	Drive    ports.Drive
	Observer Observer
}

// Identity is one identity service. It keeps no state of its own
// (`application`).
type Identity struct {
	host *httpapi.Host
}

// New composes the identity service from o.
func New(o Options) *Identity {
	return &Identity{host: &httpapi.Host{
		ProductName: o.ProductName,
		Sealer:      o.Sealer,
		Clients:     o.Clients,
		Observer:    o.Observer,
		OAuth: &application.Service{
			Google:  o.Google,
			Clients: o.Clients,
			Drive:   o.Drive,
		},
	}}
}

// Handler answers the requests of every listener in ls, as
// `httpapi.Host.Handler` does.
func (i *Identity) Handler(ls ...Listener) http.Handler { return i.host.Handler(ls...) }
