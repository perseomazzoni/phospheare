// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  commonmarkCodec,
  joinedText,
  PAGE_BREAK_MARK,
  PARAGRAPH_BREAK,
  type Doc,
} from "./engine";
import type { ViewSearchState, ViewSelectionState } from "./views/view/port";
import { findInConcatenated } from "./views/writing/highlights";

// Arriving from a search result. The panel finds the writer's words in a
// file's raw markdown; the surface holds a parsed `Doc`. There is no mapping
// between the two coordinate systems, so what travels is the query and
// an ordinal, and the surface finds the words again with the find bar's scan
// over the open document.

/**
 * Where the writer came from, and what they came looking for.
 *
 * Two kinds share the one arrival: a search hit the writer opened,
 * and a passage the assistant pointed at. As one state they can never both
 * paint, which keeps the highlight registers exclusive by construction.
 */
export interface SearchArrival {
  /**
   * `search`: the writer's own words, marked the way the panel found them
   * (every occurrence, the clicked one current).
   *
   * `evidence`: the assistant's quotation, marked as one passage in its own
   * look. `query` is then the whole passage as `evidencePassage` returns it,
   * never a fragment.
   */
  kind: "search" | "evidence";
  /**
   * The adopted file the hit was in.
   *
   * The arrival lasts while this file is open and ends when another opens,
   * with no effect to run. Clearing it when `activeFile` changes would have to
   * know whether the change was the arrival's own, and fails when a writer
   * opens a hit in the file they are already in.
   */
  file: string;
  query: string;
}

/** What the find bar is showing, when it is open at all. */
export interface FindBarState {
  open: boolean;
  query: string | null;
  currentIndex: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  hyphensJoinWords: boolean;
}

/**
 * Which marks the writing surface should paint.
 *
 * The find bar wins while it is open. It is what the writer is typing into,
 * and two queries marking one document leave no way to read which marks mean
 * what.
 *
 * An arrival's options are the panel's, not the bar's. The panel searches the
 * way a person recalls, case-folded with no word rules; marking with the
 * bar's toggles could mark a different set from the one that put the row on
 * screen, so a clicked hit lands on nothing or on more than asked.
 *
 * The ordinal is the arrival's own: which occurrence in this file the writer
 * clicked in the panel. Where the two coordinate systems disagree, because
 * markup splits or spells a match, the surface finds no Nth match and marks
 * them all, so the writer still lands in the right file. An evidence
 * arrival's ordinal is the occurrence its anchor's context names
 * (`evidenceOrdinal`), because a repeated quote is cited at one of its places.
 */
export function marksFor(
  bar: FindBarState,
  arrival: SearchArrival | null,
  activeFile: string | null,
  ordinal = 0,
): ViewSearchState {
  if (bar.open)
    return {
      query: bar.query,
      currentIndex: bar.currentIndex,
      caseSensitive: bar.caseSensitive,
      wholeWord: bar.wholeWord,
      hyphensJoinWords: bar.hyphensJoinWords,
      // Stepping through a document already on screen.
      scrollTo: "nearest",
    };

  const live = arrival && arrival.file === activeFile ? arrival : null;
  if (live?.kind === "evidence")
    // The passage as the surface shows it, case-sensitive because it was read
    // from this document, marked as one passage.
    return {
      query: live.query,
      currentIndex: ordinal,
      caseSensitive: true,
      wholeWord: false,
      hyphensJoinWords: false,
      scrollTo: "center",
      mark: "evidence",
    };
  return {
    query: live?.query ?? null,
    currentIndex: ordinal,
    caseSensitive: false,
    wholeWord: false,
    hyphensJoinWords: false,
    // Arriving in a file the writer has not read yet: the words go to the
    // middle of the screen rather than the viewport's edge.
    scrollTo: "center",
  };
}

/** Something the writer did that may end an arrival. */
export type ArrivalEnd = "edit" | "escape" | "find";

/**
 * What an arrival becomes when the writer does `event`.
 *
 * An evidence mark is the assistant saying "here", and the writer may
 * disagree; the quote in the chat stays as the way back, so the mark is
 * disposable. It goes at the first edit, Escape in the page or the find
 * opening, while a search arrival stays until its search is over (`endFind`)
 * or another file opens. A click ends neither: the writer clicks to put the
 * caret beside the passage, and a mark that vanishes as they aim is a trap.
 */
export function arrivalAfter(
  arrival: SearchArrival | null,
  event: ArrivalEnd,
): SearchArrival | null {
  void event;
  return arrival?.kind === "evidence" ? null : arrival;
}

/**
 * A quotation as the writing surface will show it, or null when the open
 * document cannot show it as one passage.
 *
 * The assistant quotes the file's raw markdown; the surface paints the parsed
 * document, where `*never*` reads "never". So the quote goes through the
 * same codec and the result is looked for in the document's paragraphs.
 * Null when the quote spans paragraphs,
 * since the painter matches inside one block and a mark covering half a quote
 * misleads, or when the open text does not contain it. Null is said to the
 * writer, never painted.
 */
export function evidencePassage(doc: Doc, quote: string): string | null {
  const parsed = commonmarkCodec
    .parse(quote.trim())
    .filter((p) => p.blockType !== "pagebreak");
  if (parsed.length !== 1) return null;
  const passage = textOf(parsed[0]);
  if (passage.length === 0) return null;
  return doc.some((p) => textOf(p).includes(passage)) ? passage : null;
}

/** The neighbouring text an anchor keeps to tell a repeated quote apart. */
export interface EvidenceContext {
  prefix?: string;
  suffix?: string;
}

// How far either side of an occurrence is read. An anchor keeps at most
// `ANCHOR_CONTEXT_MAX` (200) raw characters of each; twice that leaves room
// for the markup the raw side spends and the surface does not.
const CONTEXT_WINDOW = 400;
// The raw file and the surface spell markdown syntax and whitespace
// differently around the same words: `*She ran*` against "She ran", a blank
// line against a paragraph boundary. Both sides are read without them, so the
// words are compared.
const SYNTAX = /[*_`~#>[\]()\\!|+=-]/g;

function plain(text: string): string {
  return text.replace(SYNTAX, "").replace(/\s+/g, " ");
}

/**
 * Which occurrence of `passage` in the open document an anchor cites, as the
 * index the painter's own count gives it (`findInConcatenated`,
 * case-sensitive, over the document's text in order), or 0 when nothing tells
 * them apart.
 *
 * `locateInBook` stores `prefix` and `suffix` only for a quote that repeats in
 * its Section, and that context is raw markdown while the surface holds a
 * parsed document. So the context is scored, not looked up: each
 * occurrence counts how many characters before it end like the prefix and
 * after it begin like the suffix, read without markup, and the best wins.
 * Ties, and context that matches nowhere, go to the first occurrence.
 */
export function evidenceOrdinal(
  doc: Doc,
  passage: string,
  { prefix, suffix }: EvidenceContext,
): number {
  if (!prefix && !suffix) return 0;
  // The painter's own text, the paragraphs joined as find joins them,
  // so the occurrences counted here are the ones it numbers. The
  // context reads a page break's mark as a break, so the words either side of
  // one do not run together.
  const joined = joinedText(doc);
  const matches = findInConcatenated(joined.text, passage, true, false);
  if (matches.length < 2) return 0;
  const spaced = joined.text.split(PAGE_BREAK_MARK).join(PARAGRAPH_BREAK);
  const wantBefore = plain(prefix ?? "");
  const wantAfter = plain(suffix ?? "");
  let best = 0;
  let bestScore = 0;
  matches.forEach((match, index) => {
    const at = match.start;
    const end = at + passage.length;
    const score =
      sharedTail(
        plain(spaced.slice(Math.max(0, at - CONTEXT_WINDOW), at)),
        wantBefore,
      ) + sharedHead(plain(spaced.slice(end, end + CONTEXT_WINDOW)), wantAfter);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

function sharedTail(a: string, b: string): number {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  )
    length += 1;
  return length;
}

function sharedHead(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length])
    length += 1;
  return length;
}

function textOf(paragraph: Doc[number]): string {
  return paragraph.runs.map((run) => run.text).join("");
}

/** The selection register, gated by the search register.
 *
 * The find wins while it is open, in the same commit the query appears, not
 * one paint later. The every-one click seeds the query while the repetition
 * register is still armed, and two registers painting one word make the
 * highlight pass throw `IndexSizeError` from `Range.setEnd`, because the
 * second register's candidates map onto nodes the first one's wraps split.
 * The selection register is vacated, not suppressed: an empty text disarms
 * the paint path, so no half-state survives. A new register joins here,
 * never in the DOM pass.
 */
export function selectionFor(
  selection: ViewSelectionState,
  search: ViewSearchState,
): ViewSelectionState {
  return search.query
    ? { text: null, exactText: null, showRepetitions: false }
    : selection;
}
