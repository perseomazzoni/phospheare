// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Origin is one browser origin the service answers. Google registers
// redirect URIs by origin and the browser keeps the SPA's storage by origin,
// so each is one exact string: scheme, host and a port only when it is not
// the scheme's default.
type Origin struct {
	// URL is the origin as the browser writes it, with no trailing slash.
	URL string
	// Host is the `Host` header that names it.
	Host string
	// Secure is true on HTTPS, where every cookie is `Secure`.
	Secure bool
	// Loopback is true for an origin on the computer itself, which only its
	// own browsers reach.
	Loopback bool
}

// ParseOrigin reads one origin. Plain HTTP is accepted only for a loopback
// host, since cookies there cannot be `Secure`.
func ParseOrigin(raw string) (Origin, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return Origin{}, fmt.Errorf("%q is not an origin (scheme://host[:port])", raw)
	}
	host := strings.ToLower(u.Host)
	switch u.Scheme {
	case "https":
		host = strings.TrimSuffix(host, ":443")
	case "http":
		host = strings.TrimSuffix(host, ":80")
		if !loopback(u.Hostname()) {
			return Origin{}, fmt.Errorf("%q: plain HTTP is accepted only for localhost", raw)
		}
	default:
		return Origin{}, fmt.Errorf("%q: the scheme must be https or http", raw)
	}
	return Origin{URL: u.Scheme + "://" + host, Host: host, Secure: u.Scheme == "https", Loopback: loopback(u.Hostname())}, nil
}

// ParseOrigins reads a comma-separated list of distinct origins.
func ParseOrigins(list string) ([]Origin, error) {
	var out []Origin
	seen := map[string]bool{}
	for _, raw := range strings.Split(list, ",") {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		o, err := ParseOrigin(raw)
		if err != nil {
			return nil, err
		}
		if seen[o.Host] {
			return nil, fmt.Errorf("%q is listed twice", o.URL)
		}
		seen[o.Host] = true
		out = append(out, o)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no origin is listed")
	}
	return out, nil
}

func loopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
