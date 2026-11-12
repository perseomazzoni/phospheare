// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Planting continuity errors ───────────────────────────────────────────────
//
// Plants errors in any book, to measure what finds them. The plants are drawn
// at random from what the given book itself states: its own names, numbers,
// colours, weekdays and sheets. A seed makes every run repeatable.
//
// The plants follow no reader's patterns: a planter that planted only where
// a reader's grammar matches would measure the reader against itself. What
// the two share is a language's ordinary words (months, weekdays, colours,
// number words), which are data about the language, not about any story.
//
// Kinds:
//   - name: one occurrence of a name the book uses at least three times gets
//     a one-letter slip inside the word (never at its end, where a language
//     inflects);
//   - number: one number before a unit (years, metres, minutes…) changes;
//   - colour: one colour word changes to another of the same ending, so the
//     sentence still agrees;
//   - weekday: one weekday named near a month becomes another;
//   - sheet: an age or a colour in a character, arc or world sheet changes,
//     so the writer's document and the prose disagree.
//
// Every plant needs a witness. A colour the book mentions once, changed, is
// a different colour: nothing anywhere says otherwise, and no reader,
// human or model, could call it an error. So a changed fact is planted only
// where the book states the same fact somewhere else (the same number of the
// same unit, the same colour beside the same word, the same date), where the
// sheet's fact is stated in the prose, or where the fact checks itself (a
// name used three times; a weekday once the book has given a year).
//
// Pure: text in, text and a key out. The key is the answer sheet and never
// goes near the model.

import { plantWordsFor } from "./words";

/** One text of the book, a Section or a reference sheet. */
export interface EvalSource {
  id: string;
  title: string;
  text: string;
  /** A reference sheet's shelf ("characters", "world"…); absent for prose. */
  group?: string;
}

export type PlantKind = "name" | "number" | "colour" | "weekday" | "sheet";

export const PLANT_KINDS: readonly PlantKind[] = [
  "name",
  "number",
  "colour",
  "weekday",
  "sheet",
];

/** One planted error: where, what was there, and what is there now. */
export interface Plant {
  kind: PlantKind;
  sourceId: string;
  /** The words as the book had them. */
  before: string;
  /** The words the plant put in their place. */
  after: string;
  /** Where `after` starts in the planted text. */
  offset: number;
  /**
   * Where else the book states the fact the plant changed: the witness sites
   * the plant was chosen against, each as the sentence around it in its
   * unplanted source. A finding diagnoses the slip when it quotes the plant
   * and one of these; a second quote that merely holds the old word is some
   * other fact. Absent on a plant that stands on its own (`selfVerifying`).
   */
  witnesses?: Array<{ sourceId: string; quote: string }>;
  /**
   * Whether the plant is checkable with no witness: a weekday the book's
   * calendar pins, a name used three times. One citation is a diagnosis.
   */
  selfVerifying?: boolean;
}

export interface Planted {
  sources: EvalSource[];
  plants: Plant[];
}

/**
 * A small, fast, seedable generator (mulberry32): the same seed, the same
 * plants.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: () => number, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)];

// ── Number words, written the way the language writes them ───────────────────

const IT_UNITS = [
  "",
  "uno",
  "due",
  "tre",
  "quattro",
  "cinque",
  "sei",
  "sette",
  "otto",
  "nove",
];
const IT_TEENS = [
  "dieci",
  "undici",
  "dodici",
  "tredici",
  "quattordici",
  "quindici",
  "sedici",
  "diciassette",
  "diciotto",
  "diciannove",
];
const IT_TENS = [
  "",
  "",
  "venti",
  "trenta",
  "quaranta",
  "cinquanta",
  "sessanta",
  "settanta",
  "ottanta",
  "novanta",
];

function italianWord(n: number): string {
  if (n < 10) return IT_UNITS[n];
  if (n < 20) return IT_TEENS[n - 10];
  if (n < 100) {
    const unit = n % 10;
    const ten = IT_TENS[Math.floor(n / 10)];
    // "ventuno", "trentotto": the ten drops its vowel before uno and otto.
    const head = unit === 1 || unit === 8 ? ten.slice(0, -1) : ten;
    return head + IT_UNITS[unit];
  }
  const hundreds = Math.floor(n / 100);
  return `${hundreds === 1 ? "" : IT_UNITS[hundreds]}cento${italianWord(n % 100)}`;
}

const EN_SMALL = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function englishWord(n: number): string {
  if (n < 20) return EN_SMALL[n];
  const unit = n % 10;
  const ten = EN_TENS[Math.floor(n / 10)];
  return unit === 0 ? ten : `${ten}-${EN_SMALL[unit]}`;
}

/** `n` as a word in the language, or null when it has none for it here. */
export function numberWord(n: number, languageCode: string): string | null {
  const base = languageCode.toLowerCase().split(/[-_]/)[0];
  if (!Number.isInteger(n) || n <= 0) return null;
  if (base === "it" && n < 1000) return italianWord(n);
  if (base === "en" && n < 100) return englishWord(n);
  return null;
}

// ── Finding what can be planted ──────────────────────────────────────────────

interface Site {
  kind: PlantKind;
  sourceId: string;
  start: number;
  end: number;
  before: string;
  after: string;
  /**
   * The fact as the book states it here ("52|anni", "grigio|berretto"). A
   * changed fact is only a contradiction when the book states the same fact
   * somewhere else too, a witness; so a site is planted only when another
   * site shares one of its keys, or when it is `pinned` on its own.
   */
  keys: string[];
  /**
   * Checkable with no witness: a name used three times, a weekday a calendar
   * pins.
   */
  pinned?: boolean;
  /**
   * The fact without its surroundings ("52|anni"), for a witness between a
   * sheet and the prose: a sheet shares no words with a sentence, being its
   * person's whole context, so there the value and the unit are the fact.
   */
  sheetKey?: string;
}

/**
 * Units a count is stated in, per language: the book's numbers worth
 * changing.
 */
const UNITS: Record<string, string> = {
  it: "anni|anno|mesi|giorni|ore|minuti|metri|chilometri|km|passi",
  en: "years|year|months|days|hours|minutes|metres|meters|miles|kilometres|kilometers|km|yards|steps",
};

const LETTER = /[\p{L}\p{M}]/u;

/** A number different from `n`, close enough to be a slip and never zero. */
function nudged(n: number, random: () => number): number {
  const step =
    n < 20
      ? 1 + Math.floor(random() * 3)
      : Math.max(2, Math.round(n * (0.1 + random() * 0.4)));
  const up = n + step;
  const down = n - step;
  return down > 0 && random() < 0.5 ? down : up;
}

function sameCase(model: string, word: string): string {
  return /^\p{Lu}/u.test(model) ? word[0].toUpperCase() + word.slice(1) : word;
}

function numberSites(
  source: EvalSource,
  languageCode: string,
  random: () => number,
): Site[] {
  const base = languageCode.toLowerCase().split(/[-_]/)[0];
  const lexicon = plantWordsFor(languageCode);
  const units = UNITS[base];
  if (!lexicon || !units) return [];
  const pattern = new RegExp(
    `(?<![\\p{L}\\d])(\\d+|[\\p{L}-]+)\\s+(${units})(?![\\p{L}])`,
    "giu",
  );
  const sites: Site[] = [];
  for (const match of source.text.matchAll(pattern)) {
    const word = match[1];
    const value = lexicon.number(word);
    if (value === null || value <= 0 || !Number.isInteger(value)) continue;
    const next = nudged(value, random);
    const written = /^\d/.test(word)
      ? String(next)
      : numberWord(next, languageCode);
    if (written === null) continue;
    // The same value of the same unit is not yet the same fact: "the hut is
    // four miles up" and "carried the boy four miles" are two. So, as for a
    // colour, the witness must also share a word nearby, names included.
    const unit = match[2].toLowerCase();
    const near = (
      source.text
        .slice(
          Math.max(0, match.index - 40),
          match.index + match[0].length + 40,
        )
        .toLowerCase()
        .match(/\p{L}{4,}/gu) ?? []
    ).filter((one) => lexicon.number(one) === null && one !== unit);
    sites.push({
      kind: "number",
      sourceId: source.id,
      start: match.index,
      end: match.index + word.length,
      before: word,
      after: sameCase(word, written),
      keys: near.map((one) => `${value}|${unit}|${one}`),
      sheetKey: `${value}|${unit}`,
    });
  }
  return sites;
}

function colourSites(
  source: EvalSource,
  languageCode: string,
  random: () => number,
  kind: PlantKind = "colour",
): Site[] {
  const lexicon = plantWordsFor(languageCode);
  if (!lexicon) return [];
  const words = Object.keys(lexicon.colours);
  const sites: Site[] = [];
  for (const match of source.text.matchAll(/[\p{L}]+/gu)) {
    const word = match[0].toLowerCase();
    const colour = lexicon.colours[word];
    if (colour === undefined) continue;
    // Another colour with the same ending, so "maglietta bianca" becomes
    // "maglietta verde"… only where the agreement holds: "rossa" for
    // "bianca", never "rosso".
    const inflects = !languageCode.toLowerCase().startsWith("en");
    const others = words.filter(
      (other) =>
        lexicon.colours[other] !== colour &&
        (!inflects || other.slice(-1) === word.slice(-1)),
    );
    if (others.length === 0) continue;
    // Keyed by the thing the colour is said of: the word right before it
    // ("cappotto verde") and up to two words after it of three letters or
    // more ("black wool hat"). Any nearby word would let "with" pair two
    // different blue things, and a plant whose witness states another fact
    // counts as a miss against a pipeline that was right.
    const after =
      source.text
        .slice(
          match.index + match[0].length,
          match.index + match[0].length + 40,
        )
        .toLowerCase()
        .match(/\p{L}+/gu) ?? [];
    const adjoining = /(\p{L}+)\s*$/u.exec(
      source.text.slice(Math.max(0, match.index - 40), match.index),
    )?.[1];
    const near = [
      ...(adjoining && adjoining.length >= 4 ? [adjoining.toLowerCase()] : []),
      ...after.slice(0, 2).filter((one) => one.length >= 3),
    ];
    sites.push({
      kind,
      sourceId: source.id,
      start: match.index,
      end: match.index + match[0].length,
      before: match[0],
      after: sameCase(match[0], pick(random, others)),
      keys: near
        .filter((word) => lexicon.colours[word] === undefined)
        .map((word) => `${colour}|${word}`),
    });
  }
  return sites;
}

function weekdaySites(
  source: EvalSource,
  languageCode: string,
  random: () => number,
  anchored: boolean,
): Site[] {
  const lexicon = plantWordsFor(languageCode);
  if (!lexicon) return [];
  const months = new RegExp(
    `(?<!\\p{L})(?:${lexicon.months.join("|")})(?!\\p{L})`,
    "iu",
  );
  const date = new RegExp(
    `(\\d{1,2})\\s+(${lexicon.months.join("|")})(?!\\p{L})`,
    "iu",
  );
  const sites: Site[] = [];
  for (const match of source.text.matchAll(/[\p{L}]+/gu)) {
    const index = lexicon.weekdays.indexOf(match[0].toLowerCase());
    if (index < 0) continue;
    // Only a weekday the text pins to a date: elsewhere a changed weekday is
    // a different day, not a slip.
    const around = source.text.slice(
      Math.max(0, match.index - 40),
      match.index + match[0].length + 40,
    );
    if (!months.test(around)) continue;
    const dated = date.exec(around);
    const other = pick(
      random,
      lexicon.weekdays.filter((_, at) => at !== index),
    );
    sites.push({
      kind: "weekday",
      sourceId: source.id,
      start: match.index,
      end: match.index + match[0].length,
      before: match[0],
      after: sameCase(match[0], other),
      // The calendar pins it once the book has a year at all: a reader of
      // "venerdì 14 ottobre 2022" knows which day "domenica 16 ottobre" is.
      // Without one, only the same date stated elsewhere witnesses it.
      keys: dated ? [`${dated[1]} ${dated[2].toLowerCase()}`] : [],
      pinned: anchored && dated !== null,
    });
  }
  return sites;
}

/**
 * The capitalised words inside sentences, by how often the book uses each.
 */
function namesOf(sources: readonly EvalSource[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const source of sources)
    for (const match of source.text.matchAll(/\p{Lu}\p{Ll}{3,}/gu)) {
      const start = match.index;
      if (start > 0 && LETTER.test(source.text[start - 1])) continue;
      const end = start + match[0].length;
      if (end < source.text.length && LETTER.test(source.text[end])) continue;
      const before = source.text.slice(0, start).trimEnd();
      if (
        before === "" ||
        /[.!?…:;«“"(\n—–-]$/u.test(before) ||
        /\n\s*$/u.test(source.text.slice(0, start))
      )
        continue;
      counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
    }
  return counts;
}

/**
 * A one-letter slip inside `name`: two letters swapped, one doubled or one
 * dropped.
 */
export function slipOf(name: string, random: () => number): string {
  // Inside the word: never the first letter, and never the last, where an
  // inflected language changes a word by its grammar.
  const inner = name.length - 2;
  const at = 1 + Math.floor(random() * Math.max(1, inner - 1));
  const operation = Math.floor(random() * 3);
  const letters = Array.from(name);
  if (
    operation === 0 &&
    letters[at] !== letters[at + 1] &&
    at + 1 < letters.length - 1
  ) {
    [letters[at], letters[at + 1]] = [letters[at + 1], letters[at]];
  } else if (operation === 1) {
    letters.splice(at, 0, letters[at]);
  } else {
    letters.splice(at, 1);
  }
  const slipped = letters.join("");
  return slipped === name
    ? `${name.slice(0, at)}${name[at]}${name.slice(at)}`
    : slipped;
}

function nameSites(
  sources: readonly EvalSource[],
  random: () => number,
): Site[] {
  const counts = namesOf(sources);
  const often = [...counts]
    .filter(([, count]) => count >= 3)
    .map(([name]) => name);
  const sites: Site[] = [];
  for (const name of often) {
    const pattern = new RegExp(`(?<!\\p{L})${name}(?!\\p{L})`, "gu");
    const occurrences = sources.flatMap((source) =>
      [...source.text.matchAll(pattern)].map((match) => ({
        source,
        index: match.index,
      })),
    );
    // Never the first time the book names them: a slip is a later
    // occurrence that disagrees with the one the reader already knows.
    for (const occurrence of occurrences.slice(1))
      sites.push({
        kind: "name",
        sourceId: occurrence.source.id,
        start: occurrence.index,
        end: occurrence.index + name.length,
        before: name,
        after: slipOf(name, random),
        keys: [],
        pinned: true,
      });
  }
  return sites;
}

/**
 * Whether the book states a full date with a year anywhere, anchoring its
 * calendar.
 */
function hasYear(
  sources: readonly EvalSource[],
  languageCode: string,
): boolean {
  const lexicon = plantWordsFor(languageCode);
  if (!lexicon) return false;
  const full = new RegExp(
    `\\d{1,2}\\s+(?:${lexicon.months.join("|")})\\s+\\d{4}(?!\\d)`,
    "iu",
  );
  return sources.some((source) => full.test(source.text));
}

// ── Planting ─────────────────────────────────────────────────────────────────

/**
 * `sources` with up to `perKind` errors of each kind planted at random, and
 * the key. A kind the book gives nothing to plant is absent from the key.
 * Two plants never touch the same words.
 */
export function plantErrors(
  sources: readonly EvalSource[],
  languageCode: string,
  options: { seed: number; perKind?: number; kinds?: readonly PlantKind[] },
): Planted {
  const random = seededRandom(options.seed);
  const perKind = options.perKind ?? 1;
  const kinds = options.kinds ?? PLANT_KINDS;
  const prose = sources.filter((source) => source.group === undefined);
  const sheets = sources.filter((source) => source.group !== undefined);
  const byKind: Record<PlantKind, Site[]> = {
    name: nameSites(prose, random),
    number: prose.flatMap((one) => numberSites(one, languageCode, random)),
    colour: prose.flatMap((one) => colourSites(one, languageCode, random)),
    weekday: prose.flatMap((one) =>
      weekdaySites(one, languageCode, random, hasYear(prose, languageCode)),
    ),
    sheet: sheets.flatMap((one) => [
      ...numberSites(one, languageCode, random).map((site) => ({
        ...site,
        kind: "sheet" as const,
      })),
      ...colourSites(one, languageCode, random, "sheet"),
    ]),
  };
  const chosen: Site[] = [];
  // A template's hint is dropped before anything reads a sheet, so a plant
  // inside one would be an error nobody could see.
  const textOf = new Map(sources.map((source) => [source.id, source.text]));
  const inComment = (site: Site) => {
    const text = textOf.get(site.sourceId) ?? "";
    return (
      text.lastIndexOf("<!--", site.start) > text.lastIndexOf("-->", site.start)
    );
  };
  for (const kind of PLANT_KINDS)
    byKind[kind] = byKind[kind].filter((site) => !inComment(site));
  // Every fact the book states, prose and sheets, is a possible witness,
  // whichever kinds are being planted. A sheet's fact is witnessed by the
  // prose only: two sheets agreeing with each other put nothing in the prose
  // to disagree with.
  const all = PLANT_KINDS.flatMap((kind) => byKind[kind]);
  const sheetIds = new Set(sheets.map((sheet) => sheet.id));
  const witnessesOf = (site: Site) =>
    all.filter(
      (other) =>
        !(other.sourceId === site.sourceId && other.start === site.start) &&
        !(site.kind === "sheet" && sheetIds.has(other.sourceId)) &&
        (other.keys.some((key) => site.keys.includes(key)) ||
          (other.sheetKey !== undefined &&
            other.sheetKey === site.sheetKey &&
            (sheetIds.has(site.sourceId) || sheetIds.has(other.sourceId)))),
    );
  const overlaps = (site: Site) =>
    chosen.some(
      (other) =>
        other.sourceId === site.sourceId &&
        site.start < other.end + 20 &&
        other.start < site.end + 20,
    );
  for (const kind of kinds) {
    const pool = [...byKind[kind]];
    let planted = 0;
    while (planted < perKind && pool.length > 0) {
      const site = pool.splice(Math.floor(random() * pool.length), 1)[0];
      if (overlaps(site)) continue;
      // A plant whose every witness is itself planted contradicts nothing.
      if (
        !site.pinned &&
        witnessesOf(site).every((witness) => chosen.includes(witness))
      )
        continue;
      chosen.push(site);
      planted += 1;
    }
  }
  // Applied from the end of each text backwards, so an earlier plant's
  // offset is not moved by a later one; then every offset is read off the
  // text as it now is.
  const planted = sources.map((source) => {
    let text = source.text;
    for (const site of chosen
      .filter((one) => one.sourceId === source.id)
      .sort((a, b) => b.start - a.start))
      text = text.slice(0, site.start) + site.after + text.slice(site.end);
    return { ...source, text };
  });
  const plants = chosen.map((site): Plant => {
    const shift = chosen
      .filter(
        (other) => other.sourceId === site.sourceId && other.start < site.start,
      )
      .reduce(
        (sum, other) => sum + other.after.length - other.before.length,
        0,
      );
    // The witnesses that still stand: a witness that is itself planted does
    // not state the fact, and the scorer must not be sent to it.
    const standing = witnessesOf(site).filter(
      (witness) => !chosen.includes(witness),
    );
    return {
      kind: site.kind,
      sourceId: site.sourceId,
      before: site.before,
      after: site.after,
      offset: site.start + shift,
      ...(standing.length > 0
        ? {
            witnesses: standing.map((witness) => ({
              sourceId: witness.sourceId,
              quote: sentenceAround(
                textOf.get(witness.sourceId) ?? "",
                witness.start,
                witness.end,
              ),
            })),
          }
        : {}),
      ...(site.pinned ? { selfVerifying: true } : {}),
    };
  });
  return { sources: planted, plants };
}

/**
 * The sentence of `text` that holds [start, end): from the end of the
 * sentence before to the end of this one, a line break counting as an end
 * (a sheet's bullet is a line). What a finding would quote of a witness,
 * whole or in part.
 */
export function sentenceAround(
  text: string,
  start: number,
  end: number,
): string {
  const ends = /[.!?\n]/u;
  let from = start;
  while (from > 0 && !ends.test(text[from - 1])) from -= 1;
  let to = end;
  while (to < text.length && !ends.test(text[to])) to += 1;
  return text.slice(from, Math.min(text.length, to + 1)).trim();
}
