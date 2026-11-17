// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !devfake

package main

import (
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/certs"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec"
)

// The release build, made without the devfake tag, reaches the real
// services and changes nothing of its own.
func TestTheReleaseBuildUsesTheRealServices(t *testing.T) {
	o, err := parseFlags(nil)
	if err != nil {
		t.Fatal(err)
	}
	if o.desecAPI != desec.API || o.acmeDirectory != certs.LetsEncrypt {
		t.Fatalf("deSEC %s, ACME %s", o.desecAPI, o.acmeDirectory)
	}
	w := o.devWiring
	if w.check != nil || w.certs != nil || w.autostart != nil || w.listen != nil || w.setupPage != nil {
		t.Fatal("the release build set a development hook")
	}
}
