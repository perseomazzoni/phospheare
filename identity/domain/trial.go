// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

// TrialResult is what a trial sign-in (PurposeTrial) found.
type TrialResult string

const (
	// TrialOK: Google signed the person in, granted both Drive scopes, and
	// Google Drive answered.
	TrialOK TrialResult = "ok"
	// TrialCancelled: the person said no at Google.
	TrialCancelled TrialResult = "cancelled"
	// TrialScopeMissing: Google left out a Drive permission, or Drive found
	// the token without it.
	TrialScopeMissing TrialResult = "scope-missing"
	// TrialDriveOff: the project has the Google Drive API turned off.
	TrialDriveOff TrialResult = "drive-off"
	// TrialClient: Google refused the client's ID or secret.
	TrialClient TrialResult = "client"
	// TrialUnreachable: Google could not be reached.
	TrialUnreachable TrialResult = "unreachable"
	// TrialFailed: anything else.
	TrialFailed TrialResult = "failed"
)

// TrialReport is what a trial answers: its result and, once Google said who
// signed in, that account's address. It never carries a token.
type TrialReport struct {
	Result TrialResult `json:"result"`
	Email  string      `json:"email,omitempty"`
}
