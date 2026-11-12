// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// One named lock that every tab of the origin shares. The state it guards
// (the sync manifest, the queue's rows, the working copy) lives in IndexedDB
// and OPFS, which all tabs share, so a lock held by one tab only orders that
// tab. The browser's Web Locks serialize across tabs. Where the platform has
// none, a promise chain per name orders this tab, which is all there is.
//
// A body must never request the name it runs under: Web Locks are not
// re-entrant, and the inner request waits for the outer forever.

const chains = new Map<string, Promise<unknown>>();

export function exclusive<T>(name: string, run: () => Promise<T>): Promise<T> {
  const manager = globalThis.navigator?.locks;
  if (manager) return manager.request(name, () => run());
  const previous = chains.get(name) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => {});
  chains.set(name, settled);
  // Drop the chain once nothing queued behind it, so the map does not keep
  // one entry per name for the session.
  void settled.then(() => {
    if (chains.get(name) === settled) chains.delete(name);
  });
  return next;
}
