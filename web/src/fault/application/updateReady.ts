// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// "A newer version is ready": set when a chunk fails outside a route render,
// such as a theme sheet or the export window. It never reloads the tab, which
// may hold unsaved work; it waits for the writer.
//
// It stays quiet while a fault page is up, because that page already says the
// same thing with its own Reload.

export type UpdateReady = ReturnType<typeof createUpdateReady>;

export function createUpdateReady() {
  let ready = false;
  let pages = 0;
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((listener) => listener());

  return {
    mark(): void {
      if (ready) return;
      ready = true;
      tell();
    },

    /** Counts a fault page on screen; the returned function takes it off. */
    pageShown(): () => void {
      pages += 1;
      tell();
      let gone = false;
      return () => {
        if (gone) return;
        gone = true;
        pages -= 1;
        tell();
      };
    },

    /** Whether the notice speaks: an update is ready and no page says so. */
    showing(): boolean {
      return ready && pages === 0;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
