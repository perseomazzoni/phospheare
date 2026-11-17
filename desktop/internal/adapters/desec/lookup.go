// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package desec

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"slices"
	"strings"
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
	// Log hears each round: which servers show the record, which do not
	// yet, and which do not answer. It may be nil.
	Log *slog.Logger
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
	log := s.Log
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	if s.intercepted(ctx) {
		log.Info("This network answers DNS in place of deSEC's servers. Waiting a fixed time.", "wait", s.fallbackWait())
		return s.fallback(ctx, report)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	timedOut := errors.New("deSEC took longer than usual to publish the record that proves the name is yours. Try again in a few minutes.")
	started := time.Now()
	shown := -1
	var last round
	stopped := func() error {
		log.Warn("deSEC took longer than usual. Stopped waiting.", "after", time.Since(started).Round(time.Second),
			"shown", len(last.have), "of", len(s.Addrs), "late", names(last.late), "silent", names(last.silent))
		return timedOut
	}
	for seen, n := 0, 0; ; n++ {
		r := s.count(ctx, fqdn, value)
		// A round the deadline cut short counts servers as silent that
		// were only interrupted, so it is not reported.
		if ctx.Err() != nil && n > 0 {
			return stopped()
		}
		if r.answered() == 0 && n == 0 {
			log.Info("No deSEC server answers from this network. Waiting a fixed time.", "wait", s.fallbackWait())
			return s.fallback(ctx, report)
		}
		// A round that changes the count is a step; the same count again
		// is a detail.
		level := slog.LevelDebug
		if len(r.have) != shown {
			level, shown = slog.LevelInfo, len(r.have)
		}
		log.Log(ctx, level, "deSEC servers show the proof.", "shown", len(r.have), "of", len(s.Addrs), "round", n+1,
			"late", names(r.late), "silent", names(r.silent))
		last = r
		have, answered := len(r.have), r.answered()
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
			return stopped()
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

func (s Servers) fallbackWait() time.Duration {
	if s.Fallback == 0 {
		return 3 * time.Minute
	}
	return s.Fallback
}

// fallback waits Fallback, reporting each second.
func (s Servers) fallback(ctx context.Context, report func(done, total int, timed bool)) error {
	secs := int(s.fallbackWait() / time.Second)
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

// round is one round of asking: the servers that show the record, those
// that answer without it, and those that do not answer.
type round struct {
	have, late, silent []string
}

func (r round) answered() int { return len(r.have) + len(r.late) }

// count asks every server for value at fqdn. The servers are asked
// together, each for at most a few seconds, so a silent one does not hold
// up the others.
func (s Servers) count(ctx context.Context, fqdn, value string) round {
	var mu sync.Mutex
	var wg sync.WaitGroup
	var r round
	for _, addr := range s.Addrs {
		wg.Go(func() {
			ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			values, err := LookupTXT(ctx, addr, fqdn)
			var dnsErr *net.DNSError
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err != nil && !(errors.As(err, &dnsErr) && dnsErr.IsNotFound):
				r.silent = append(r.silent, addr)
			case slices.Contains(values, value):
				r.have = append(r.have, addr)
			default:
				r.late = append(r.late, addr)
			}
		})
	}
	wg.Wait()
	return r
}

// names answers addrs as a short, sorted list for the log: "syd-1.a" for
// syd-1.a.desec.io:53, and "-" for none.
func names(addrs []string) string {
	if len(addrs) == 0 {
		return "-"
	}
	short := make([]string, 0, len(addrs))
	for _, a := range addrs {
		host, _, err := net.SplitHostPort(a)
		if err != nil {
			host = a
		}
		host = strings.TrimSuffix(strings.TrimSuffix(host, ".desec.io"), ".desec.org")
		short = append(short, host)
	}
	slices.Sort(short)
	return strings.Join(short, ",")
}
