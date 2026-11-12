// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { personaOf, type Entry, type Thread } from "./model";
import { escapeRegExp } from "../../../text/regExp";

// Who answers an entry. The writer brings a persona into a thread by tagging
// it (`@Spark`, `@Phos`), and each one tagged answers, once, in the order they
// were named. With no tag, an entry in a thread a persona opened is addressed
// to that persona and it answers. An entry in the writer's or an editor's
// thread with no tag is a note to self: nobody answers.

export interface Mentionable {
  id: string;
  name: string;
}

/** One tag in a body: the persona it names, and where its `@` stands. */
export interface Tag {
  id: string;
  start: number;
  /** Just past the name. */
  end: number;
}

/**
 * Every tag in a body, in reading order. A tag is `@` and a persona's name,
 * in any case, standing alone: not inside an address (`a@Phosphor.it`) and
 * not the start of a longer word (`@Novak`). One rule decides both who is
 * summoned and what the card draws as a tag, so a tag that looks like one is
 * one.
 */
export function tagsIn(body: string, personas: readonly Mentionable[]): Tag[] {
  const found: Tag[] = [];
  for (const persona of personas) {
    const escaped = escapeRegExp(persona.name);
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])@${escaped}(?![\\p{L}\\p{N}_])`,
      "giu",
    );
    for (const match of body.matchAll(pattern)) {
      const start = (match.index ?? 0) + match[1].length;
      found.push({
        id: persona.id,
        start,
        end: start + 1 + persona.name.length,
      });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The personas an entry names, first mention first, each once. */
export function mentionsIn(
  body: string,
  personas: readonly Mentionable[],
): string[] {
  return [...new Set(tagsIn(body, personas).map((tag) => tag.id))];
}

/** The personas who answer `entry`, just added to `thread`, in order. */
export function respondersTo(
  thread: Thread,
  entry: Entry,
  personas: readonly Mentionable[],
): string[] {
  if (entry.author.kind !== "writer") return [];
  const tagged = mentionsIn(entry.body, personas);
  if (tagged.length > 0) return tagged;
  const owner = personaOf(thread);
  return owner ? [owner] : [];
}
