// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatKind } from "./types";

// What a chat is called before anyone names it.
//
// Stored English, not a locale string: the title is written into the chat
// file, where it outlives the language the app was in when the chat was made.
//
// A stored default is never shown as stored. It stands for the kind's name,
// and the screen says that name in the writer's language
// (`isDefaultChatTitle`).

export const DEFAULT_CHAT_TITLES: Record<ChatKind, string> = {
  general: "New chat",
  drafting: "Drafting",
  "alpha-reader": "Alpha reader",
  "beta-reader": "Beta reader",
  editorial: "Editorial review",
};

/**
 * Whether a chat still carries the name it was made with — its kind's, which
 * the screen translates — rather than one the writer, a first request or the
 * summariser gave it.
 */
export function isDefaultChatTitle(title: string, kind: ChatKind): boolean {
  return title === DEFAULT_CHAT_TITLES[kind];
}
