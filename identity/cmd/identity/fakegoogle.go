// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

//go:build devfake

// A development build, made with `-tags devfake`, reaches the Google
// stand-in of desktop/cmd/fake-services in place of Google, so the setup
// page's Google steps can be walked by hand with no Google project. The
// release build has none of this.

package main

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"

	"github.com/perseomazzoni/phospheare/identity/adapters/google"
)

// fakeServices is the address of fake-services. `npm run dev:wizard` sets
// it at build time with -ldflags "-X main.fakeServices=...".
var fakeServices = "http://127.0.0.1:47890"

func init() {
	endpoints, files, err := fakeGoogle(fakeServices)
	if err != nil {
		fmt.Fprintln(os.Stderr, "identity:", err)
		os.Exit(2)
	}
	googleEndpoints, driveFiles = endpoints, files
}

// fakeGoogle answers the stand-in's endpoints under base, which must be a
// loopback address: the stand-in signs nothing.
func fakeGoogle(base string) (google.Endpoints, string, error) {
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || u.Port() == "" || !net.ParseIP(u.Hostname()).IsLoopback() {
		return google.Endpoints{}, "", errors.New("the devfake build was made with " + base + " as the address of fake-services; it must be a loopback address such as http://127.0.0.1:47890")
	}
	base = strings.TrimSuffix(base, "/") + "/google"
	return google.Endpoints{Auth: base + "/auth", Token: base + "/token", Revoke: base + "/revoke"}, base + "/drive/v3/files", nil
}
