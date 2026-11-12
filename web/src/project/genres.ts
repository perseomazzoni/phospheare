// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Genres a project can declare ─────────────────────────────────────────────
//
// A genre is a promise the book makes to its reader, and the assistant reads
// the book against the promise the writer declared, never one it guessed.
//
// The ids are the whole catalogue. Each has a pack under
// `ai/domain/genres/<id>.md` and a label in the locales, and
// `ai/domain/genres.test.ts` holds the three in step: the AI layer may not
// import this file (`boundaries.test.ts`), and a pack with no id, or an id
// with no pack, is a choice that silently does nothing.
//
// Two at most: a blend is real (romantic suspense, historical mystery), and
// three is not a promise anyone can keep. The first is the lead; the order is
// the writer's.

export const GENRE_IDS = [
  "romance",
  "mystery",
  "thriller",
  "fantasy",
  "science-fiction",
  "horror",
  "literary",
  "historical",
  "contemporary",
] as const;
export type GenreId = (typeof GENRE_IDS)[number];

/** How many genres one project declares at most: a lead and a blend. */
export const GENRE_LIMIT = 2;

/**
 * Who the book is written for. It is a fact separate from genre, because a
 * young-adult fantasy and an adult fantasy make the same promise to different
 * readers, and the writer may leave it unsaid.
 */
export const AGE_CATEGORIES = [
  "middle-grade",
  "young-adult",
  "new-adult",
  "adult",
] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];

export function isGenreId(value: unknown): value is GenreId {
  return (
    typeof value === "string" &&
    (GENRE_IDS as readonly string[]).includes(value)
  );
}

export function isAgeCategory(value: unknown): value is AgeCategory {
  return (
    typeof value === "string" &&
    (AGE_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * The declared genres from a stored value: known ids only, each once, in the
 * writer's order, at most `GENRE_LIMIT`. Lenient like every field of the
 * file: an unknown id costs that id, never the open.
 */
export function asGenres(value: unknown): GenreId[] {
  if (!Array.isArray(value)) return [];
  const out: GenreId[] = [];
  for (const one of value) {
    if (out.length >= GENRE_LIMIT) break;
    if (isGenreId(one) && !out.includes(one)) out.push(one);
  }
  return out;
}

export function asAgeCategory(value: unknown): AgeCategory | null {
  return isAgeCategory(value) ? value : null;
}

// ── Declared tropes ──────────────────────────────────────────────────────────
//
// The writer lists the tropes the book means to deliver ("enemies to lovers",
// "found family") in their own words, because no closed list of tropes
// survives a genre's readers. The text is free, so it is bounded here: a
// handful, each a phrase.

/** How many tropes one project declares at most: a promise, not a catalogue. */
export const TROPE_LIMIT = 8;
/** How long one trope may be: a phrase, not a paragraph. */
export const TROPE_MAX = 60;

/**
 * The stored list, whatever the file holds: strings only, whitespace folded,
 * each within `TROPE_MAX`, each once (ignoring case), at most `TROPE_LIMIT`.
 */
export function asTropes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const one of value) {
    if (out.length >= TROPE_LIMIT) break;
    if (typeof one !== "string") continue;
    const trope = one.replace(/\s+/g, " ").trim().slice(0, TROPE_MAX).trim();
    const key = trope.toLowerCase();
    if (!trope || seen.has(key)) continue;
    seen.add(key);
    out.push(trope);
  }
  return out;
}

/** The field's text as the list it declares: commas, semicolons or lines. */
export function parseTropes(text: string): string[] {
  return asTropes(text.split(/[,;\n]/));
}
