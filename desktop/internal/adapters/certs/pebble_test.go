// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Runs the certificate source against Pebble, Let's Encrypt's test
// authority, through the deSEC stand-in, whose challenge records go to
// `pebble-challtestsrv`, Pebble's DNS. It runs only when
// PHOSPHEARE_PEBBLE_DIRECTORY and PHOSPHEARE_CHALLTESTSRV are set; `desktop/README.md`
// shows how to start both.

package certs

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/desec/desectest"
	"github.com/perseomazzoni/phospheare/desktop/internal/adapters/vault"
	"github.com/perseomazzoni/phospheare/desktop/internal/domain"
)

// challtestsrv publishes challenge records through the test DNS server's
// management API.
type challtestsrv struct {
	base string
}

func (c challtestsrv) post(path string, body map[string]string) error {
	raw, _ := json.Marshal(body)
	resp, err := http.Post(c.base+path, "application/json", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("challtestsrv %s: %d", path, resp.StatusCode)
	}
	return nil
}

// txt mirrors one of the stand-in's `TXT` writes into the test DNS.
func (c challtestsrv) txt(fqdn, value string) {
	if value == "" {
		c.post("/clear-txt", map[string]string{"host": fqdn + "."})
		return
	}
	c.post("/set-txt", map[string]string{"host": fqdn + ".", "value": value})
}

func TestSourceAgainstPebble(t *testing.T) {
	directory, mgmt := os.Getenv("PHOSPHEARE_PEBBLE_DIRECTORY"), os.Getenv("PHOSPHEARE_CHALLTESTSRV")
	if directory == "" || mgmt == "" {
		t.Skip("set PHOSPHEARE_PEBBLE_DIRECTORY and PHOSPHEARE_CHALLTESTSRV to run against Pebble")
	}
	f := desectest.New()
	defer f.Close()
	f.OnTXT = challtestsrv{base: mgmt}.txt
	token := f.AddAccount("name@example.com", "rossi.dedyn.io")
	// Pebble serves its directory with a certificate from its own test CA.
	client := &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	src := &Source{
		Dir: Dir{Path: t.TempDir(), Vault: vault.Memory()}, ACMEDirectory: directory, HTTP: client,
		Records: &desec.Client{BaseURL: f.URL, HTTP: f.Client()},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	lan := domain.LAN{Port: 47843, Address: "192.168.1.20", DeSEC: domain.DeSEC{Name: "rossi", Token: token}}
	terms, err := src.Terms(ctx, lan)
	if err != nil {
		t.Fatal(err)
	}
	lan.CertTerms = terms
	_, info, err := src.Prepare(ctx, lan, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Pebble issued a certificate by %s, valid until %s", info.Issuer, info.NotAfter)
}
