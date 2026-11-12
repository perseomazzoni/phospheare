// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

// Scopes of the two purposes. A Drive grant carries the identity scopes too,
// so its ID token names the account that granted it.
const (
	ScopeDriveFile    = "https://www.googleapis.com/auth/drive.file"
	ScopeDriveAppdata = "https://www.googleapis.com/auth/drive.appdata"
	IdentityScopes    = "openid email profile"
	DriveScopes       = IdentityScopes + " " + ScopeDriveFile + " " + ScopeDriveAppdata
)

// Credentials are the Web-application client's id and secret.
type Credentials struct {
	ClientID     string
	ClientSecret string
}
