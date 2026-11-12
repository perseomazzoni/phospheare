// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { citationSegments } from "./citations";
import { judged, type ChatRecord, type ChatTurn } from "./types";
import { webSourceNumber } from "./webEngine";
import { clipAt, siteOf, WEB_TITLE_CHARACTERS } from "./webText";

// ── Web citations per turn ───────────────────────────────────────────────────
//
// Which web results a turn may cite, and in what order. One walk over
// a chat's turns answers three questions for each answer, and every surface
// reads the same answer. Two walks would be two orderings, and a marker
// numbered by one would open a row numbered by the other.
//
// - `searched`: this turn or an earlier one of the chat holds a `searched`
//   record, whatever its result count. It makes the model's own links inert.
//   Counted on records, never on the sources, because a result with no
//   nameable host still reached the model and is no source.
// - `citable`: this turn's own results, plus the ids earlier turns cited.
//   Recursive over resolved ids only, so a `web:7` a model invented in turn 2
//   never comes true when turn 5 mints a real `web:7`. Compaction counts for
//   nothing here: an absorbed turn's ids stay citable, because they are real
//   results of this chat.
// - `cited`: the sources this turn's text resolved, in first-citation order,
//   each once, then, on a `/verify` verdict, the sources it rests on that the
//   text never named, through the turn's own results only. The one place an
//   ordinal is set (`n`). `citable` holds bare sources, so an earlier turn's
//   number never rides into a later one.

/** A search result as a person and a replayed model read it. */
export interface WebSource {
  id: string;
  /** Checked when the file was read (`webUrl`); what the row opens. */
  url: string;
  /** Clipped once, here, to what the model was shown. */
  title: string;
  /** `siteOf(url)`, set once, here. */
  site: string;
}

/** A source as this turn cites it: `n` is its number in this turn alone. */
export type CitedSource = WebSource & { n: number };

export interface WebCitations {
  searched: boolean;
  citable: ReadonlyMap<string, WebSource>;
  cited: readonly CitedSource[];
}

/**
 * Whether a chat ever searched, or was continued from one that did: what a
 * continuation carries forward as `searchedBefore`.
 */
export function chatSearched(
  chat: Pick<ChatRecord, "turns" | "searchedBefore">,
): boolean {
  return (
    chat.searchedBefore === true ||
    chat.turns.some((turn) =>
      turn.web?.some((record) => record.status === "searched"),
    )
  );
}

/** A turn before the chat's first search: nothing resolves or is inert. */
export const NO_WEB_CITATIONS: WebCitations = {
  searched: false,
  citable: new Map(),
  cited: [],
};

const NO_TITLES: ReadonlyMap<string, string> = new Map();

/** Every result a turn's searches returned, source or not. */
function searchedResults(turn: ChatTurn) {
  return (turn.web ?? []).flatMap((record) =>
    record.status === "searched" ? record.results : [],
  );
}

/**
 * The highest `web:N` any turn holds, so ids never repeat. It reads the
 * records, not the sources: a result with no nameable host is no source, but
 * its id was issued, and issuing it again would give one id two pages.
 */
export function lastWebIndexOf(turns: readonly ChatTurn[]): number {
  let highest = 0;
  for (const turn of turns)
    for (const result of searchedResults(turn))
      highest = Math.max(highest, webSourceNumber(result.id) ?? 0);
  return highest;
}

// ── The citable view ─────────────────────────────────────────────────────────
//
// `citable` is a view, not a copy. A copy per answer of every id the chat has
// cited so far is quadratic in a chat's length, and the panel runs the walk
// on every streamed token.
//
// A turn's citable sources are its own results plus the ids earlier turns
// cited, and `earlier` is appended in turn order, so "cited by an earlier
// turn" is "among `earlier`'s first `count` insertions", and a view over the
// shared map answers `get` and `has` in O(1) without copying anything. It
// rests on three facts, each enforced here:
// - `earlier` is created fresh by each walk, appended only in turn order and
//   only with an id it does not hold yet, and never touched once the walk
//   returns, because a reused entry from a previous walk holds a view into
//   that walk's `earlier`;
// - the view implements `ReadonlyMap` and does not extend `Map`, so it has no
//   `set` or `delete` that could reach the shared store;
// - it iterates in the copy's order (`earlier`'s first `count`, then the own
//   ids that are new), built only when something iterates it, which no
//   reader outside the domain does.
// An id that is both an earlier citation and one of this turn's own results
// cannot come out of the codec, since ids are unique per chat, but the view
// stays deterministic without that: the first wins, as the codec's own
// `issued` order does.
class CitableView implements ReadonlyMap<string, WebSource> {
  #materialised: Map<string, WebSource> | undefined;
  constructor(
    readonly own: ReadonlyMap<string, WebSource>,
    private readonly earlier: ReadonlyMap<string, WebSource>,
    private readonly firstAt: ReadonlyMap<string, number>,
    /** How many of `earlier`'s insertions this turn may cite. */
    readonly count: number,
  ) {}
  get(id: string): WebSource | undefined {
    const at = this.firstAt.get(id);
    return at !== undefined && at < this.count
      ? this.earlier.get(id)
      : this.own.get(id);
  }
  has(id: string): boolean {
    return this.get(id) !== undefined;
  }
  get size(): number {
    return this.map().size;
  }
  forEach(
    each: (
      value: WebSource,
      key: string,
      map: ReadonlyMap<string, WebSource>,
    ) => void,
    thisArg?: unknown,
  ): void {
    this.map().forEach((value, key) => each.call(thisArg, value, key, this));
  }
  entries() {
    return this.map().entries();
  }
  keys() {
    return this.map().keys();
  }
  values() {
    return this.map().values();
  }
  [Symbol.iterator]() {
    return this.map()[Symbol.iterator]();
  }
  private map(): Map<string, WebSource> {
    if (this.#materialised) return this.#materialised;
    const map = new Map<string, WebSource>();
    let index = 0;
    for (const [id, source] of this.earlier) {
      if (index >= this.count) break;
      map.set(id, source);
      index += 1;
    }
    for (const [id, source] of this.own) if (!map.has(id)) map.set(id, source);
    this.#materialised = map;
    return map;
  }
}

/** Which turn object, live or settled, an entry was last found equal to. */
const builtFrom = new WeakMap<
  WebCitations,
  { turn: ChatTurn; live: boolean }
>();

/**
 * Each assistant turn's web citations, by turn id.
 *
 * `live` names the turn still streaming: its trailing id may be half an id,
 * and is held back from `cited` as the renderer holds its marker back, its
 * text scanned without trailing whitespace, as markdown-it trims a
 * paragraph's. It is passed, never inferred; history and search
 * pass none.
 *
 * `previous` is the last result the screen committed. A turn whose entry is
 * equal in every field keeps that same object, so a settled answer does not
 * re-render as another streams. `previous` decides an entry's identity,
 * never its value, so a chat file edited under the panel gets new entries,
 * not stale urls. Checked in linear time: a turn's `citable` is its own
 * results plus the earlier turns' `cited`, so its entry is equal when its
 * own results and its `cited` are equal by value (id, url, title, site),
 * `searched` is, it sits where it sat last time, it may cite as many earlier
 * citations as it could, and every entry before it was kept too. Position
 * and count matter: a turn removed from the middle changes what every later
 * turn may cite, though none of them changed.
 *
 * A turn that is the very object its kept entry was built from, as live or
 * as settled as it was then, in an unbroken chain, is not scanned again: its
 * text cannot have changed, because the app never edits a turn in place.
 * The dock runs the walk per streamed token, and rescanning every answer's
 * text each time is too slow.
 */
export function webCitations(
  turns: readonly ChatTurn[],
  live?: string,
  previous?: ReadonlyMap<string, WebCitations>,
  /** The chat was continued from one that searched. */
  searchedBefore = false,
): Map<string, WebCitations> {
  const entries = new Map<string, WebCitations>();
  const earlier = new Map<string, WebSource>();
  const firstAt = new Map<string, number>();
  const order = previous ? [...previous.keys()] : [];
  let searched = searchedBefore;
  let unbroken = true;
  let position = 0;
  for (const turn of turns) {
    if (turn.web?.some((record) => record.status === "searched"))
      searched = true;
    if (turn.role !== "assistant") continue;
    const inPlace = order[position] === turn.id;
    position += 1;
    if (!searched) {
      entries.set(turn.id, NO_WEB_CITATIONS);
      unbroken &&= inPlace;
      continue;
    }
    const kept = previous?.get(turn.id);
    const from = kept ? builtFrom.get(kept) : undefined;
    if (
      unbroken &&
      inPlace &&
      kept?.citable instanceof CitableView &&
      kept.citable.count === earlier.size &&
      from?.turn === turn &&
      from.live === (turn.id === live)
    ) {
      // Its citations still become what later turns may cite, bare.
      for (const source of kept.cited) {
        const bare = kept.citable.get(source.id);
        if (bare && !earlier.has(source.id)) {
          firstAt.set(source.id, earlier.size);
          earlier.set(source.id, bare);
        }
      }
      entries.set(turn.id, kept);
      continue;
    }
    const own = new Map<string, WebSource>();
    for (const result of searchedResults(turn)) {
      const site = siteOf(result.url);
      if (site === null) continue;
      own.set(result.id, {
        id: result.id,
        url: result.url,
        title: clipAt(result.title, WEB_TITLE_CHARACTERS),
        site,
      });
    }
    const citable = new CitableView(own, earlier, firstAt, earlier.size);
    const cited: CitedSource[] = [];
    const seen = new Set<string>();
    // One way in for the text's markers and a verdict's sources alike, so
    // the numbers run 1..n in the order the writer reads them.
    const cite = (source: WebSource | undefined) => {
      if (!source || seen.has(source.id)) return;
      seen.add(source.id);
      cited.push({ ...source, n: cited.length + 1 });
      if (!earlier.has(source.id)) {
        firstAt.set(source.id, earlier.size);
        earlier.set(source.id, source);
      }
    };
    for (const segment of citationSegments(
      // The live text as the renderer reads it: markdown-it trims a
      // paragraph's trailing whitespace, so `web:2\n` still ends on the id
      // there and its marker is held, and the row with it.
      turn.id === live ? turn.text.trimEnd() : turn.text,
      NO_TITLES,
      turn.id !== live,
      citable,
    ))
      if (segment.kind === "web")
        for (const id of segment.ids) cite(citable.get(id));
    // A verdict's sources after its reasoning's: every row the
    // answer rests on is listed, and a source the reasoning never names
    // still gets its row, after those it does. Only through the turn's own
    // results, the ids the judge was shown and could name, never an earlier
    // answer's, which the reasoning may mention but the verdict cannot rest
    // on.
    if (turn.verified && judged(turn.verified))
      for (const source of turn.verified.sources) cite(own.get(source.id));
    const keep =
      unbroken &&
      inPlace &&
      kept !== undefined &&
      kept.searched &&
      kept.citable instanceof CitableView &&
      kept.citable.count === citable.count &&
      sameSources([...kept.citable.own.values()], [...own.values()]) &&
      sameSources(kept.cited, cited);
    const entry = keep ? kept : { searched: true, citable, cited };
    builtFrom.set(entry, { turn, live: turn.id === live });
    entries.set(turn.id, entry);
    unbroken = keep;
  }
  return entries;
}

/** The number each cited id reads as, for the renderer. */
export function webNumbers(entry: WebCitations): Map<string, number> {
  return new Map(entry.cited.map((source) => [source.id, source.n]));
}

/** A group's numbers as one label: "1,3". The marker's and the copy's. */
export function groupLabel(
  ids: readonly string[],
  numbers: ReadonlyMap<string, number>,
): string {
  return ids
    .flatMap((id) => {
      const n = numbers.get(id);
      return n === undefined ? [] : [String(n)];
    })
    .join(",");
}

function sameSource(one: WebSource, other: WebSource): boolean {
  return (
    one.id === other.id &&
    one.url === other.url &&
    one.title === other.title &&
    one.site === other.site
  );
}

function sameSources(
  kept: readonly WebSource[],
  fresh: readonly WebSource[],
): boolean {
  return (
    kept.length === fresh.length &&
    fresh.every((source, index) => {
      const other = kept[index];
      return other !== undefined && sameSource(other, source);
    })
  );
}
