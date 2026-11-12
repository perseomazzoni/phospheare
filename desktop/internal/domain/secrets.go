// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

// SecretPlace is where the desktop keeps its secrets. The first start picks
// it and `config.json` keeps the choice, so a store that does not answer
// at a later start stops the start rather than lose the setup.
type SecretPlace string

const (
	// SecretsUnchosen is a setup the first start has not reached yet.
	SecretsUnchosen SecretPlace = ""
	// SecretsInSystem is the system's own store: Windows Credential
	// Manager, the macOS Keychain or the Secret Service on Linux.
	SecretsInSystem SecretPlace = "system"
	// SecretsInFile is `secrets.json` in the data folder, with mode 0600,
	// where no system store answered at the first start.
	SecretsInFile SecretPlace = "file"
)

// The names the secrets are kept under.
const (
	SecretGoogleClient   = "google-client-secret"
	SecretDeSECToken     = "desec-token"
	SecretDeSECPassword  = "desec-pending-password"
	SecretSealKeys       = "seal-keys"
	SecretACMEAccountKey = "acme-account-key"
	SecretTLSKey         = "tls-key"
)
