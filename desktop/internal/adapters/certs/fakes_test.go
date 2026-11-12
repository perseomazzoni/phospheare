// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package certs

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"
)

// ── Published challenge records ───────────────────────────────────────────────

// txtTable is the DNS the fake authority checks challenge records against.
type txtTable struct {
	mu  sync.Mutex
	txt map[string][]string
}

func newTXTTable() *txtTable { return &txtTable{txt: map[string][]string{}} }

// set records value for name, or removes name when value is "".
func (d *txtTable) set(name, value string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if value == "" {
		delete(d.txt, name)
		return
	}
	d.txt[name] = append(d.txt[name], value)
}

func (d *txtTable) has(name, value string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return slices.Contains(d.txt[name], value)
}

// ── Fake certificate authority ───────────────────────────────────────────────

// fakeTerms is the agreement the fake authority names until a test sets
// another.
const fakeTerms = "https://example.test/terms"

// fakeACME is enough of RFC 8555 for one DNS-01 order. It does not verify
// JWS signatures; it reads payloads, checks the challenge record against
// the published records and signs the CSR with a test CA.
type fakeACME struct {
	t        *testing.T
	srv      *httptest.Server
	resolver *txtTable
	thumb    string
	ca       *x509.Certificate
	caKey    *ecdsa.PrivateKey

	mu       sync.Mutex
	host     string
	token    string
	authz    string
	order    string
	certDER  []byte
	accounts int
	orders   int
	// terms is the agreement the directory names.
	terms string
	// action, when set, is the page every account request is sent to with
	// a userActionRequired refusal.
	action string
}

func newFakeACME(t *testing.T, resolver *txtTable, thumbprint string) *fakeACME {
	a := &fakeACME{t: t, resolver: resolver, thumb: thumbprint, token: "challenge-token-1", authz: "pending", order: "pending", terms: fakeTerms}
	a.caKey, _ = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Fake ACME CA", Organization: []string{"Test Authority"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, &a.caKey.PublicKey, a.caKey)
	a.ca, _ = x509.ParseCertificate(der)
	a.srv = httptest.NewServer(http.HandlerFunc(a.serve))
	t.Cleanup(a.srv.Close)
	return a
}

func (a *fakeACME) url(p string) string { return a.srv.URL + p }

func jwsPayload(r *http.Request) []byte {
	var jws struct {
		Payload string `json:"payload"`
	}
	raw, _ := io.ReadAll(r.Body)
	_ = json.Unmarshal(raw, &jws)
	out, _ := base64.RawURLEncoding.DecodeString(jws.Payload)
	return out
}

func (a *fakeACME) orderJSON() map[string]any {
	out := map[string]any{
		"status":         a.order,
		"identifiers":    []any{map[string]string{"type": "dns", "value": a.host}},
		"authorizations": []string{a.url("/authz/1")},
		"finalize":       a.url("/finalize/1"),
	}
	if a.order == "valid" {
		out["certificate"] = a.url("/cert/1")
	}
	return out
}

func (a *fakeACME) serve(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	w.Header().Set("Replay-Nonce", fmt.Sprintf("nonce-%d", time.Now().UnixNano()))
	if r.URL.Path == "/directory" {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"newNonce": a.url("/nonce"), "newAccount": a.url("/account"), "newOrder": a.url("/order"),
			"revokeCert": a.url("/revoke"), "keyChange": a.url("/key-change"),
			"meta": map[string]any{"termsOfService": a.terms},
		})
		return
	}
	if r.URL.Path == "/nonce" {
		w.WriteHeader(http.StatusOK)
		return
	}
	payload := jwsPayload(r)
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/account":
		a.accounts++
		if a.action != "" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{"type": "urn:ietf:params:acme:error:userActionRequired", "detail": "the agreement changed", "instance": a.action})
			return
		}
		w.Header().Set("Location", a.url("/acct/1"))
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "valid"})
	case "/order":
		a.orders++
		a.order, a.authz = "pending", "pending"
		var req struct {
			Identifiers []struct{ Value string } `json:"identifiers"`
		}
		_ = json.Unmarshal(payload, &req)
		a.host = req.Identifiers[0].Value
		w.Header().Set("Location", a.url("/orders/1"))
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(a.orderJSON())
	case "/authz/1":
		dns01 := map[string]any{"type": "dns-01", "url": a.url("/chal/1"), "token": a.token, "status": a.authz}
		if a.authz == "invalid" {
			// What Let's Encrypt says when a place it checks from finds no record.
			dns01["error"] = map[string]any{"type": "urn:ietf:params:acme:error:dns", "detail": "NXDOMAIN looking up TXT", "status": 400}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":     a.authz,
			"identifier": map[string]string{"type": "dns", "value": a.host},
			"challenges": []any{
				map[string]string{"type": "http-01", "url": a.url("/chal/http"), "token": "other", "status": "pending"},
				dns01,
			},
		})
	case "/chal/1":
		want := keyAuthDigest(a.token, a.thumb)
		status := "invalid"
		if a.resolver.has("_acme-challenge."+a.host, want) {
			status = "valid"
			a.order = "ready"
		}
		a.authz = status
		_ = json.NewEncoder(w).Encode(map[string]string{"type": "dns-01", "url": a.url("/chal/1"), "token": a.token, "status": status})
	case "/orders/1":
		_ = json.NewEncoder(w).Encode(a.orderJSON())
	case "/finalize/1":
		var req struct {
			CSR string `json:"csr"`
		}
		_ = json.Unmarshal(payload, &req)
		der, _ := base64.RawURLEncoding.DecodeString(req.CSR)
		csr, err := x509.ParseCertificateRequest(der)
		if err != nil || a.order != "ready" {
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]any{"type": "urn:ietf:params:acme:error:orderNotReady", "detail": "not ready"})
			return
		}
		tpl := &x509.Certificate{
			SerialNumber: big.NewInt(2),
			Subject:      pkix.Name{CommonName: csr.DNSNames[0]},
			DNSNames:     csr.DNSNames,
			NotBefore:    time.Now().Add(-time.Minute),
			NotAfter:     time.Now().Add(90 * 24 * time.Hour),
			KeyUsage:     x509.KeyUsageDigitalSignature,
			ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		}
		a.certDER, _ = x509.CreateCertificate(rand.Reader, tpl, a.ca, csr.PublicKey, a.caKey)
		a.order = "valid"
		// Like Pebble, the finalize answer says "processing" and carries no
		// Location header; the order URL reports it valid.
		processing := a.orderJSON()
		processing["status"] = "processing"
		delete(processing, "certificate")
		_ = json.NewEncoder(w).Encode(processing)
	case "/cert/1":
		w.Header().Set("Content-Type", "application/pem-certificate-chain")
		_ = pem.Encode(w, &pem.Block{Type: "CERTIFICATE", Bytes: a.certDER})
		_ = pem.Encode(w, &pem.Block{Type: "CERTIFICATE", Bytes: a.ca.Raw})
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}
