// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Where a remote provider is connected. Lets the editor start a provider
// approval without loading the web application, so it keeps no imports and
// no side effects; anything heavier than an address reaches the editor as a
// registered callback.
//
// A renewal must not unmount an editor holding unsaved prose, so it runs in a
// popup, and the vendor sends its answer back to the popup's address.

/** The popup's own route, on the app's origin, where the vendor returns. */
export function connectPopupPath(providerId: string): string {
  return `/app/connect/${encodeURIComponent(providerId)}`;
}

/**
 * The window name, shared so a second click, from Settings or the editor's
 * failure strip, reuses the open window rather than racing two flows to store
 * a key. Neutral, like every name the browser keeps.
 */
export const CONNECT_WINDOW = "connect";

/**
 * `noopener=no` because the tab that asks needs the window's handle: it sends
 * the window on to the vendor and watches it close. The window's own handle
 * on the tab is cut by the connection module before it leaves this origin.
 */
export const CONNECT_WINDOW_FEATURES =
  "popup=yes,width=520,height=680,noopener=no";

let connector: ((providerId: string) => void) | null = null;

/**
 * Installs the approval flow, from `host/openrouterConnection.ts`, so
 * the editor reaches it through this module without importing it.
 */
export function setConnector(run: (providerId: string) => void): void {
  connector = run;
}

/**
 * Starts the approval for a provider, to connect, renew an expired key or
 * replace a spent one, which are the same flow. Call it straight from a
 * click with no await before it, because Safari and Firefox check the gesture
 * chain. Nothing reports back through here: the connection module re-reads
 * the key when the flow ends, and the surfaces re-render.
 */
export function openConnectPopup(providerId: string): void {
  connector?.(providerId);
}
