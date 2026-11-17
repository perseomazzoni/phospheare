// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useRef, useState, type ReactNode } from "react";
import { respondersTo, type Mentionable } from "../domain/mentions";
import type { Entry, Thread } from "../domain/model";
import { appLog, describeError } from "../../../log";

/** A stopped run is not a failure: an abort, or a model run cancelled. */
function cancelled(err: unknown): boolean {
  const found = err as {
    name?: unknown;
    failure?: { code?: unknown };
  } | null;
  return found?.name === "AbortError" || found?.failure?.code === "cancelled";
}

// Personas answering in the margin. The writer writes in a thread, and
// whoever that entry calls answers: the personas it tags, in the order it
// tags them, or with no tag the persona whose thread it is (`respondersTo`).
// Each answer is one run of the assistant's, handed in as `answer`, so the
// margin never learns there is an assistant; with none (the demo) nobody
// answers and nothing waits.
//
// One thread answers one persona at a time: two tagged in one entry answer
// in turn, the second reading the first's note. While one writes, the card
// says who. An answer that did not come says so, with a way to ask again,
// and is never written into the thread, so a failure leaves no half-note
// behind.

/** What a thread's card says about an answer being written or failed. */
export interface ReplyState {
  /** The persona writing an answer right now. */
  writing?: string | null;
  /**
   * What that answer is doing on its way, in the editor's words (reading a
   * chapter, searching), or null while it only thinks and writes.
   */
  doing?: string | null;
  /**
   * A web search that answer wants, waiting on the writer's word:
   * the editor's own ask, drawn in the card. The margin never learns what
   * it is, only where it goes.
   */
  asking?: ReactNode;
  /** The persona whose answer did not come, with a way to ask again. */
  failed?: { name: string; retry: () => void } | null;
}

export type MarginAnswerer = (
  request: {
    nodeId: string;
    threadId: string;
    personaId: string;
  },
  /** Told what the answer is doing, as it changes; null between. */
  onDoing?: (line: string | null) => void,
  /** Told of a search waiting on the writer, drawn; null once answered. */
  onAsking?: (ask: ReactNode | null) => void,
) => Promise<{ ok: boolean }>;

export function useMarginAnswers(
  answer: MarginAnswerer | null,
  personas: readonly Mentionable[],
): {
  onWriterEntry?: (nodeId: string, thread: Thread, entry: Entry) => void;
  replyState: (threadId: string) => ReplyState | undefined;
} {
  const [states, setStates] = useState<ReadonlyMap<string, ReplyState>>(
    () => new Map(),
  );
  const lanes = useRef(new Map<string, Promise<void>>());

  const put = useCallback((threadId: string, state: ReplyState | null) => {
    setStates((before) => {
      const next = new Map(before);
      if (state) next.set(threadId, state);
      else next.delete(threadId);
      return next;
    });
  }, []);

  const run = useCallback(
    (nodeId: string, threadId: string, persona: Mentionable) => {
      if (!answer) return;
      const job = async () => {
        // One state per answer, each change merged into it, so a line about
        // what it reads never clears the ask waiting beside it.
        let state: ReplyState = { writing: persona.name };
        const show = (change: ReplyState) => {
          state = { ...state, ...change };
          put(threadId, state);
        };
        put(threadId, state);
        const outcome = await answer(
          { nodeId, threadId, personaId: persona.id },
          (doing) => show({ doing }),
          (asking) => show({ asking }),
        ).catch((err: unknown) => {
          if (!cancelled(err))
            appLog.warn("comments", "A persona's answer failed.", {
              persona: persona.id,
              ...describeError(err),
            });
          return { ok: false };
        });
        put(
          threadId,
          outcome.ok
            ? null
            : {
                failed: {
                  name: persona.name,
                  retry: () => run(nodeId, threadId, persona),
                },
              },
        );
      };
      const next = (lanes.current.get(threadId) ?? Promise.resolve()).then(job);
      lanes.current.set(threadId, next);
    },
    [answer, put],
  );

  const onWriterEntry = useCallback(
    (nodeId: string, thread: Thread, entry: Entry) => {
      for (const id of respondersTo(thread, entry, personas)) {
        const persona = personas.find((one) => one.id === id);
        if (persona) run(nodeId, thread.id, persona);
      }
    },
    [personas, run],
  );

  const replyState = useCallback(
    (threadId: string) => states.get(threadId),
    [states],
  );

  return { ...(answer ? { onWriterEntry } : {}), replyState };
}
