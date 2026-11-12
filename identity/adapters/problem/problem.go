// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Package problem writes RFC 9457 problem answers. The SPA branches on the
// machine `code`; the title is for people reading a log or a network panel.
package problem

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// Body is the problem document.
type Body struct {
	Type              string `json:"type"`
	Title             string `json:"title"`
	Status            int    `json:"status"`
	Code              string `json:"code"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}

// Write answers a problem with status, code and title.
func Write(w http.ResponseWriter, status int, code, title string) {
	WriteRetry(w, status, code, title, 0)
}

// WriteRetry answers a problem that also tells the caller when to try again;
// retryAfter of zero leaves it out.
func WriteRetry(w http.ResponseWriter, status int, code, title string, retryAfter int) {
	h := w.Header()
	h.Set("Content-Type", "application/problem+json")
	h.Set("Cache-Control", "no-store")
	if retryAfter > 0 {
		h.Set("Retry-After", strconv.Itoa(retryAfter))
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Body{
		Type:              "about:blank",
		Title:             title,
		Status:            status,
		Code:              code,
		RetryAfterSeconds: retryAfter,
	})
}
