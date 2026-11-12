// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi

import (
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/perseomazzoni/phospheare/identity/adapters/problem"
	"github.com/perseomazzoni/phospheare/identity/domain"
)

// The routes anyone on the home network can reach without a session (open
// a session, begin a flow, Google's callback) take one token from their
// client address's bucket. The loopback listener is not limited
// (`domain.Origin.Loopback`).

const (
	// rateBurst is how many requests an address makes before it waits; a
	// sign-in takes four.
	rateBurst = 30
	// rateRefill is how long one token takes to come back.
	rateRefill = 2 * time.Second
	// rateAddresses caps the addresses tracked at once.
	rateAddresses = 4096
)

type bucket struct {
	tokens float64
	at     time.Time
}

// limiter is a token bucket per client address.
type limiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	now     func() time.Time
}

func newLimiter(now func() time.Time) *limiter {
	return &limiter{buckets: map[string]*bucket{}, now: now}
}

// take spends one of addr's tokens, or answers how long until one is back.
func (l *limiter) take(addr string) (time.Duration, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b := l.buckets[addr]
	if b == nil {
		if len(l.buckets) >= rateAddresses {
			l.sweep(now)
		}
		b = &bucket{tokens: rateBurst, at: now}
		l.buckets[addr] = b
	}
	b.tokens = refilled(b, now)
	b.at = now
	if b.tokens < 1 {
		return time.Duration((1 - b.tokens) * float64(rateRefill)), false
	}
	b.tokens--
	return 0, true
}

func refilled(b *bucket, now time.Time) float64 {
	return math.Min(rateBurst, b.tokens+float64(now.Sub(b.at))/float64(rateRefill))
}

// sweep forgets the addresses whose bucket is full again, and every address
// when that frees nothing, so the map stays bounded.
func (l *limiter) sweep(now time.Time) {
	for addr, b := range l.buckets {
		if refilled(b, now) >= rateBurst {
			delete(l.buckets, addr)
		}
	}
	if len(l.buckets) >= rateAddresses {
		clear(l.buckets)
	}
}

// limit puts next behind lim; a nil lim limits nothing.
func limit(lim *limiter, next http.HandlerFunc) http.HandlerFunc {
	if lim == nil {
		return next
	}
	return func(w http.ResponseWriter, r *http.Request) {
		wait, ok := lim.take(clientAddress(r))
		if !ok {
			retry := int(math.Ceil(wait.Seconds()))
			problem.WriteRetry(w, http.StatusTooManyRequests, domain.CodeRateLimited, refusals[domain.CodeRateLimited].title, max(retry, 1))
			return
		}
		next(w, r)
	}
}

// clientAddress answers the address a request came from. A request from a
// loopback peer that names a client in `X-Forwarded-For` came through the
// desktop's front, which writes the last entry; a peer elsewhere cannot set
// it.
func clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if fwd := r.Header.Values("X-Forwarded-For"); len(fwd) > 0 {
			hops := strings.Split(fwd[len(fwd)-1], ",")
			if last := strings.TrimSpace(hops[len(hops)-1]); last != "" {
				return last
			}
		}
	}
	return host
}
