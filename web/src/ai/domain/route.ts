// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { takeBlocks } from "./blocks";
import { CHAT_KINDS, type ChatKind, type ChatRoute } from "./types";

// A pointer to another chat, made a button. When a request belongs to another
// chat, the answer ends in a `<room>` block naming that chat by its kind id
// and, for a reader, the last Section it should read
// (`<room>beta-reader through node:abc</room>`). The app draws a button that
// creates the chat with the horizon filled in; the room never runs the other
// room's job itself.
//
// The block is a suggestion the writer may take, and the app checks it first.
// A kind that is not a chat, the chat the writer is already in, or a Section
// the book does not hold is dropped rather than offered.

/** The kinds that read up to a Section rather than the whole book. */
const READERS: readonly ChatKind[] = ["alpha-reader", "beta-reader"];

/**
 * The answer with its `<room>` block taken out, and the chat it points to
 * when the block names one worth offering. `from` is the asking chat's kind;
 * `sections` holds the node ids a reader may be pointed through.
 */
export function splitRoute(
  text: string,
  from: ChatKind,
  sections: ReadonlySet<string>,
): { answer: string; route?: ChatRoute } {
  const { answer, inner } = takeBlocks(text, "room");
  const said = inner.join(" ").replace(/\s+/g, " ").trim();
  const match = /^([a-z-]+)(?:\s+through\s+(?:node:)?(\S+))?/i.exec(said);
  if (!match) return { answer };
  const kind = match[1].toLowerCase() as ChatKind;
  if (!CHAT_KINDS.includes(kind) || kind === from) return { answer };
  const through = match[2]?.replace(/[.,;]+$/, "");
  return {
    answer,
    route:
      through && READERS.includes(kind) && sections.has(through)
        ? { kind, through }
        : { kind },
  };
}
