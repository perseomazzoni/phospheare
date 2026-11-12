// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a failure means to the writer, read from whatever was thrown. The kind
// decides the page's words and its way forward; the thrown value itself never
// reaches the page, because its message and stack are English internals.

export type FaultKind =
  "stale-build" | "not-found" | "unreachable" | "unexpected";

export interface Fault {
  kind: FaultKind;
}

// A chunk this tab's build names and the program serving the app does not
// hold: it serves a newer build, and this tab predates it. Each engine words
// the failed dynamic import its own way (Chromium, Gecko, WebKit), and Vite's
// CSS preload adds its own.
const STALE_BUILD = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
];

/**
 * Whether the failure is a breakage. A newer build and a wrong address leave
 * nothing broken: the app works, and the page only says where to go.
 */
export function somethingBroke(kind: FaultKind): boolean {
  return kind !== "stale-build" && kind !== "not-found";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/** A thrown answer with an HTTP status, such as a route response. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * Sorts a thrown value into the kind of page it deserves.
 *
 * @param online The browser's own connectivity verdict. Offline, a missing
 * chunk is a network fact, not a newer build, and a reload cannot fetch it.
 */
export function classify(error: unknown, online: boolean): Fault {
  const message = messageOf(error);
  const status = statusOf(error);
  const stale = STALE_BUILD.some((pattern) => pattern.test(message));

  if ((stale || status === 0) && !online) return { kind: "unreachable" };
  if (stale) return { kind: "stale-build" };
  if (status === 0) return { kind: "unreachable" };
  if (status === 404) return { kind: "not-found" };
  return { kind: "unexpected" };
}
