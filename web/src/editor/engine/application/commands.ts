// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The command bus. A command is a named, pure transformation of the
// session's state: `run(ctx)` returns the next doc and selection, or null
// when nothing changes, which means no history entry and no notification.
// The session is the only caller of `execute`.
//
// The validation interceptor makes each outcome pass the session invariants,
// so a doc the engine holds is either one a codec produced or one a
// validated command produced.

import type { Doc, Selection } from "../domain/model";
import { validateSession } from "../domain/invariants";
import type { Codec } from "../ports/codec";
import type { HistoryStore } from "../ports/history";
import type { SearchProvider } from "../ports/search";
import type { ClipboardCodec } from "../ports/clipboard";

export interface CommandContext {
  doc: Doc;
  selection: Selection;
  codec: Codec;
  history: HistoryStore;
  search: SearchProvider;
  clipboard: ClipboardCodec;
}

export interface CommandOutcome<T = void> {
  doc: Doc;
  /**
   * The complete resulting selection. Editing commands collapse it onto the
   * cursor; formatting commands preserve it.
   */
  selection: Selection;
  value?: T;
}

export interface Command<T = void> {
  readonly type: string;
  readonly run: (ctx: CommandContext) => CommandOutcome<T> | null;
}

export type CommandInterceptor = (
  ctx: CommandContext,
  outcome: CommandOutcome<unknown>,
) => void;

export interface CommandBus {
  execute<T>(command: Command<T>): CommandOutcome<T> | null;
  addInterceptor(interceptor: CommandInterceptor): () => void;
}

export function createCommandBus(getContext: () => CommandContext): CommandBus {
  const interceptors: CommandInterceptor[] = [];
  return {
    execute<T>(command: Command<T>): CommandOutcome<T> | null {
      const ctx = getContext();
      const outcome = command.run(ctx);
      if (outcome === null) return null;
      for (const interceptor of interceptors) interceptor(ctx, outcome);
      return outcome;
    },
    addInterceptor(interceptor: CommandInterceptor): () => void {
      interceptors.push(interceptor);
      return () => {
        const i = interceptors.indexOf(interceptor);
        if (i !== -1) interceptors.splice(i, 1);
      };
    },
  };
}

/**
 * Throws when a command's outcome breaks the session invariants, at the
 * layer that produced it rather than later as a render bug. Off in
 * production, where it would tax the hot path.
 */
export function validationInterceptor(
  enabled: boolean = import.meta.env.DEV,
): CommandInterceptor {
  if (!enabled) return () => {};
  return (_ctx, outcome) => {
    if (!validateSession(outcome.doc, outcome.selection)) {
      throw new Error("a command produced an invalid session state");
    }
  };
}
