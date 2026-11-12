// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"testing"
	"time"
)

func TestSessionAdmitsOnlyItsProofWithinThirtyDays(t *testing.T) {
	opened := time.Unix(1_800_000_000, 0)
	c := SessionClaims{SID: "sid", WriterID: "w", IAT: opened.Unix(), Proof: "proof"}
	if !c.Admits("proof", opened.Add(30*24*time.Hour-time.Second)) {
		t.Fatal("refused inside thirty days")
	}
	if c.Admits("proof", opened.Add(30*24*time.Hour)) {
		t.Fatal("admitted after thirty days")
	}
	for _, proof := range []string{"", "proo", "proof2", "PROOF"} {
		if c.Admits(proof, opened) {
			t.Fatalf("admitted proof %q", proof)
		}
	}
	unproved := c
	unproved.Proof = ""
	if unproved.Admits("", opened) {
		t.Fatal("a session sealed without a proof admitted an empty one")
	}
}

func TestCancelledAtGoogle(t *testing.T) {
	if !CancelledAtGoogle("access_denied") || CancelledAtGoogle("server_error") || CancelledAtGoogle("") {
		t.Fatal("misread Google's error")
	}
}
