// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi

import (
	"net/http"

	"github.com/perseomazzoni/phospheare/identity/adapters/problem"
	"github.com/perseomazzoni/phospheare/identity/domain"
)

// ── Trial sign-in ────────────────────────────────────────────────────────────

// The trial routes serve the setup page on the computer itself. On any other
// listener they do not exist, so a phone on the home network cannot start
// one.

func notFound(w http.ResponseWriter) {
	problem.Write(w, http.StatusNotFound, "not-found", "No such identity route")
}

func (h *Host) beginTrial(w http.ResponseWriter, r *http.Request, l Listener) {
	if !l.Loopback {
		notFound(w)
		return
	}
	f, authorizeURL, err := h.OAuth.BeginTrial(l.Origin + CallbackPath)
	if err != nil {
		refuseErr(w, err)
		return
	}
	if !h.setFlow(w, l, f) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"flowId": f.ID, "authorizeUrl": authorizeURL})
}

func (h *Host) finishTrial(w http.ResponseWriter, r *http.Request, l Listener) {
	if !l.Loopback {
		notFound(w)
		return
	}
	id := r.PathValue("flowId")
	report, keep, err := h.OAuth.FinishTrial(h.flow(r, id))
	if !keep && domain.FlowIDPattern.MatchString(id) {
		if _, err := r.Cookie(flowPrefix + id); err == nil {
			clearCookie(w, l, flowPrefix+id, googlePath, http.SameSiteLaxMode)
		}
	}
	if err != nil {
		refuse(w, domain.CodeOf(err))
		return
	}
	writeJSON(w, http.StatusOK, report)
}
