// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatTurn } from "./types";
import { webSourceNumber } from "./webEngine";

// ── Source ids read as titles ────────────────────────────────────────────────
//
// The model cites a source by its id exactly as listed, because an
// id is the only unique handle it is shown: two Parts can each hold a
// "Capitolo 1". The writer never sees the id. The stored answer keeps the ids,
// since history replays the model's own words to it; every surface a person
// reads resolves them here.
//
// What counts as a citation is decided in `citationSegments` alone, so a
// drawn id is resolved and depth-checked in one place, whichever surface
// draws it.
//
// ── Web result citations ─────────────────────────────────────────────────────
//
// `web:N` is a third id kind, parsed rather than looked up: it is the app's
// own spelling (`webSourceNumber`), so no regex is built from data.
// It resolves only against the ids the caller passes, the turn's citable web
// sources (`webCitations`), and nothing here knows what a web source is, so
// the walk imports this file and never the reverse.
//
// Models write `(web:3)`, `[web:1, web:3]` and `1453 (web:1).`, so adjacent
// resolved ids are one group: separated by `,` `;` or whitespace, with at
// most one `()`/`[]` wrapper, taking the whitespace before it. The group
// reads as one marker on the word before it: "1453¹", and "1453[1,3]" in a
// copy. Not absorbed: a wrapper holding anything but resolved ids
// ("(see web:1)" keeps its brackets), an unresolved id (it breaks the group
// and stays as written, so a fabrication stays visible), and a `,` or `;`
// after an unwrapped group ("fonte web:1, che" → "fonte¹, che").
//
// ── Ids looked up, not parsed ────────────────────────────────────────────────
//
// Reference ids are file names (spaces, dots, accented letters,
// `reference:character--Maren Voss.md`), so no bounded character class
// describes them all, and a regex built out of the known ids is a regex built
// out of the writer's file names. Instead, every prefix occurrence is tried
// against the allowlist by exact map lookup, longest candidate first, up to a
// bounded length. The work per occurrence is bounded and nothing is compiled
// from data. An id nobody listed stays as the model wrote it: a title
// invented for a guess would be the app putting words in its mouth.

/** The prefixes the project adapter mints ids with (`projectAdapter.list`). */
const SOURCE_ID_PREFIXES = ["node:", "reference:"] as const;

const WEB_PREFIX = "web:";

/** The longest id tried, prefix included; a longer file name is not cited. */
const MAX_ID_LENGTH = 200;

/**
 * A character that would carry an id on. A match must not be followed by one:
 * `node:S1` is a prefix of `node:S12`, and a sentence ending `node:S1.` must
 * keep its full stop.
 */
const CONTINUES = /[\p{L}\p{N}_-]/u;

/** The web ids a text may resolve: only `has` is asked. */
export type CitableWeb = Pick<ReadonlySet<string>, "has">;

const NO_WEB: CitableWeb = new Set<string>();

export type CitationSegment =
  | { kind: "text"; text: string }
  | { kind: "cite"; id: string; title: string }
  /** A group of resolved web ids, and the source text it stands for. */
  | { kind: "web"; ids: string[]; text: string };

/**
 * `text` split into prose and citations, resolving only ids in `titles` and,
 * for `web:N`, in `web`.
 *
 * `final` is false while the answer is still streaming: an id that runs to
 * the very end of the text may be half an id (`node:S1` of a `node:S12` still
 * arriving), so it is left as text until something follows it, rather than
 * flashing the wrong title for a frame. A web group's wrapper still open at
 * the end is held the same way, whole, so a marker never draws as "(¹" and
 * then loses its bracket; once the answer is final, an unclosed wrapper is
 * just a bracket.
 *
 * No early return on an empty map: the scan is cheap, and such a guard would
 * keep the renderer's web groups from resolving.
 */
export function citationSegments(
  text: string,
  titles: ReadonlyMap<string, string>,
  final = true,
  web: CitableWeb = NO_WEB,
): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let plain = "";
  let index = 0;
  while (index < text.length) {
    const group = webGroupAt(text, index, web, final);
    if (group === "held") {
      plain += text.slice(index);
      break;
    }
    if (group) {
      // The group sits on the word before it: its leading space goes.
      const before = /\s+$/.exec(plain);
      const kept = before ? plain.slice(0, before.index) : plain;
      if (kept) segments.push({ kind: "text", text: kept });
      plain = "";
      segments.push({
        kind: "web",
        ids: group.ids,
        text: (before?.[0] ?? "") + text.slice(index, group.end),
      });
      index = group.end;
      continue;
    }
    const wrapped = sourceGroupAt(text, index, titles);
    if (wrapped) {
      if (plain) segments.push({ kind: "text", text: plain });
      plain = "";
      segments.push({ kind: "text", text: "(" });
      wrapped.cites.forEach((cite, at) => {
        if (at > 0) segments.push({ kind: "text", text: ", " });
        segments.push({ kind: "cite", ...cite });
      });
      segments.push({ kind: "text", text: ")" });
      index = wrapped.end;
      continue;
    }
    const match = citationAt(text, index, titles);
    if (match && (final || index + match.id.length < text.length)) {
      if (plain) segments.push({ kind: "text", text: plain });
      plain = "";
      segments.push({ kind: "cite", ...match });
      index += match.id.length;
      continue;
    }
    plain += text[index];
    index += 1;
  }
  if (plain) segments.push({ kind: "text", text: plain });
  return segments;
}

/**
 * `text` with every resolvable project id replaced by its title.
 *
 * No production caller: the copy and the chat search read the renderer's
 * tokens (`plainOf`), where depth and web groups are decided once. Kept for
 * the rows that pin it and as the flattener the assistant's tests hand
 * `searchDocuments`.
 */
export function citationsAsText(
  text: string,
  titles: ReadonlyMap<string, string>,
): string {
  return citationSegments(text, titles)
    .map((segment) => (segment.kind === "cite" ? segment.title : segment.text))
    .join("");
}

/**
 * A review finding's prose with every Section id it names (`node:EL7` or a
 * bare `EL7`) read as that Section's title, in quotation marks. A finding is
 * not an answer: its prose is drawn as plain text, never through the
 * citation renderer, and the model writes ids there anyway ("EL4 ed EL5 lo
 * descrivono come un bambino di tre anni"). An id with no title in `titles`
 * is left as written.
 */
export function namedByTitle(
  text: string,
  titles: ReadonlyMap<string, string>,
): string {
  return text.replace(/\b(?:node:)?(EL\d+)\b/g, (whole, id: string) => {
    const title = titles.get(`node:${id}`);
    return title ? `“${title}”` : whole;
  });
}

/**
 * The loose web id both scrubs read: one pattern, kept as a
 * source string, so each call builds its own expression. A shared `g` regex
 * carries its `lastIndex` from one call into the next and skips matches.
 */
const LOOSE_WEB_ID = String.raw`web\s*:\s*\d+`;

/**
 * `text` with every web id a model could read back as live taken out, for a
 * transcript that leaves this chat (Continue in a new chat).
 *
 * The new chat mints its ids from `web:1` again, so an old `web:4` carried in
 * its digest would resolve to a different page there. Looser than
 * `citationSegments`, as a second recogniser: that scan resolves, and
 * under-matching there leaves plain words, the safe side; this removes, and
 * over-matching here costs a word, the safe side. A compaction model reads
 * `Web: 4` and writes back `web:4`, so the loose forms go too. The
 * replacement holds no digit, so it never matches again, and the cited form
 * `(web:4)` reads `(web source)`.
 */
export function withoutWebIds(text: string): string {
  return text.replace(new RegExp(LOOSE_WEB_ID, "gi"), "web source");
}

/**
 * `text` with every web id removed, not replaced, for a `/verify` fix.
 * The fix is the one part of a verdict that must read as
 * unsourced: `withoutWebIds`' "(web source)" is right in a digest and a
 * false claim of sourcing here, so the two stay two helpers over one
 * recogniser. A bracket that held only ids goes with them, and the spaces
 * they leave close up.
 *
 * Removing an id can join its neighbours into a new one (`web:(web:1)3` →
 * `web:3`), so it repeats until none is left: every pass that finds an id
 * shortens the text, so it ends.
 */
export function strippedOfWebIds(text: string): string {
  const any = new RegExp(LOOSE_WEB_ID, "i");
  const group = new RegExp(
    String.raw`\s*[([]\s*${LOOSE_WEB_ID}(?:\s*[,;]?\s*${LOOSE_WEB_ID})*\s*[)\]]`,
    "gi",
  );
  const bare = new RegExp(LOOSE_WEB_ID, "gi");
  let left = text;
  while (any.test(left)) left = left.replace(group, "").replace(bare, "");
  return left.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:!?)\]])/g, "$1");
}

/**
 * Two title maps equal by value: the same ids with the same titles. A title
 * map is rebuilt whole from a listing, so identity says nothing about whether
 * a title changed.
 */
export function sameTitles(
  one: ReadonlyMap<string, string>,
  other: ReadonlyMap<string, string>,
): boolean {
  if (one.size !== other.size) return false;
  for (const [id, title] of one) if (other.get(id) !== title) return false;
  return true;
}

/**
 * The ids a turn may cite, with their titles: what the turn used (its
 * attached sources, the sources its calls read, and every source a search
 * drew excerpts from), and only those still in the live catalogue.
 *
 * Both halves are security rules. An id the model only saw in the
 * index and never read is not a source the answer rests on, and a reader
 * chat must not be shown the title of a later section because the model
 * guessed its id.
 */
export function citableTitles(
  turn: ChatTurn,
  catalogue: ReadonlyMap<string, string>,
): Map<string, string> {
  const used = new Set<string>([
    ...(turn.sources ?? []).map((source) => source.id),
    ...(turn.tools ?? []).flatMap((receipt) => [
      ...(receipt.sourceId ? [receipt.sourceId] : []),
      ...(receipt.sourceIds ?? []),
    ]),
  ]);
  const titles = new Map<string, string>();
  for (const id of used) {
    const title = catalogue.get(id);
    if (title !== undefined) titles.set(id, title);
  }
  return titles;
}

/**
 * A syntactically whole `web:N` at `index`, whether or not it resolves,
 * as its canonical id. The prefix is read in any case: a model starting a
 * sentence writes "Web:7", which would otherwise show raw.
 * Folding the case widens only the spelling; the id still resolves only
 * against the turn's own citable results, so "Web:9" with no ninth result
 * stays words.
 */
function webIdAt(
  text: string,
  index: number,
): { id: string; end: number } | null {
  if (text.slice(index, index + WEB_PREFIX.length).toLowerCase() !== WEB_PREFIX)
    return null;
  // Not the tail of a longer word: `xweb:1` is not a citation.
  if (index > 0 && CONTINUES.test(text[index - 1] as string)) return null;
  const start = index + WEB_PREFIX.length;
  let end = start;
  while (end < text.length && /[0-9]/.test(text[end] as string)) end += 1;
  if (end === start) return null;
  const next = text[end];
  if (next !== undefined && CONTINUES.test(next)) return null;
  const id = WEB_PREFIX + text.slice(start, end);
  return webSourceNumber(id) === null ? null : { id, end };
}

/** Whether `rest` is the start of a `web:` id still arriving. */
function webIdBegins(rest: string): boolean {
  const folded = rest.toLowerCase();
  return WEB_PREFIX.startsWith(folded) || /^web:[0-9]*$/.test(folded);
}

/** The run of separators at `index`: how far a group may reach past it. */
function separatorsAt(text: string, index: number): number {
  let end = index;
  while (end < text.length && /[\s,;]/.test(text[end] as string)) end += 1;
  return end;
}

const WRAPPERS: Readonly<Record<string, string>> = { "(": ")", "[": "]" };

type WebGroup = { ids: string[]; end: number } | "held" | null;

/**
 * The web group starting at `index`: its resolved ids and where it ends; or
 * "held" while streaming, for a wrapper or a lone id still open at the end of
 * the text; or null.
 */
function webGroupAt(
  text: string,
  index: number,
  web: CitableWeb,
  final: boolean,
): WebGroup {
  const close = WRAPPERS[text[index] as string];
  if (close) return wrappedGroupAt(text, index, close, web, final);
  const first = webIdAt(text, index);
  if (!first || !web.has(first.id)) return null;
  if (!final && first.end === text.length) return "held";
  const ids = [first.id];
  let end = first.end;
  for (;;) {
    const next = webIdAt(text, separatorsAt(text, end));
    if (!next || !web.has(next.id)) break;
    // A trailing id may be half an id: the group ends before it, for now.
    if (!final && next.end === text.length) break;
    ids.push(next.id);
    end = next.end;
  }
  return { ids, end };
}

/** A `(…)` or `[…]` holding resolved web ids and separators, nothing else. */
function wrappedGroupAt(
  text: string,
  index: number,
  close: string,
  web: CitableWeb,
  final: boolean,
): WebGroup {
  const ids: string[] = [];
  let at = index + 1;
  for (;;) {
    at = separatorsAt(text, at);
    if (at >= text.length) return final ? null : "held";
    if (text[at] === close) return ids.length > 0 ? { ids, end: at + 1 } : null;
    const id = webIdAt(text, at);
    // `(web:1, we` with the rest still arriving: held whole, never "(¹".
    if (!id) return !final && webIdBegins(text.slice(at)) ? "held" : null;
    if (!web.has(id.id)) return null;
    if (!final && id.end === text.length) return "held";
    ids.push(id.id);
    at = id.end;
  }
}

// ── Source ids inside brackets ───────────────────────────────────────────────
//
// Models wrap the ids they are told to write bare: `[node:EL15]`,
// `(reference:a.md; reference:b.md)`, and `【node:S1】【node:S2】`, whose
// glyphs would otherwise reach the writer around the titles. A bracket that
// holds resolved source ids and separators and nothing else is the model's
// citation markup, so it is drawn one way whatever the model typed: the
// titles in parentheses, comma-separated, and a run of such brackets with
// only space between them is one group. Anything else inside (a word, an id
// nobody lists) leaves the brackets as written, so a fabrication stays
// visible. A bracket still open is left as text until it closes: an unclosed
// one has not yet said what it holds.

const SOURCE_WRAPPERS: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "【": "】",
};

function sourceGroupAt(
  text: string,
  index: number,
  titles: ReadonlyMap<string, string>,
): { cites: Array<{ id: string; title: string }>; end: number } | null {
  const first = oneSourceGroupAt(text, index, titles);
  if (!first) return null;
  const cites = [...first.cites];
  let end = first.end;
  for (;;) {
    let next = end;
    while (next < text.length && /[ \t]/.test(text[next] as string)) next += 1;
    const more = oneSourceGroupAt(text, next, titles);
    if (!more) break;
    cites.push(...more.cites);
    end = more.end;
  }
  return { cites, end };
}

function oneSourceGroupAt(
  text: string,
  index: number,
  titles: ReadonlyMap<string, string>,
): { cites: Array<{ id: string; title: string }>; end: number } | null {
  const close = SOURCE_WRAPPERS[text[index] as string];
  if (!close) return null;
  const cites: Array<{ id: string; title: string }> = [];
  let at = index + 1;
  for (;;) {
    at = separatorsAt(text, at);
    if (at >= text.length) return null;
    if (text[at] === close)
      return cites.length > 0 ? { cites, end: at + 1 } : null;
    const cite = citationAt(text, at, titles);
    if (!cite) return null;
    cites.push(cite);
    at += cite.id.length;
  }
}

function citationAt(
  text: string,
  index: number,
  titles: ReadonlyMap<string, string>,
): { id: string; title: string } | null {
  const prefix = SOURCE_ID_PREFIXES.find((one) => text.startsWith(one, index));
  if (!prefix) return null;
  // Not the tail of a longer word: `xnode:S1` is not a citation.
  if (index > 0 && CONTINUES.test(text[index - 1] as string)) return null;
  const longest = Math.min(MAX_ID_LENGTH, text.length - index);
  for (let length = longest; length > prefix.length; length -= 1) {
    const candidate = text.slice(index, index + length);
    const title = titles.get(candidate);
    if (title === undefined) continue;
    const next = text[index + length];
    if (next !== undefined && CONTINUES.test(next)) continue;
    return { id: candidate, title };
  }
  return null;
}
