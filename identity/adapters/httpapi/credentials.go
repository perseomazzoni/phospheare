// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi

import (
	"net/http"

	"github.com/perseomazzoni/phospheare/identity/domain"
)

// Kept credentials: a writer's OpenRouter key sealed in its own
// cookie, which only this service opens, and only for that writer's session
// with its proof. The browser still calls OpenRouter itself; the service
// never relays a model call, it only seals and opens the key.

const (
	credentialPrefix = "phospheare_k_"
	sealCredential   = "phospheare_k:"

	// credentialPath scopes the cookies to these routes, so no other
	// request carries a kept key.
	credentialPath = "/identity/credentials"
)

func credentialCookie(writerID, name string) string {
	return credentialPrefix + domain.CredentialSlot(writerID, name)
}

// credentialName answers the request's credential name, or "" after
// answering 404 for a name this service does not keep.
func credentialName(w http.ResponseWriter, r *http.Request) string {
	name := r.PathValue("name")
	if !domain.CredentialNames[name] {
		notFound(w)
		return ""
	}
	return name
}

func (h *Host) keepCredential(w http.ResponseWriter, r *http.Request, l Listener) {
	name := credentialName(w, r)
	if name == "" {
		return
	}
	var body struct {
		Value string `json:"value"`
	}
	if !readJSON(r, &body) || !domain.ValidCredential(body.Value) {
		refuse(w, domain.CodeBadRequest)
		return
	}
	s := h.session(r)
	if s == nil {
		refuse(w, domain.CodeNoSession)
		return
	}
	sealed, err := h.Sealer.Seal(sealCredential+name, domain.CredentialClaims{
		V: 1, WriterID: s.WriterID, Name: name, Value: body.Value,
	})
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	setCookie(w, l, credentialCookie(s.WriterID, name), sealed, credentialPath, cookieMaxAge, http.SameSiteStrictMode)
	w.WriteHeader(http.StatusNoContent)
}

// openCredential answers the kept value. A cookie that does not open under
// the current keys, or holds another writer's claims, is cleared.
func (h *Host) openCredential(w http.ResponseWriter, r *http.Request, l Listener) {
	name := credentialName(w, r)
	if name == "" {
		return
	}
	s := h.session(r)
	if s == nil {
		refuse(w, domain.CodeNoSession)
		return
	}
	cookie := credentialCookie(s.WriterID, name)
	c, err := r.Cookie(cookie)
	if err != nil {
		refuse(w, domain.CodeNoCredential)
		return
	}
	var cc domain.CredentialClaims
	if h.Sealer.Open(sealCredential+name, c.Value, &cc) != nil ||
		cc.WriterID != s.WriterID || cc.Name != name || !domain.ValidCredential(cc.Value) {
		clearCookie(w, l, cookie, credentialPath, http.SameSiteStrictMode)
		refuse(w, domain.CodeNoCredential)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"value": cc.Value})
}

// forgetCredential clears the writer's kept value. It needs no session, as
// `closeSession` says, so the writer comes in the body.
func (h *Host) forgetCredential(w http.ResponseWriter, r *http.Request, l Listener) {
	name := credentialName(w, r)
	if name == "" {
		return
	}
	var body struct {
		WriterID string `json:"writerId"`
	}
	if !readJSON(r, &body) || !domain.WriterIDPattern.MatchString(body.WriterID) {
		refuse(w, domain.CodeBadRequest)
		return
	}
	clearCookie(w, l, credentialCookie(body.WriterID, name), credentialPath, http.SameSiteStrictMode)
	w.WriteHeader(http.StatusNoContent)
}
