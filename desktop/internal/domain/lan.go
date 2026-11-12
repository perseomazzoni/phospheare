// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"errors"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// Address is a private IPv4 address of an interface that is up.
type Address struct {
	IP        string `json:"ip"`
	Interface string `json:"interface"`
	// Preferred marks the address the computer uses to reach the internet,
	// which is the home network rather than a virtual adapter.
	Preferred bool `json:"preferred"`
}

// CertInfo describes the certificate in use.
type CertInfo struct {
	NotAfter time.Time `json:"notAfter"`
	Issuer   string    `json:"issuer"`
	Names    []string  `json:"names"`
}

// PortUse is whether the home network can open a port now.
type PortUse string

const (
	PortFree PortUse = "free"
	// PortInUse is a port another program holds.
	PortInUse PortUse = "in-use"
	// PortNotAllowed is a port the system keeps for programs with special
	// permission, as Linux does below 1024.
	PortNotAllowed PortUse = "not-allowed"
)

// PortCheck is one port and whether it can be opened now.
type PortCheck struct {
	Port int     `json:"port"`
	Use  PortUse `json:"use"`
}

// portsTried is how many ports after FallbackLANPort PickPort tries.
const portsTried = 100

// PickPort answers the first port use finds free: DefaultLANPort, then
// FallbackLANPort, then the ones after it. It answers 0 when none is.
func PickPort(use func(port int) PortUse) int {
	if use(DefaultLANPort) == PortFree {
		return DefaultLANPort
	}
	for p := FallbackLANPort; p <= FallbackLANPort+portsTried; p++ {
		if use(p) == PortFree {
			return p
		}
	}
	return 0
}

// Stages of turning the home network on, in order.
const (
	// StagePublish is deSEC publishing the record that proves the name is
	// this computer's.
	StagePublish = "publish"
	// StageCheck is Let's Encrypt checking that record and issuing the
	// certificate.
	StageCheck = "check"
)

// Progress is how far turning the home network on has come.
type Progress struct {
	Stage string `json:"stage"`
	// Done of Total counts deSEC's servers that show the record or, when
	// Timed, the seconds of a fixed wait: a network that answers name
	// lookups itself hides deSEC's servers.
	Done  int  `json:"done"`
	Total int  `json:"total"`
	Timed bool `json:"timed,omitempty"`
	// Again marks the second try, after Let's Encrypt could not see the
	// record from every place it checks from.
	Again bool `json:"again,omitempty"`
}

var private = func() []*net.IPNet {
	var out []*net.IPNet
	for _, c := range []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"} {
		_, n, _ := net.ParseCIDR(c)
		out = append(out, n)
	}
	return out
}()

// IsPrivate reports an RFC 1918 IPv4 address.
func IsPrivate(ip net.IP) bool {
	v4 := ip.To4()
	if v4 == nil {
		return false
	}
	for _, n := range private {
		if n.Contains(v4) {
			return true
		}
	}
	return false
}

// LoopbackHost answers the `Host` header a browser sends to host on the
// loopback listener's port: without the port when it is 80, as browsers and
// the identity service write the origin.
func LoopbackHost(host string, port int) string {
	if port == 80 {
		return host
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

// LoopbackOrigin answers the loopback listener's browser origin on port.
func LoopbackOrigin(port int) string { return "http://" + LoopbackHost("localhost", port) }

// Origin answers the listener's browser origin for hostname and port.
func Origin(hostname string, port int) string {
	if port == 443 {
		return "https://" + hostname
	}
	return "https://" + hostname + ":" + strconv.Itoa(port)
}

// HostHeader answers the `Host` header a browser sends to hostname and port.
func HostHeader(hostname string, port int) string {
	if port == 443 {
		return hostname
	}
	return net.JoinHostPort(hostname, strconv.Itoa(port))
}

// Validate checks that c can start the home-network listener. Phones sign
// in there with Google, so the listener waits for a Google client.
func Validate(c Config) error {
	if !c.Google.Configured() {
		return errors.New("Set up Google sign-in first.")
	}
	cfg := c.LAN
	if !cfg.DeSEC.Linked() {
		return errors.New("Create the home network's name first.")
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return errors.New("The port must be between 1 and 65535.")
	}
	ip := net.ParseIP(cfg.Address)
	if ip == nil || ip.To4() == nil || !IsPrivate(ip) {
		return errors.New("Choose this computer's home-network address.")
	}
	// Only that an agreement was accepted is checked here; the certificate
	// source checks that it is the one in force.
	if cfg.CertTerms == "" {
		return ErrNoCertTerms
	}
	return nil
}

// ErrNoCertTerms is Validate's refusal while no agreement of the
// certificate authority is accepted.
var ErrNoCertTerms = errors.New("Accept the Let's Encrypt agreement first.")

// TermsAddress reports whether s is an address the setup page may show as a
// link to an agreement: an absolute `https` address with a host, no longer
// than termsAddressMax. The address comes from the certificate authority's
// server, and is kept in the settings and answered at every poll.
func TermsAddress(s string) bool {
	if len(s) > termsAddressMax {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.User == nil
}

const termsAddressMax = 2000

// NameLabel answers the label of a name typed as `oncedarkstudio` or as
// `oncedarkstudio.dedyn.io`, in lower case, and whether it is one deSEC
// accepts: letters, digits and hyphens, 1 to 63 of them, with no hyphen at
// either end.
func NameLabel(typed string) (string, bool) {
	l := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(typed)), "."+NameZone)
	if len(l) == 0 || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
		return l, false
	}
	for _, c := range l {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return l, false
		}
	}
	return l, true
}

// ValidEmail reports an address with one `@` between two non-empty parts
// and no spaces. deSEC checks the rest by sending the activation email.
func ValidEmail(e string) bool {
	at := strings.IndexByte(e, '@')
	return len(e) <= 254 && at > 0 && at == strings.LastIndexByte(e, '@') && at < len(e)-1 && !strings.ContainsFunc(e, unicode.IsSpace)
}

// passwordLetters leaves out the characters that read alike: `0`, `1`,
// `l` and `o`. Its 32 letters divide 256, so every byte maps evenly.
const passwordLetters = "abcdefghijkmnpqrstuvwxyz23456789"

// NewPassword answers a deSEC account password of 20 letters from
// passwordLetters, about 100 bits, written in four groups of five so it is
// easy to copy by hand.
func NewPassword(random io.Reader) (string, error) {
	raw := make([]byte, 20)
	if _, err := io.ReadFull(random, raw); err != nil {
		return "", err
	}
	var b strings.Builder
	for i, r := range raw {
		if i > 0 && i%5 == 0 {
			b.WriteByte('-')
		}
		b.WriteByte(passwordLetters[int(r)%len(passwordLetters)])
	}
	return b.String(), nil
}
