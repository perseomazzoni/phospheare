// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package desec

import (
	"context"
	"errors"
	"net"
	"slices"
	"sync"
	"time"
)

// NameServers are deSEC's servers one by one. `ns1.desec.io` and
// `ns2.desec.org` each stand for several of them around the world, and an
// authority checking a record from several places reaches different ones;
// they take a change at different moments, some minutes after the others.
// Asking each by its own name finds the slowest. The list is the one deSEC's
// forum gives (talk.desec.io, topic 1790); a server missing from it is a
// server Wait cannot wait for.
var NameServers = []string{
	"ams-1.a.desec.io:53", "dfw-1.a.desec.io:53", "fra-1.a.desec.io:53", "hkg-1.a.desec.io:53",
	"jnb-1.a.desec.io:53", "sao-1.a.desec.io:53", "syd-1.a.desec.io:53",
	"dxb-1.c.desec.io:53", "fra-1.c.desec.io:53", "lax-1.c.desec.io:53", "lga-1.c.desec.io:53",
	"lhr-1.c.desec.io:53", "scl-1.c.desec.io:53", "sin-1.c.desec.io:53", "tyo-1.c.desec.io:53",
}

// Servers asks name servers directly, so it sees a new record as soon as
// each one publishes it, before any resolver's cache does. Some networks
// answer every name lookup themselves, whatever server it is sent to, and
// keep an answer that the record does not exist; others let no lookup out.
// On those Wait cannot see deSEC's servers, and waits Fallback instead.
type Servers struct {
	Addrs []string
	// Interval is the polling period of Wait; Timeout bounds it.
	Interval time.Duration
	Timeout  time.Duration
	// Steady is how many rounds in a row must find the record.
	Steady int
	// Probe is an address where no name server runs; an answer from it is
	// the network answering in its place.
	Probe string
	// Fallback is the wait when deSEC's servers cannot be asked: longer
	// than the few minutes deSEC's servers take to share a change.
	Fallback time.Duration
}

// LookupTXT answers the `TXT` values addr gives for fqdn.
func LookupTXT(ctx context.Context, addr, fqdn string) ([]string, error) {
	r := &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, addr)
		},
	}
	return r.LookupTXT(ctx, fqdn+".")
}

// Wait returns once every server that answers has answered fqdn with
// value, for Steady rounds in a row, or once Fallback has passed when the
// servers cannot be asked. A server that does not answer at all is left out
// of a round: the authority cannot reach it either. report, when not nil,
// hears how many servers show the record, or how many seconds of the
// fallback have passed when timed.
func (s Servers) Wait(ctx context.Context, fqdn, value string, report func(done, total int, timed bool)) error {
	timeout, interval, steady := s.Timeout, s.Interval, s.Steady
	if timeout == 0 {
		timeout = 5 * time.Minute
	}
	if interval == 0 {
		interval = 5 * time.Second
	}
	if steady == 0 {
		steady = 2
	}
	if report == nil {
		report = func(int, int, bool) {}
	}
	if s.intercepted(ctx) {
		return s.fallback(ctx, report)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	timedOut := errors.New("deSEC took longer than usual to publish the record that proves the name is yours. Try again in a few minutes.")
	for seen, round := 0, 0; ; round++ {
		have, answered := s.count(ctx, fqdn, value)
		// A round the deadline cut short counts servers as silent that
		// were only interrupted, so it is not reported.
		if ctx.Err() != nil && round > 0 {
			return timedOut
		}
		if answered == 0 && round == 0 {
			return s.fallback(ctx, report)
		}
		report(have, len(s.Addrs), false)
		if answered > 0 && have == answered {
			seen++
		} else {
			seen = 0
		}
		if seen >= steady {
			return nil
		}
		select {
		case <-ctx.Done():
			return timedOut
		case <-time.After(interval):
		}
	}
}

// intercepted reports whether something answers at Probe.
func (s Servers) intercepted(ctx context.Context) bool {
	probe := s.Probe
	if probe == "" {
		// 192.0.2.1 is reserved for documentation (RFC 5737): nothing on
		// the internet answers there.
		probe = "192.0.2.1:53"
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err := LookupTXT(ctx, probe, "example.com")
	var dnsErr *net.DNSError
	return err == nil || errors.As(err, &dnsErr) && dnsErr.IsNotFound
}

// fallback waits Fallback, reporting each second.
func (s Servers) fallback(ctx context.Context, report func(done, total int, timed bool)) error {
	total := s.Fallback
	if total == 0 {
		total = 3 * time.Minute
	}
	secs := int(total / time.Second)
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for done := 0; done < secs; done++ {
		report(done, secs, true)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
		}
	}
	report(secs, secs, true)
	return nil
}

// count answers how many servers show value for fqdn, and how many
// answered at all. The servers are asked together, each for at most a few
// seconds, so a silent one does not hold up the others.
func (s Servers) count(ctx context.Context, fqdn, value string) (have, answered int) {
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, addr := range s.Addrs {
		wg.Go(func() {
			ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			values, err := LookupTXT(ctx, addr, fqdn)
			var dnsErr *net.DNSError
			if err != nil && !(errors.As(err, &dnsErr) && dnsErr.IsNotFound) {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			answered++
			if slices.Contains(values, value) {
				have++
			}
		})
	}
	wg.Wait()
	return have, answered
}
