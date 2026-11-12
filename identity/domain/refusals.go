// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package domain

import "errors"

// Refusal codes of the identity contract in `docs/identity-contract.md`.
const (
	CodeBadRequest        = "bad-request"
	CodeNoSession         = "no-session"
	CodeWriterMismatch    = "writer-mismatch"
	CodeNotConfigured     = "google-not-configured"
	CodeFlowExpired       = "flow-expired"
	CodeFlowPending       = "flow-pending"
	CodeFlowFailed        = "flow-failed"
	CodeFlowCancelled     = "flow-cancelled"
	CodeSessionMismatch   = "flow-session-mismatch"
	CodeAccountMismatch   = "account-mismatch"
	CodeScopeMissing      = "scope-missing"
	CodeNoConnection      = "no-connection"
	CodeNoCredential      = "no-credential"
	CodeGrantInvalid      = "grant-invalid"
	CodeGoogleUnreachable = "google-unreachable"
	CodeGoogleRefused     = "google-refused"
	CodeRateLimited       = "rate-limited"
)

// Error is a refusal with one of the contract's codes.
type Error struct{ Code string }

func (e *Error) Error() string { return "oauth: " + e.Code }

// Refuse answers the refusal with code.
func Refuse(code string) error { return &Error{Code: code} }

// CodeOf answers err's refusal code, or "" for another error.
func CodeOf(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}
