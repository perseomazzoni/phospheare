// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import (
	"crypto/sha256"
	"encoding/hex"
)

// CredentialNames are the credentials a writer may keep sealed in this
// browser. Only the OpenRouter key so far.
var CredentialNames = map[string]bool{"openrouter.key": true}

// maxCredential bounds a kept value. An OpenRouter key is about 75 bytes.
const maxCredential = 512

// CredentialClaims are the sealed content of one kept credential's cookie.
type CredentialClaims struct {
	V        int    `json:"v"`
	WriterID string `json:"writerId"`
	Name     string `json:"name"`
	Value    string `json:"value"`
}

// ValidCredential reports whether value may be kept: 1 to 512 bytes of
// printable ASCII, without spaces.
func ValidCredential(value string) bool {
	if value == "" || len(value) > maxCredential {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < 0x21 || value[i] > 0x7e {
			return false
		}
	}
	return true
}

// CredentialSlot answers the part of the cookie name that sets apart the
// credential name of writerID: no identifier is readable in it, and two
// accounts in one browser profile never overwrite each other's.
func CredentialSlot(writerID, name string) string {
	sum := sha256.Sum256([]byte(writerID + "\x00" + name))
	return hex.EncodeToString(sum[:8])
}
