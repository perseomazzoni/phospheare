// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package desec

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec/desectest"
	"github.com/perseomazzoni/phospheare/desktop/internal/ports"
)

func client(f *desectest.Fake) *Client {
	return &Client{BaseURL: f.URL, HTTP: f.Client(), TokenName: "Studio on this computer"}
}

func TestSignUpMakesANarrowedToken(t *testing.T) {
	f := desectest.New()
	defer f.Close()
	c, ctx := client(f), context.Background()
	if err := c.Register(ctx, "name@example.com", "pw", "rossi.dedyn.io"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Login(ctx, "name@example.com", "pw"); !errors.Is(err, ports.ErrNotActivated) {
		t.Fatalf("before the link: %v", err)
	}
	f.Activate("name@example.com")
	login, err := c.Login(ctx, "name@example.com", "pw")
	if err != nil {
		t.Fatal(err)
	}
	token, narrowed, err := c.MakeToken(ctx, login, "rossi.dedyn.io")
	if err != nil || token == "" || !narrowed {
		t.Fatalf("%q %v %v", token, narrowed, err)
	}
	if len(f.TokenNames) != 1 || f.TokenNames[0] != "Studio on this computer" {
		t.Fatalf("token names %q", f.TokenNames)
	}
	if err := c.Logout(ctx, login); err != nil {
		t.Fatal(err)
	}
	if err := c.Owns(ctx, token, "rossi.dedyn.io"); err != nil {
		t.Fatal(err)
	}
	if err := c.SetA(ctx, token, "rossi.dedyn.io", "192.168.1.20"); err != nil {
		t.Fatal(err)
	}
	if got := f.Record("rossi.dedyn.io", "", "A"); !slices.Equal(got, []string{"192.168.1.20"}) {
		t.Fatal(got)
	}
	if err := c.SetTXT(ctx, token, "rossi.dedyn.io", "_acme-challenge", "abc"); err != nil {
		t.Fatal(err)
	}
	if got := f.Record("rossi.dedyn.io", "_acme-challenge", "TXT"); !slices.Equal(got, []string{`"abc"`}) {
		t.Fatal(got)
	}
	if err := c.DeleteTXT(ctx, token, "rossi.dedyn.io", "_acme-challenge"); err != nil || f.Record("rossi.dedyn.io", "_acme-challenge", "TXT") != nil {
		t.Fatal(err)
	}
	// The policies leave every other record read-only.
	if err := c.SetTXT(ctx, token, "rossi.dedyn.io", "other", "x"); err == nil {
		t.Fatal("a narrowed token must not write other records")
	}
}

func TestMakeTokenWithoutPolicyRights(t *testing.T) {
	f := desectest.New()
	defer f.Close()
	f.NoPolicies = true
	c, ctx := client(f), context.Background()
	c.Register(ctx, "name@example.com", "pw", "rossi.dedyn.io")
	f.Activate("name@example.com")
	login, _ := c.Login(ctx, "name@example.com", "pw")
	token, narrowed, err := c.MakeToken(ctx, login, "rossi.dedyn.io")
	if err != nil || token == "" || narrowed {
		t.Fatalf("%q %v %v", token, narrowed, err)
	}
}

func TestRefusalsNameTheField(t *testing.T) {
	f := desectest.New()
	defer f.Close()
	c, ctx := client(f), context.Background()
	var r *ports.Refusal
	if err := c.Register(ctx, "name@example.com", "pw", "taken.dedyn.io"); !errors.As(err, &r) || r.Field != "name" || !strings.Contains(r.Message, "unavailable") {
		t.Fatalf("%v", err)
	}
	if err := c.Owns(ctx, "wrong", "rossi.dedyn.io"); !errors.As(err, &r) || r.Field != "token" {
		t.Fatalf("%v", err)
	}
	token := f.AddAccount("other@example.com", "other.dedyn.io")
	if err := c.Owns(ctx, token, "rossi.dedyn.io"); !errors.As(err, &r) || r.Field != "name" {
		t.Fatalf("%v", err)
	}
}

func TestThrottledAnswerSaysHowLong(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Retry-After", "42")
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer srv.Close()
	err := (&Client{BaseURL: srv.URL, HTTP: srv.Client()}).Register(context.Background(), "a@b", "pw", "x.dedyn.io")
	if err == nil || !strings.Contains(err.Error(), "42 seconds") {
		t.Fatal(err)
	}
}

// deSEC's gateway fails now and then; the same call, body and all, is made
// again, up to three times.
func TestAFailingGatewayIsAskedAgain(t *testing.T) {
	var bodies []string
	fails := 2
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		if fails > 0 {
			fails--
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, HTTP: srv.Client(), RetryAfter: time.Millisecond}
	if err := c.write(context.Background(), "t", "x.dedyn.io", rrset{Type: "A", TTL: 3600, Records: []string{"192.168.1.7"}}); err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 3 || bodies[0] == "" || bodies[0] != bodies[2] {
		t.Fatalf("bodies %q", bodies)
	}
	fails = 5
	if err := c.write(context.Background(), "t", "x.dedyn.io", rrset{Type: "A"}); err == nil {
		t.Fatal("a gateway failing every time was taken as success")
	}
}

// txtServer answers every `TXT` question over UDP with values, as an
// authoritative server would.
func txtServer(t *testing.T, values ...string) string {
	return txtServerOf(t, func() []string { return values })
}

// txtServerOf answers each `TXT` question with what answer gives then.
func txtServerOf(t *testing.T, answer func() []string) string {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 512)
		for {
			n, from, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			q := buf[:n]
			end := 12
			for q[end] != 0 {
				end += int(q[end]) + 1
			}
			end += 5
			out := append([]byte{}, q[:2]...)
			out = append(out, 0x85, 0x00, 0, 1)
			values := answer()
			out = binary.BigEndian.AppendUint16(out, uint16(len(values)))
			out = append(out, 0, 0, 0, 0)
			out = append(out, q[12:end]...)
			for _, v := range values {
				out = append(out, 0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60)
				out = binary.BigEndian.AppendUint16(out, uint16(len(v)+1))
				out = append(out, byte(len(v)))
				out = append(out, v...)
			}
			pc.WriteTo(out, from)
		}
	}()
	return pc.LocalAddr().String()
}

// closedPort answers a local address where nothing listens, so a question
// sent there fails at once.
func closedPort(t *testing.T) string {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := pc.LocalAddr().String()
	pc.Close()
	return addr
}

func TestServersWaitForEveryServer(t *testing.T) {
	ctx := context.Background()
	probe := closedPort(t)
	has, lacks := txtServer(t, "other", "abc"), txtServer(t, "other")
	if got, err := LookupTXT(ctx, has, "_acme-challenge.rossi.dedyn.io"); err != nil || !slices.Equal(got, []string{"other", "abc"}) {
		t.Fatalf("%v %v", got, err)
	}
	if err := (Servers{Addrs: []string{has}, Probe: probe, Interval: time.Millisecond, Timeout: time.Second}).Wait(ctx, "_acme-challenge.rossi.dedyn.io", "abc", nil); err != nil {
		t.Fatal(err)
	}
	var last [2]int
	report := func(done, total int, timed bool) {
		if timed {
			t.Error("servers that answer were not asked")
		}
		last = [2]int{done, total}
	}
	err := (Servers{Addrs: []string{has, lacks}, Probe: probe, Interval: 10 * time.Millisecond, Timeout: 100 * time.Millisecond}).Wait(ctx, "_acme-challenge.rossi.dedyn.io", "abc", report)
	if err == nil || !strings.Contains(err.Error(), "Try again in a few minutes") {
		t.Fatal(err)
	}
	if last != [2]int{1, 2} {
		t.Fatalf("reported %v, want 1 of 2", last)
	}
}

// deSEC's servers take a change at different moments, so an address can
// answer with the record and then without it; Wait holds out for answers
// that keep finding it.
func TestServersWaitForASteadyAnswer(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	asked := 0
	flicker := txtServerOf(t, func() []string {
		mu.Lock()
		defer mu.Unlock()
		asked++
		if asked%3 == 0 {
			return nil
		}
		return []string{"abc"}
	})
	probe := closedPort(t)
	err := (Servers{Addrs: []string{flicker}, Probe: probe, Interval: time.Millisecond, Timeout: 200 * time.Millisecond, Steady: 3}).Wait(ctx, "_acme-challenge.rossi.dedyn.io", "abc", nil)
	if err == nil {
		t.Fatal("a flickering record counted as published")
	}
	steady := txtServer(t, "abc")
	if err := (Servers{Addrs: []string{steady}, Probe: probe, Interval: time.Millisecond, Timeout: time.Second, Steady: 3}).Wait(ctx, "_acme-challenge.rossi.dedyn.io", "abc", nil); err != nil {
		t.Fatal(err)
	}
}

// A server that does not answer at all is left out; one that answers
// without the record is waited for.
func TestServersLeaveOutAServerThatDoesNotAnswer(t *testing.T) {
	ctx := context.Background()
	silent, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer silent.Close()
	has := txtServer(t, "abc")
	s := Servers{Addrs: []string{has, silent.LocalAddr().String()}, Probe: closedPort(t), Interval: time.Millisecond, Timeout: 20 * time.Second, Steady: 1}
	if err := s.Wait(ctx, "_acme-challenge.rossi.dedyn.io", "abc", nil); err != nil {
		t.Fatal(err)
	}
}

// A network that answers in place of every server, or lets no question
// out, hides deSEC's servers; Wait then waits Fallback and counts its
// seconds.
func TestServersWaitTheFallbackWhenTheyCannotBeAsked(t *testing.T) {
	ctx := context.Background()
	lacks := txtServer(t, "other")
	for name, s := range map[string]Servers{
		"answered in their place": {Addrs: []string{lacks}, Probe: txtServer(t, "x")},
		"no question gets out":    {Addrs: []string{closedPort(t)}, Probe: closedPort(t)},
	} {
		var reports [][2]int
		s.Fallback, s.Timeout = time.Second, time.Minute
		err := s.Wait(ctx, "_acme-challenge.rossi.dedyn.io", "abc", func(done, total int, timed bool) {
			if !timed {
				t.Errorf("%s: reported servers", name)
			}
			reports = append(reports, [2]int{done, total})
		})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if !slices.Equal(reports, [][2]int{{0, 1}, {1, 1}}) {
			t.Fatalf("%s: reported %v", name, reports)
		}
	}
}

func TestServersStillCheckHealthyServersAfterASilentOne(t *testing.T) {
	silent, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer silent.Close()
	s := Servers{Addrs: []string{silent.LocalAddr().String(), txtServer(t, "abc")}, Probe: closedPort(t), Interval: time.Millisecond, Timeout: 150 * time.Millisecond, Steady: 1}
	if err := s.Wait(context.Background(), "_acme-challenge.rossi.dedyn.io", "abc", nil); err != nil {
		t.Fatalf("an unreachable server prevented the published challenge being seen: %v", err)
	}
}

// A POST that met a failing gateway may have reached deSEC, so it is made
// once; the calls that can be repeated are asked again.
func TestAFailingGatewayIsNotAskedTwiceForAPost(t *testing.T) {
	calls := map[string]int{}
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls[r.Method]++
		mu.Unlock()
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, HTTP: srv.Client(), RetryAfter: time.Millisecond}
	for _, m := range []string{http.MethodPost, http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if _, err := c.call(context.Background(), m, "/x/", "t", nil, nil); err == nil {
			t.Fatalf("%s: a failing gateway was taken as success", m)
		}
	}
	if calls[http.MethodPost] != 1 {
		t.Fatalf("a POST was made %d times", calls[http.MethodPost])
	}
	for _, m := range []string{http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if calls[m] != tries {
			t.Fatalf("%s was made %d times", m, calls[m])
		}
	}
}

// Pointing the name at the computer removes an `AAAA` record a phone would
// otherwise try first.
func TestSetAClearsAStaleAAAARecord(t *testing.T) {
	f := desectest.New()
	defer f.Close()
	c, ctx := client(f), context.Background()
	token := f.AddAccount("name@example.com", "rossi.dedyn.io")
	if err := c.write(ctx, token, "rossi.dedyn.io", rrset{Type: "AAAA", TTL: 3600, Records: []string{"fd00::7"}}); err != nil {
		t.Fatal(err)
	}
	if err := c.SetA(ctx, token, "rossi.dedyn.io", "192.168.1.20"); err != nil {
		t.Fatal(err)
	}
	if got := f.Record("rossi.dedyn.io", "", "AAAA"); got != nil {
		t.Fatalf("AAAA record %v", got)
	}
	if got := f.Record("rossi.dedyn.io", "", "A"); !slices.Equal(got, []string{"192.168.1.20"}) {
		t.Fatalf("A record %v", got)
	}
}
