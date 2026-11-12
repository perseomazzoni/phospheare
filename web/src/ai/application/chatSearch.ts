// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The project search's documents for the chats, built from the last search's
// index so a chat found unchanged is not built again. A pure function of the
// last index, the chats, the titles and the caller's answer text; the
// aggregate holds the index between calls and drops it on `dispose`.

import type { AnswerText, ChatSearchDocument } from "./assistantTypes";
import { citableTitles } from "../domain/citations";
import { commandLine } from "../domain/skills";
import {
  NO_WEB_CITATIONS,
  webCitations,
  type WebCitations,
} from "../domain/webCitations";
import type { ChatRecord } from "../domain/types";

/** One chat's search documents, and the walk they were built from. */
type IndexedChat = {
  chat: ChatRecord;
  walk: Map<string, WebCitations>;
  documents: readonly ChatSearchDocument[];
};

/** The last search's documents per chat, keyed by its titles and builder. */
export interface SearchIndex {
  titles: ReadonlyMap<string, string>;
  answerText: AnswerText;
  chats: Map<string, IndexedChat>;
}

/**
 * Every chat's documents, reusing the last index's entry for a chat that is
 * the same record under the same titles and builder.
 */
export function searchDocuments(
  index: SearchIndex | null,
  records: readonly ChatRecord[],
  titles: ReadonlyMap<string, string>,
  answerText: AnswerText,
): { index: SearchIndex; documents: ChatSearchDocument[] } {
  // Spelled out, not `index?.answerText === answerText`: with no index and
  // no builder (a caller outside the types) that reads undefined ===
  // undefined, and the next operand throws.
  const reuse =
    index !== null &&
    index.answerText === answerText &&
    index.titles === titles;
  const chats = new Map<string, IndexedChat>();
  const documents: ChatSearchDocument[] = [];
  for (const chat of records) {
    const kept = index?.chats.get(chat.id);
    const entry =
      reuse && kept?.chat === chat
        ? kept
        : indexChat(chat, titles, answerText, kept?.walk);
    chats.set(chat.id, entry);
    // Not a spread: one chat's documents as arguments could pass the
    // engine's argument limit.
    for (const document of entry.documents) documents.push(document);
  }
  return { index: { titles, answerText, chats }, documents };
}

/** One chat's documents, built fresh and frozen, walking from `previous`. */
function indexChat(
  chat: ChatRecord,
  titles: ReadonlyMap<string, string>,
  answerText: AnswerText,
  previous: Map<string, WebCitations> | undefined,
): IndexedChat {
  const web = webCitations(
    chat.turns,
    undefined,
    previous,
    chat.searchedBefore,
  );
  const documents: ChatSearchDocument[] = [];
  for (const turn of chat.turns) {
    // A command's question is found as the line the writer typed, which
    // is what its bubble shows, never as a rubric they did not write.
    const text =
      turn.role === "assistant"
        ? answerText(turn, {
            titles: citableTitles(turn, titles),
            web: web.get(turn.id) ?? NO_WEB_CITATIONS,
          })
        : turn.command
          ? commandLine(turn.command)
          : turn.text;
    documents.push(
      Object.freeze({
        chatId: chat.id,
        turnId: turn.id,
        title: chat.title,
        kind: chat.kind,
        speaker: turn.role === "user" ? "you" : "assistant",
        text: turn.quote ? `${turn.quote}\n${text}` : text,
      } as const),
    );
  }
  return { chat, walk: web, documents: Object.freeze(documents) };
}
