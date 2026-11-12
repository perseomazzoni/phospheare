// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"html"
	"net/http"
)

// callbackScript tells the page that opened the flow how it ended, on the
// `phospheare-oauth` BroadcastChannel and to `window.opener` restricted to this
// origin, then closes the window. The channel reaches the SPA even when a
// cross-origin hop through Google has severed `window.opener`. A window the
// script cannot close was a full-page redirect and returns to the page its
// `data-return` names, if any. The page carries only the flow id and the
// outcome, never a code or a token.
const callbackScript = `(function () {
  var m = document.querySelector('meta[name="phospheare-oauth"]');
  var msg = { type: "phospheare-oauth", flowId: m.getAttribute("data-flow") || null, status: m.getAttribute("data-status") };
  try { var bc = new BroadcastChannel("phospheare-oauth"); bc.postMessage(msg); bc.close(); } catch (e) {}
  var opener = null;
  try { opener = window.opener; } catch (e) {}
  if (opener) { try { opener.postMessage(msg, location.origin); } catch (e) {} }
  window.close();
  var back = m.getAttribute("data-return");
  if (back) setTimeout(function () { location.replace(back + encodeURIComponent(msg.flowId || "")); }, 400);
})();`

var callbackCSP = func() string {
	sum := sha256.Sum256([]byte(callbackScript))
	return "default-src 'none'; script-src 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) +
		"'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
}()

var callbackMessages = map[string]string{
	"done":      "Google answered. You can close this window.",
	"failed":    "Google sign-in did not complete. Go back to the app and try again.",
	"cancelled": "Google sign-in was cancelled. You can close this window.",
	"expired":   "This sign-in has expired. Go back to the app and start it again.",
}

// trialMessage is what a trial window says when it stays open: the setup
// page that started it already has the answer.
const trialMessage = "Google answered. Close this window and go back to the setup page."

// writeCallbackPage answers the page Google returns the browser to. A trial
// stays where it is: the setup page reads its report, and the app has no
// part in it.
func writeCallbackPage(w http.ResponseWriter, product, flowID, status string, trial bool) {
	back, message := "/app?oauth=", callbackMessages[status]
	if trial {
		back, message = "", trialMessage
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", callbackCSP)
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>` +
		html.EscapeString(product) + `</title><meta name="phospheare-oauth" data-flow="` + html.EscapeString(flowID) +
		`" data-status="` + html.EscapeString(status) + `" data-return="` + html.EscapeString(back) +
		`"><script>` + callbackScript + `</script></head><body><p>` + html.EscapeString(message) + `</p></body></html>`))
}
