// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package netif lists this computer's home-network addresses.
package netif

import (
	"net"
	"sort"

	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// FromThisComputer reports whether a connection from remoteAddr to
// localAddr, each a "host:port", comes from this computer: a loopback
// address, the address the connection reached, or another address of this
// computer. A NAT rule can rewrite the source of a connection the computer
// opens to one of its own addresses (Docker masquerades the traffic of its
// bridge), so the source can be any of the computer's addresses. Another
// device cannot complete a TCP handshake from an address of this computer,
// because the replies go to this computer.
func FromThisComputer(remoteAddr, localAddr string) bool {
	return fromComputer(remoteAddr, localAddr, ownAddresses)
}

// fromComputer is FromThisComputer with the computer's addresses read by
// own, which runs only when the address checks fail.
func fromComputer(remoteAddr, localAddr string, own func() []net.IP) bool {
	remote := ipOf(remoteAddr)
	if remote == nil {
		return false
	}
	if remote.IsLoopback() || remote.Equal(ipOf(localAddr)) {
		return true
	}
	for _, ip := range own() {
		if remote.Equal(ip) {
			return true
		}
	}
	return false
}

// ownAddresses lists the addresses of this computer's interfaces, none when
// they cannot be read.
func ownAddresses() []net.IP {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	out := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok {
			out = append(out, n.IP)
		}
	}
	return out
}

// ipOf answers the IP of a "host:port" or a bare address, nil for neither.
func ipOf(addr string) net.IP {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	return net.ParseIP(host)
}

// PrivateAddresses lists the RFC 1918 IPv4 addresses of the interfaces that
// are up, skipping loopback.
func PrivateAddresses() ([]domain.Address, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var out []domain.Address
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := ifc.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			n, ok := a.(*net.IPNet)
			if ok && domain.IsPrivate(n.IP) {
				out = append(out, domain.Address{IP: n.IP.To4().String(), Interface: ifc.Name})
			}
		}
	}
	preferred := outboundIP()
	for i := range out {
		out[i].Preferred = out[i].IP == preferred
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Preferred != out[j].Preferred {
			return out[i].Preferred
		}
		return out[i].IP < out[j].IP
	})
	return out, nil
}

// outboundIP answers the local address of the default route. Connecting a
// UDP socket selects a route and sends nothing.
func outboundIP() string {
	conn, err := net.Dial("udp4", "192.0.2.1:9")
	if err != nil {
		return ""
	}
	defer conn.Close()
	if a, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return a.IP.String()
	}
	return ""
}
