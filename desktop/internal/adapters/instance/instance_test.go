// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package instance

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func serverAnswering(t *testing.T, body string) (int, *string) {
	host := new(string)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*host = r.Host
		if r.URL.Path != "/desktop/info" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	_, p, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(p)
	return port, host
}

func TestClaimFindsRunningCopy(t *testing.T) {
	port, host := serverAnswering(t, `{"program":"once-dark-studio-desktop","version":"1.0.0"}`)
	lns, outcome, err := Claim(context.Background(), port)
	if lns != nil || outcome != Running || err != nil {
		t.Fatalf("claim: %v %v %v", lns, outcome, err)
	}
	if *host != "localhost:"+strconv.Itoa(port) {
		t.Fatalf("the probe sent Host %q", *host)
	}
}

func TestClaimReportsAnotherProgram(t *testing.T) {
	port, _ := serverAnswering(t, `{"name":"something else"}`)
	lns, outcome, err := Claim(context.Background(), port)
	if lns != nil || outcome != Occupied || err == nil {
		t.Fatalf("claim: %v %v %v", lns, outcome, err)
	}
	msg := OccupiedMessage("Phospheare", port)
	for _, want := range []string{"Phospheare cannot start", strconv.Itoa(port), "--port", "address", "not visible"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("message lacks %q:\n%s", want, msg)
		}
	}
}

func TestClaimTakesFreePort(t *testing.T) {
	probe, _ := net.Listen("tcp", "127.0.0.1:0")
	_, p, _ := net.SplitHostPort(probe.Addr().String())
	probe.Close()
	port, _ := strconv.Atoi(p)
	lns, outcome, err := Claim(context.Background(), port)
	if err != nil || outcome != Claimed || len(lns) == 0 {
		t.Fatalf("claim: %v %v %v", lns, outcome, err)
	}
	for _, ln := range lns {
		ln.Close()
	}
}

func freeLoopbackPort(t *testing.T) int {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, p, _ := net.SplitHostPort(probe.Addr().String())
	probe.Close()
	port, _ := strconv.Atoi(p)
	return port
}

// Where the computer has IPv6 loopback, the port is held there too, and a
// program holding [::1] alone keeps the claim from succeeding.
func TestClaimHoldsIPv6LoopbackToo(t *testing.T) {
	port := freeLoopbackPort(t)
	squatter, err := net.Listen("tcp", net.JoinHostPort("::1", strconv.Itoa(port)))
	if err != nil {
		t.Skipf("no IPv6 loopback: %v", err)
	}
	lns, outcome, err := Claim(context.Background(), port)
	squatter.Close()
	if lns != nil || outcome != Occupied || err == nil {
		t.Fatalf("with [::1] taken: %v %v %v", lns, outcome, err)
	}
	if again, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port))); err != nil {
		t.Fatalf("the refused claim kept 127.0.0.1: %v", err)
	} else {
		again.Close()
	}
	lns, outcome, err = Claim(context.Background(), port)
	if err != nil || outcome != Claimed || len(lns) != 2 {
		t.Fatalf("claim: %v %v %v", lns, outcome, err)
	}
	for _, ln := range lns {
		ln.Close()
	}
}

func TestOpenAgainAsksTheRunningCopy(t *testing.T) {
	var host, header, method string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, header, method = r.Host, r.Header.Get("X-Phospheare-Admin"), r.Method
		if r.URL.Path != "/desktop/open-again" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(srv.Close)
	_, p, _ := net.SplitHostPort(srv.Listener.Addr().String())
	port, _ := strconv.Atoi(p)
	if err := OpenAgain(context.Background(), port); err != nil {
		t.Fatal(err)
	}
	if host != "localhost:"+p || header != "1" || method != http.MethodPost {
		t.Fatalf("asked %s with host %q and header %q", method, host, header)
	}
}

func TestOpenAgainFailsOnACopyTooOldToBeAsked(t *testing.T) {
	port, _ := serverAnswering(t, `{"program":"once-dark-studio-desktop"}`)
	if err := OpenAgain(context.Background(), port); err == nil {
		t.Fatal("a copy without the path counted as opened")
	}
}
