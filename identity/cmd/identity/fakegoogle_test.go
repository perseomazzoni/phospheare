// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build devfake

package main

import "testing"

func TestFakeGoogleTakesOnlyLoopback(t *testing.T) {
	for _, base := range []string{"https://127.0.0.1:47890", "http://192.168.1.20:47890", "http://example.com:47890", "http://127.0.0.1"} {
		if _, _, err := fakeGoogle(base); err == nil {
			t.Errorf("%s was accepted", base)
		}
	}
}

func TestTheDevfakeBuildReachesTheGoogleStandIn(t *testing.T) {
	want := fakeServices + "/google"
	if googleEndpoints.Auth != want+"/auth" || googleEndpoints.Token != want+"/token" || googleEndpoints.Revoke != want+"/revoke" {
		t.Errorf("endpoints = %+v", googleEndpoints)
	}
	if driveFiles != want+"/drive/v3/files" {
		t.Errorf("drive = %s", driveFiles)
	}
}
