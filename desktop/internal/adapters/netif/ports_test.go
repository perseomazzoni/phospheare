// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package netif

import (
	"net"
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

func TestPortUseTellsAHeldPortFromAFreeOne(t *testing.T) {
	ln, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if got := PortUse(port); got != domain.PortInUse {
		t.Fatalf("held port: %s", got)
	}
	ln.Close()
	if got := PortUse(port); got != domain.PortFree {
		t.Fatalf("released port: %s", got)
	}
}
