// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  ENTRY_BODY_MAX,
  LINKS_PER_SEARCH_MAX,
  NAME_MAX,
  QUERY_MAX,
  SEARCHES_PER_ENTRY_MAX,
  TITLE_MAX,
  URL_MAX,
} from "./limits";
import type {
  Author,
  CommentAnchor,
  CommentsFile,
  Dismissal,
  Entry,
  Searched,
  Thread,
  ThreadState,
  Weight,
} from "./model";

// Reading and writing `comments/<nodeId>.json`.
//
// The file is the writer's: it lives in their project, in Local Storage or
// Remote Storage, and anything may have touched it. So it is read strictly:
// a value of the wrong shape makes the whole file damaged rather than being
// guessed at. A damaged file is never overwritten: the chapter says its
// comments could not be read, and the file stays for the writer to look at.
// There is no version field and no migration: when the shape changes, it
// changes.
//
// Every body, from anyone, is plain text. Characters that are not text to a
// reader (zero-width and direction controls, which can hide words or turn a
// line around) are taken out on the way in, and a body is held to its cap.

export type ReadResult =
  { ok: true; file: CommentsFile } | { ok: false; reason: "damaged" };

const STATES: readonly ThreadState[] = ["proposed", "open", "resolved"];
const WEIGHTS: readonly Weight[] = ["major", "minor", "observation"];

// Zero-width characters, the bidirectional controls and the BOM.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** A body as the file keeps it: plain, visible, capped. */
export function cleanBody(text: string, max = ENTRY_BODY_MAX): string {
  return text
    .replace(INVISIBLE, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

/**
 * A persona's note held to its cap at the end of a sentence, with an
 * ellipsis saying it was held: a note cut mid-word reads as the persona's
 * own words, and a writer cannot tell it was not. Only where no sentence
 * ends in the second half of the room is it cut at a space instead.
 */
export function clipNote(text: string, max: number): string {
  const whole = cleanBody(text, Number.POSITIVE_INFINITY);
  if (whole.length <= max) return whole;
  const room = whole.slice(0, max - 1);
  let end = -1;
  for (const match of room.matchAll(/[.!?…]["”’»)]?(?=\s)/g))
    end = match.index + match[0].length;
  if (end < max / 2) end = room.lastIndexOf(" ");
  return `${room.slice(0, end > 0 ? end : room.length).trimEnd()} …`;
}

class Damaged extends Error {}

function fail(): never {
  throw new Damaged();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
}

function text(value: unknown): string {
  return typeof value === "string" ? value : fail();
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail();
}

function author(value: unknown): Author {
  const raw = record(value);
  switch (raw.kind) {
    case "writer":
      return { kind: "writer" };
    case "editor":
      return { kind: "editor", name: cleanBody(text(raw.name), NAME_MAX) };
    case "persona":
      return { kind: "persona", id: text(raw.id) };
    default:
      return fail();
  }
}

function anchor(value: unknown): CommentAnchor | null {
  if (value === null) return null;
  const raw = record(value);
  const quote = text(raw.quote);
  if (!quote) fail();
  return { quote, prefix: text(raw.prefix), suffix: text(raw.suffix) };
}

/**
 * A page address the card may link to: http or https, and nothing else. A
 * `javascript:` or `data:` address in a hand-edited file must never become
 * a link the writer clicks. Null for anything else.
 */
export function pageAddress(value: string): string | null {
  if (value.length > URL_MAX) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * A reply's searches as the file keeps them, from what a run reports: a
 * link that is not a web page is dropped, every text is plain and capped,
 * and there are never more than the caps allow. Null when none is left.
 */
export function cleanSearched(
  searches: readonly Searched[],
): readonly Searched[] | null {
  const kept = searches
    .slice(0, SEARCHES_PER_ENTRY_MAX)
    .flatMap((one): Searched[] => {
      const query = cleanBody(one.query, QUERY_MAX);
      if (!query || (one.engine !== "wikipedia" && one.engine !== "web"))
        return [];
      const links = one.links.slice(0, LINKS_PER_SEARCH_MAX).flatMap((link) => {
        const url = pageAddress(link.url);
        return url ? [{ url, title: cleanBody(link.title, TITLE_MAX) }] : [];
      });
      return [{ engine: one.engine, query, links }];
    });
  return kept.length > 0 ? kept : null;
}

function searched(value: unknown): Searched {
  const raw = record(value);
  const engine = text(raw.engine);
  if (engine !== "wikipedia" && engine !== "web") fail();
  const links = list(raw.links);
  if (links.length > LINKS_PER_SEARCH_MAX) fail();
  return {
    engine,
    query: cleanBody(text(raw.query), QUERY_MAX),
    links: links.map((one) => {
      const link = record(one);
      return {
        url: pageAddress(text(link.url)) ?? fail(),
        title: cleanBody(text(link.title), TITLE_MAX),
      };
    }),
  };
}

function entry(value: unknown): Entry {
  const raw = record(value);
  const out: Entry = {
    id: text(raw.id),
    author: author(raw.author),
    at: text(raw.at),
    body: cleanBody(text(raw.body)),
  };
  if (raw.searched !== undefined) {
    const searches = list(raw.searched);
    if (searches.length > SEARCHES_PER_ENTRY_MAX) fail();
    out.searched = searches.map(searched);
  }
  return out;
}

function thread(value: unknown): Thread {
  const raw = record(value);
  const state = text(raw.state) as ThreadState;
  if (!STATES.includes(state)) fail();
  const entries = list(raw.entries).map(entry);
  if (entries.length === 0) fail();
  const out: Thread = {
    id: text(raw.id),
    state,
    anchor: anchor(raw.anchor),
    entries,
  };
  if (raw.weight !== undefined) {
    const weight = text(raw.weight) as Weight;
    if (!WEIGHTS.includes(weight)) fail();
    out.weight = weight;
  }
  return out;
}

function dismissal(value: unknown): Dismissal {
  const raw = record(value);
  return {
    persona: text(raw.persona),
    quote: text(raw.quote),
    gist: text(raw.gist),
    at: text(raw.at),
  };
}

/** The file's text read strictly; any surprise is a damaged file. */
export function readComments(raw: string): ReadResult {
  try {
    const root = record(JSON.parse(raw));
    const threads = list(root.threads).map(thread);
    const dismissed = list(root.dismissed).map(dismissal);
    const ids = new Set<string>();
    for (const one of threads) {
      if (ids.has(one.id)) fail();
      ids.add(one.id);
    }
    return { ok: true, file: { threads, dismissed } };
  } catch {
    return { ok: false, reason: "damaged" };
  }
}

/** The file's text: stable key order, two-space indent, a final newline. */
export function writeComments(file: CommentsFile): string {
  const threads = file.threads.map((one) => ({
    id: one.id,
    state: one.state,
    anchor: one.anchor,
    ...(one.weight ? { weight: one.weight } : {}),
    entries: one.entries.map((e) => ({
      id: e.id,
      author: e.author,
      at: e.at,
      body: e.body,
      ...(e.searched ? { searched: e.searched } : {}),
    })),
  }));
  return `${JSON.stringify({ threads, dismissed: file.dismissed }, null, 2)}\n`;
}
