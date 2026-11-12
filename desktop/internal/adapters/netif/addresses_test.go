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

func TestPrivateAddressesListsOnlyPrivate(t *testing.T) {
	addrs, err := PrivateAddresses()
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range addrs {
		if !domain.IsPrivate(net.ParseIP(a.IP)) || a.IP == "0.0.0.0" {
			t.Fatalf("listed %v", a)
		}
	}
}

func TestFromThisComputerComparesBothEndsOfTheConnection(t *testing.T) {
	own := func() []net.IP {
		return []net.IP{net.ParseIP("192.168.1.20"), net.ParseIP("172.17.0.1"), net.ParseIP("172.18.0.2")}
	}
	from := func(remote, local string) bool { return fromComputer(remote, local, own) }
	if !from("127.0.0.1:5000", "192.168.1.20:8443") || !from("[::1]:5000", "[::1]:8443") {
		t.Fatal("loopback is this computer")
	}
	if !from("192.168.1.20:5000", "192.168.1.20:8443") {
		t.Fatal("a visit to this computer's own address is this computer")
	}
	if !from("172.18.0.2:5000", "172.17.0.1:8443") {
		t.Fatal("a visit whose source NAT rewrote to another own address is this computer")
	}
	if from("192.168.1.31:5000", "192.168.1.20:8443") || from("nonsense", "nonsense") ||
		from("192.168.1.31:5000", "") {
		t.Fatal("another device is this computer")
	}
}

func TestFromThisComputerReadsTheAddressesOnlyWhenNeeded(t *testing.T) {
	read := 0
	own := func() []net.IP { read++; return nil }
	fromComputer("127.0.0.1:5000", "192.168.1.20:8443", own)
	fromComputer("192.168.1.20:5000", "192.168.1.20:8443", own)
	if read != 0 {
		t.Fatalf("read the addresses %d times for loopback and the same address", read)
	}
	if fromComputer("192.168.1.31:5000", "192.168.1.20:8443", own) || read != 1 {
		t.Fatal("another address is checked against the computer's own")
	}
}

// A real connection from this computer to each of its own addresses is this
// computer's, also where a NAT rule rewrites its source (a Docker bridge).
func TestFromThisComputerKnowsAConnectionToItsOwnAddress(t *testing.T) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range addrs {
		n, ok := a.(*net.IPNet)
		if !ok || n.IP.IsLoopback() || n.IP.To4() == nil {
			continue
		}
		ln, err := net.Listen("tcp", net.JoinHostPort(n.IP.String(), "0"))
		if err != nil {
			continue
		}
		accepted := make(chan net.Conn, 1)
		go func() {
			c, _ := ln.Accept()
			accepted <- c
		}()
		out, err := net.Dial("tcp", ln.Addr().String())
		if err != nil {
			ln.Close()
			t.Fatal(err)
		}
		in := <-accepted
		ok = in != nil && FromThisComputer(in.RemoteAddr().String(), in.LocalAddr().String())
		out.Close()
		if in != nil {
			in.Close()
		}
		ln.Close()
		if !ok {
			t.Fatalf("a connection to %s is not this computer's", n.IP)
		}
	}
}
