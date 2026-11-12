// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package main

import (
	"testing"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/tray"
	"github.com/perseomazzoni/phospheare/desktop/internal/application"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

func TestNetworkOfFollowsTheManagerAndTheSettings(t *testing.T) {
	google := domain.Google{ClientID: "id", ClientSecret: "secret"}
	set := domain.Config{Google: google, LAN: domain.LAN{Port: 8443, Address: "192.168.1.7", DeSEC: domain.DeSEC{Name: "rossi", Token: "t"}, CertTerms: "https://example.test/terms"}}
	noGoogle := domain.Config{LAN: set.LAN}
	for _, c := range []struct {
		name   string
		cfg    domain.Config
		status application.Status
		want   tray.Network
	}{
		{"not set up", domain.Config{Google: google}, application.Status{State: application.StateOff}, tray.Network{State: tray.NetworkUnset}},
		{"no Google", noGoogle, application.Status{State: application.StateOff}, tray.Network{State: tray.NetworkUnset}},
		{"off", set, application.Status{State: application.StateOff}, tray.Network{State: tray.NetworkOff}},
		{"starting", set, application.Status{State: application.StateStarting}, tray.Network{State: tray.NetworkStarting}},
		{"on", set, application.Status{State: application.StateRunning, URL: "https://rossi.dedyn.io:8443"},
			tray.Network{State: tray.NetworkOn, URL: "https://rossi.dedyn.io:8443"}},
		{"failed", set, application.Status{State: application.StateError}, tray.Network{State: tray.NetworkFailed}},
		{"no agreement accepted", domain.Config{Google: google, LAN: domain.LAN{Port: 8443, Address: "192.168.1.7", DeSEC: set.LAN.DeSEC}},
			application.Status{State: application.StateOff}, tray.Network{State: tray.NetworkUnset}},
		{"on, agreement replaced", set, application.Status{State: application.StateRunning, URL: "https://rossi.dedyn.io:8443", Terms: "https://example.test/terms-2"},
			tray.Network{State: tray.NetworkOn, URL: "https://rossi.dedyn.io:8443", Asks: true}},
		{"refused for the agreement", set, application.Status{State: application.StateError, Terms: "https://example.test/terms-2"},
			tray.Network{State: tray.NetworkFailed, Asks: true}},
	} {
		if got := networkOf(c.cfg, c.status); got != c.want {
			t.Errorf("%s: %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestParseFlagsReadsNoTray(t *testing.T) {
	o, err := parseFlags([]string{"--no-tray"})
	if err != nil || !o.noTray {
		t.Fatalf("%+v %v", o, err)
	}
	if o, _ := parseFlags(nil); o.noTray {
		t.Fatal("the tray is off without --no-tray")
	}
}
