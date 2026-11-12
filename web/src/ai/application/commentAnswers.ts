// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A persona's answer in a margin thread, written into the thread and never
// into a chat. It takes no run slot: a margin reply and a chat's run may both
// be live, each with its own abort and its own search pause. The aggregate
// lends what a reply reads of it through `CommentAnswerHost`.

import type { AssistantDependencies } from "./assistantTypes";
import { now } from "./runRecords";
import { newId } from "./ids";
import { composeCommentReply, readsAsReader, roomOf } from "./commentReply";
import { allowedSourceIds } from "./context";
import { SearchPause } from "./searchAsk";
import { textThrough } from "../domain/comments";
import { PERSONAS } from "../domain/personas";
import { readerExtras } from "../domain/sourceView";
import type {
  ModelRef,
  RunActivity,
  SearchAnswer,
  SearchAsk,
  SourceDescriptor,
} from "../domain/types";
import { withHost } from "./features";

export type MarginAnswer =
  { ok: true } | { ok: false; reason: "unavailable" | "no-model" | "failed" };

/**
 * A margin reply's web search in front of the writer: the ask, and the two
 * functions the thread's card answers it by. The same ask a chat shows,
 * reached by the card that waits on the reply rather than by the dock.
 */
export interface MarginAsk {
  ask: SearchAsk;
  /** The writer's answer; false when this ask cannot take it. */
  answer(answer: SearchAnswer): boolean;
  /** Whether an edited query repeats the writer's words. */
  holdsBookWords(query: string): boolean;
}

/** The thread a reply answers, and the persona answering it. */
export interface CommentRequest {
  nodeId: string;
  threadId: string;
  personaId: string;
}

/** What a margin reply reads of the aggregate, named one by one. */
export interface CommentAnswerHost {
  dependencies: Pick<
    AssistantDependencies,
    "comments" | "model" | "projectFacts" | "sources" | "webSearch"
  >;
  isDisposed: () => boolean;
  /** The model the writer last chose for a chat. */
  seedModel: () => ModelRef | null;
  listCatalogue: () => Promise<SourceDescriptor[]>;
  /** The replies being written; leaving the project stops them. */
  marginRuns: Set<AbortController>;
}

/**
 * A persona's answer in a margin thread. It runs on a chat's own loop and
 * read-only tools. A reader persona reads the book only up to this chapter,
 * and this chapter only as far as the passage.
 *
 * Answered by the model the writer last chose for a chat, because a margin
 * has no model of its own. The outcome is the caller's to show: nothing here
 * publishes to the panel, which is about chats.
 *
 * Refused rather than guessed when the chapter is outside what the persona
 * may read: barred by the writer, gone from the book, or (for a reader) a
 * passage it cannot find the end of.
 */
export async function answerComment(
  host: CommentAnswerHost,
  request: CommentRequest,
  /** What the run is doing, for the card that waits on it; null between. */
  onActivity?: (activity: RunActivity | null) => void,
  /** A search waiting on the writer's word, or null once answered. */
  onAsk?: (ask: MarginAsk | null) => void,
): Promise<MarginAnswer> {
  const port = host.dependencies.comments;
  const persona = PERSONAS.find((one) => one.id === request.personaId);
  if (!port || !persona || host.isDisposed())
    return { ok: false, reason: "unavailable" };
  const modelRef = host.seedModel();
  if (!modelRef) return { ok: false, reason: "no-model" };
  const abort = new AbortController();
  host.marginRuns.add(abort);
  try {
    const catalog = await host.listCatalogue();
    const source = catalog.find(
      (one) => one.kind === "manuscript" && one.nodeId === request.nodeId,
    );
    if (!source) return { ok: false, reason: "unavailable" };
    const [margin] = await port.threadsOf([request.nodeId]);
    const thread = margin?.threads.find((one) => one.id === request.threadId);
    if (!thread) return { ok: false, reason: "unavailable" };
    const reader = readsAsReader(persona);
    const whole = (await host.dependencies.sources.read(source.id)).text;
    const text =
      reader && thread.passage ? textThrough(whole, thread.passage) : whole;
    if (text === null) return { ok: false, reason: "unavailable" };
    // A reader's book ends at this chapter, as a reader chat's ends at its
    // horizon, with the same few extras its room reads beside it.
    const horizon = reader
      ? new Set([
          ...(await host.dependencies.sources.allowedReaderSources({
            kind: "through",
            nodeId: request.nodeId,
          })),
          ...readerExtras(roomOf(persona), catalog).map((one) => one.id),
        ])
      : null;
    const answer = await composeCommentReply(
      {
        model: host.dependencies.model,
        modelRef,
        projectFacts: host.dependencies.projectFacts,
        personas: PERSONAS,
        sources: host.dependencies.sources,
        catalog,
        allowed: allowedSourceIds(catalog, horizon),
        comments: port,
        ...(onAsk
          ? {
              searchPause:
                marginPauseFor(
                  host,
                  modelRef,
                  abort.signal,
                  onAsk,
                  onActivity,
                ) ?? undefined,
            }
          : {}),
      },
      {
        persona,
        chapter: { sourceId: source.id, title: source.title, text },
        thread,
        margin: margin ?? null,
      },
      abort.signal,
      onActivity,
    );
    if (host.isDisposed()) return { ok: false, reason: "unavailable" };
    await port.reply(
      request.nodeId,
      request.threadId,
      persona.id,
      answer.text,
      answer.searched,
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    host.marginRuns.delete(abort);
  }
}

/**
 * The search pause of one margin reply, or null where no search
 * can be offered: no search port, or no account to search under. Nothing is
 * written ahead of a send, unlike a chat: what the margin keeps of a search
 * is on the reply's entry, and a reply that fails writes nothing at all.
 */
function marginPauseFor(
  host: CommentAnswerHost,
  model: ModelRef,
  signal: AbortSignal,
  onAsk: (ask: MarginAsk | null) => void,
  onActivity?: (activity: RunActivity | null) => void,
): ((bookTexts: () => readonly string[]) => SearchPause) | null {
  const webSearch = host.dependencies.webSearch;
  const account = webSearch?.accountId() ?? null;
  if (!webSearch || account === null) return null;
  return (bookTexts) => {
    const pause: SearchPause = new SearchPause({
      webSearch,
      model,
      account,
      signal,
      now,
      newId,
      lastWebIndex: 0,
      bookTexts,
      onAsk: (ask) => {
        if (host.isDisposed()) return;
        onAsk(
          ask
            ? {
                ask,
                answer: (answer) => pause.answer(ask.askId, answer),
                holdsBookWords: (query) =>
                  pause.holdsBookWords(ask.askId, query),
              }
            : null,
        );
        onActivity?.(ask ? { kind: "awaiting-writer" } : null);
      },
      onActivity: (activity) => onActivity?.(activity),
      onRecords: async () => undefined,
    });
    return pause;
  };
}

/** A persona's answers in the margin, bound to the aggregate. */
export function bind(host: CommentAnswerHost) {
  return { answer: withHost(host, answerComment) };
}
