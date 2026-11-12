// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The in-memory adapter for the `EventBus` port: a `Set` of handlers per
// type. Iterating a `Set` means a handler that unsubscribes or subscribes
// again during an emit never breaks the loop, and every handler registered
// at emit time is called once.

import type { EventBus } from "../ports/events";

export class Emitter<
  M extends Record<string, unknown[]>,
> implements EventBus<M> {
  private handlers = new Map<keyof M, Set<(...args: unknown[]) => void>>();

  on<K extends keyof M>(type: K, handler: (...args: M[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (...args: unknown[]) => void);
    return () => {
      set.delete(handler as (...args: unknown[]) => void);
    };
  }

  emit<K extends keyof M>(type: K, ...args: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of set) handler(...args);
  }

  clear(): void {
    this.handlers.clear();
  }
}
