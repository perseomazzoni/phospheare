// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"crypto/rand"
	"net"
	"strings"
	"testing"
)

func TestNameLabel(t *testing.T) {
	for typed, want := range map[string]string{
		"rossi-studio": "rossi-studio", " Rossi-Studio.dedyn.io ": "rossi-studio", "a1": "a1",
		"": "", "-bad": "", "bad-": "", "bad_name": "", "two.labels": "", "café": "", strings.Repeat("a", 64): "",
	} {
		l, ok := NameLabel(typed)
		if ok != (want != "") || ok && l != want {
			t.Fatalf("%q: got %q %v, want %q", typed, l, ok, want)
		}
	}
}

func TestValidEmail(t *testing.T) {
	for e, ok := range map[string]bool{
		"name@example.com": true, "a@b": true,
		"": false, "@example.com": false, "name@": false, "a@b@c": false, "na me@example.com": false,
	} {
		if ValidEmail(e) != ok {
			t.Fatalf("%q: want %v", e, ok)
		}
	}
}

func TestNewPassword(t *testing.T) {
	p, err := NewPassword(rand.Reader)
	if err != nil || len(p) != 23 || strings.Count(p, "-") != 3 {
		t.Fatalf("%q %v", p, err)
	}
	for _, c := range strings.ReplaceAll(p, "-", "") {
		if !strings.ContainsRune(passwordLetters, c) {
			t.Fatalf("%q holds %q", p, c)
		}
	}
	if _, err := NewPassword(strings.NewReader("short")); err == nil {
		t.Fatal("a short source must fail")
	}
}

func TestValidateNeedsALinkedName(t *testing.T) {
	c := Config{Google: Google{ClientID: "id", ClientSecret: "secret"}}
	c.LAN = LAN{Port: 47843, Address: "192.168.1.20", DeSEC: DeSEC{Name: "rossi-studio", PendingPassword: "p"}, CertTerms: "https://example.test/terms"}
	if Validate(c) == nil || c.LAN.Hostname() != "" {
		t.Fatal("a waiting name must not start")
	}
	c.LAN.DeSEC = DeSEC{Name: "rossi-studio", Token: "t"}
	if err := Validate(c); err != nil || c.LAN.Hostname() != "rossi-studio.dedyn.io" {
		t.Fatalf("%v %q", err, c.LAN.Hostname())
	}
	c.LAN.Address = "8.8.8.8"
	if Validate(c) == nil {
		t.Fatal("a public address must not start")
	}
}

func TestValidateNeedsGoogle(t *testing.T) {
	c := Config{LAN: LAN{Port: 47843, Address: "192.168.1.20", DeSEC: DeSEC{Name: "rossi-studio", Token: "t"}}}
	if err := Validate(c); err == nil || err.Error() != "Set up Google sign-in first." {
		t.Fatalf("a home network without Google: %v", err)
	}
}

func TestOriginsAddTheLinkedName(t *testing.T) {
	c := Defaults()
	if got := Origins(c, "http://localhost:47821"); len(got) != 1 {
		t.Fatal(got)
	}
	c.LAN.DeSEC = DeSEC{Name: "rossi-studio", Token: "t"}
	if got := Origins(c, "http://localhost:47821"); len(got) != 2 || got[1] != "https://rossi-studio.dedyn.io" {
		t.Fatal(got)
	}
}

func TestIsPrivate(t *testing.T) {
	for ip, ok := range map[string]bool{
		"10.0.0.5": true, "172.16.0.1": true, "172.31.255.255": true, "192.168.1.20": true,
		"172.32.0.1": false, "8.8.8.8": false, "127.0.0.1": false, "fd00::1": false, "0.0.0.0": false,
	} {
		if IsPrivate(net.ParseIP(ip)) != ok {
			t.Fatalf("%s: want %v", ip, ok)
		}
	}
}

func TestOrigin(t *testing.T) {
	if Origin("studio.example.com", 443) != "https://studio.example.com" || Origin("studio.example.com", 47843) != "https://studio.example.com:47843" {
		t.Fatal("origin")
	}
}

func TestPickPortPrefersTheAddressWithoutANumber(t *testing.T) {
	busy := map[int]PortUse{}
	use := func(p int) PortUse {
		if u, ok := busy[p]; ok {
			return u
		}
		return PortFree
	}
	if got := PickPort(use); got != DefaultLANPort {
		t.Fatalf("all free: %d", got)
	}
	busy[DefaultLANPort] = PortNotAllowed
	if got := PickPort(use); got != FallbackLANPort {
		t.Fatalf("443 not allowed: %d", got)
	}
	busy[FallbackLANPort], busy[FallbackLANPort+1] = PortInUse, PortInUse
	if got := PickPort(use); got != FallbackLANPort+2 {
		t.Fatalf("both held: %d", got)
	}
	if got := PickPort(func(int) PortUse { return PortInUse }); got != 0 {
		t.Fatalf("none free: %d", got)
	}
}

// On port 80 the loopback origin and Host carry no port, as browsers send
// them and the identity service writes them.
func TestLoopbackOriginLeavesOutPort80(t *testing.T) {
	if got := LoopbackOrigin(80); got != "http://localhost" {
		t.Fatalf("port 80: %q", got)
	}
	if got := LoopbackOrigin(47821); got != "http://localhost:47821" {
		t.Fatalf("port 47821: %q", got)
	}
	if LoopbackHost("127.0.0.1", 80) != "127.0.0.1" || LoopbackHost("localhost", 8080) != "localhost:8080" {
		t.Fatal("hosts")
	}
}

// The listener waits for an accepted agreement, whatever its address.
func TestValidateNeedsAnAcceptedAgreement(t *testing.T) {
	c := Config{
		Google: Google{ClientID: "id", ClientSecret: "secret"},
		LAN:    LAN{Port: 47843, Address: "192.168.1.20", DeSEC: DeSEC{Name: "rossi", Token: "t"}},
	}
	if err := Validate(c); err == nil || err.Error() != "Accept the Let's Encrypt agreement first." {
		t.Fatalf("without an agreement: %v", err)
	}
	c.LAN.CertTerms = "https://example.test/terms"
	if err := Validate(c); err != nil {
		t.Fatal(err)
	}
}

func TestTermsAddressIsAnHTTPSAddressWithAHost(t *testing.T) {
	for address, want := range map[string]bool{
		"https://letsencrypt.org/documents/LE-SA-v1.8.pdf":  true,
		"http://letsencrypt.org/terms":                      false,
		"javascript:alert(1)":                               false,
		"https://user@letsencrypt.org/terms":                false,
		"https:///terms":                                    false,
		"/terms":                                            false,
		"https://example.test/" + strings.Repeat("a", 2000): false,
		"": false,
	} {
		if got := TermsAddress(address); got != want {
			t.Errorf("%q: %v, want %v", address, got, want)
		}
	}
}
