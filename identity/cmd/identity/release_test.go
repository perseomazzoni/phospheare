// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build !devfake

package main

import (
	"testing"

	"github.com/perseomazzoni/phospheare/identity/adapters/google"
)

// The release build, made without the devfake tag, reaches only Google.
func TestTheReleaseBuildReachesOnlyGoogle(t *testing.T) {
	if googleEndpoints != google.GoogleEndpoints || driveFiles != google.DriveFiles {
		t.Fatalf("endpoints = %+v, drive = %s", googleEndpoints, driveFiles)
	}
}
