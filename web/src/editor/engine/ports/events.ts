// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `EventBus` port: the session emits `doc` and `selection` through a bus
// and views subscribe to it. Nothing in the application may reach for a
// concrete emitter.
//
// Contract, for every adapter:
//
//   1. `on` registers a handler; `emit` calls every registered handler with
//      the emitted arguments unchanged.
//   2. The unsubscribe function returned by `on` removes that handler only;
//      a second call to it is a no-op.
//   3. Registering the same handler twice is deduplicated, so it fires once
//      per emit.
//   4. `clear` removes every handler of every type.
//   5. Emitting a type with no handlers is a no-op and never throws.

export interface EventBus<M extends Record<string, unknown[]>> {
  on<K extends keyof M>(type: K, handler: (...args: M[K]) => void): () => void;
  emit<K extends keyof M>(type: K, ...args: M[K]): void;
  clear(): void;
}
