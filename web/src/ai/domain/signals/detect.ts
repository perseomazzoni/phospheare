// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Lexicon } from "./lexicons";
import { escapeRegExp } from "../../../text/regExp";

// The signal pre-pass. Some of what an editor notices is mechanical to find
// and hard to judge: a filter verb is easy to spot and only sometimes a
// fault. So the finding is done here, by code, in the browser, with no model
// and no network. The model is handed the candidates and spends its attention
// on the judgement, fault or choice against the writer's declared prose
// style, which is the half a small local model does well.
//
// Every candidate carries an exact quote from the text it was found in, a
// substring the evidence verifier (`anchorState`) can find again, so a
// finding built on one is anchored by construction.

export const DETECTORS = [
  "perception-verbs",
  "sentence-rhythm",
  "word-echo",
  "hedges",
  "attempt-verbs",
  "manner-adverbs",
  "dialogue-tags",
  "dialogue-runs",
  "numbers-in-narration",
  "dialogue-marks",
] as const;
export type DetectorId = (typeof DETECTORS)[number];

export const DETECTOR_IDS: ReadonlySet<string> = new Set(DETECTORS);

export interface SignalCandidate {
  readonly detector: DetectorId;
  /** An exact substring of the scanned text. */
  readonly quote: string;
  /** Which paragraph it was found in, for ranking by density. */
  readonly paragraph: number;
}

export interface SignalReport {
  /** The candidates kept, densest paragraphs first. */
  readonly candidates: readonly SignalCandidate[];
  /** How many each detector found before the cap; the model is told. */
  readonly found: ReadonlyMap<DetectorId, number>;
}

/** Per detector, and overall: the cap is on the model's attention. */
export const PER_DETECTOR = 6;
export const TOTAL_CANDIDATES = 18;
/** A quote longer than this is cut to a window around what was found. */
const QUOTE_MAX = 220;
/** Consecutive speech paragraphs before a run counts as talking heads. */
const RUN_LENGTH = 8;
/** Sentences in a window of near-identical length. */
const RHYTHM_WINDOW = 5;
/** How close two uses of one word must be to echo, in words. */
const ECHO_SPAN = 40;

interface Paragraph {
  readonly index: number;
  readonly text: string;
  /** Where each quoted speech span sits, as [start, end) in `text`. */
  readonly speech: readonly (readonly [number, number])[];
  /** The paragraph is a line of dialogue (opens with a quote or a dash). */
  readonly spoken: boolean;
}

const QUOTED = /«[^»]*»|“[^”]*”|"[^"\n]*"/g;
const OPENS_SPEECH = /^\s*(?:[«“"]|[—–]|-\s)/;
const LETTER = "\\p{L}";

function paragraphsOf(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  let index = 0;
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const speech: [number, number][] = [];
    for (const match of trimmed.matchAll(QUOTED))
      speech.push([match.index, match.index + match[0].length]);
    out.push({
      index: index++,
      text: trimmed,
      speech,
      spoken: OPENS_SPEECH.test(trimmed),
    });
  }
  return out;
}

function inSpeech(paragraph: Paragraph, at: number): boolean {
  if (paragraph.spoken && paragraph.speech.length === 0) return true;
  return paragraph.speech.some(([start, end]) => at >= start && at < end);
}

/** The sentences of a paragraph, as [start, end) offsets into it. */
function sentencesOf(text: string): [number, number][] {
  const out: [number, number][] = [];
  const pattern = /[^.!?…]+(?:[.!?…]+["»”’)]*|$)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const lead = raw.length - raw.trimStart().length;
    const start = match.index + lead;
    const end = match.index + raw.trimEnd().length;
    if (end > start) out.push([start, end]);
  }
  return out;
}

/** The sentence around `at`, cut to `QUOTE_MAX` around it if it is longer. */
function quoteAround(text: string, at: number, length: number): string {
  const sentence =
    sentencesOf(text).find(([start, end]) => at >= start && at < end) ??
    ([0, text.length] as [number, number]);
  const [start, end] = sentence;
  if (end - start <= QUOTE_MAX) return text.slice(start, end);
  const from = Math.max(start, at - Math.floor((QUOTE_MAX - length) / 2));
  return text.slice(from, Math.min(end, from + QUOTE_MAX));
}

function phrasePattern(phrases: readonly string[], prefix = ""): RegExp {
  const escaped = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((one) => escapeRegExp(one).replace(/ /g, "\\s+"));
  return new RegExp(
    `(?<!${LETTER})${prefix}(?:${escaped.join("|")})(?!${LETTER})`,
    "giu",
  );
}

function wordMatches(
  paragraphs: readonly Paragraph[],
  detector: DetectorId,
  pattern: RegExp,
  where: "narration" | "speech-paragraphs" | "anywhere",
): SignalCandidate[] {
  const out: SignalCandidate[] = [];
  for (const paragraph of paragraphs) {
    if (
      where === "speech-paragraphs" &&
      !paragraph.spoken &&
      paragraph.speech.length === 0
    )
      continue;
    for (const match of paragraph.text.matchAll(pattern)) {
      if (where === "narration" && inSpeech(paragraph, match.index)) continue;
      out.push({
        detector,
        quote: quoteAround(paragraph.text, match.index, match[0].length),
        paragraph: paragraph.index,
      });
    }
  }
  return out;
}

function perception(paragraphs: readonly Paragraph[], lexicon: Lexicon) {
  const subjects = lexicon.subjects.length
    ? `(?:${lexicon.subjects.join("|")})\\s+`
    : "";
  return wordMatches(
    paragraphs,
    "perception-verbs",
    phrasePattern(lexicon.perception, subjects),
    "narration",
  );
}

function adverbs(paragraphs: readonly Paragraph[], lexicon: Lexicon) {
  const stop = new Set(lexicon.adverbStoplist);
  const pattern = new RegExp(
    `(?<!${LETTER})${LETTER}{3,}${lexicon.adverbSuffix}(?!${LETTER})`,
    "gu",
  );
  return wordMatches(paragraphs, "manner-adverbs", pattern, "narration").filter(
    (candidate) => {
      const words = candidate.quote.match(pattern) ?? [];
      return words.some((word) => !stop.has(word.toLowerCase()));
    },
  );
}

function numbers(paragraphs: readonly Paragraph[], lexicon: Lexicon) {
  const units = lexicon.units.join("|");
  const pattern = new RegExp(
    `(?<![\\p{L}\\d])\\d+(?:[.,]\\d+)?(?:\\s*(?:${units}))?(?![\\p{L}\\d])`,
    "gu",
  );
  return wordMatches(paragraphs, "numbers-in-narration", pattern, "narration");
}

function runs(paragraphs: readonly Paragraph[]): SignalCandidate[] {
  const out: SignalCandidate[] = [];
  let run: Paragraph[] = [];
  const close = () => {
    if (run.length >= RUN_LENGTH)
      out.push({
        detector: "dialogue-runs",
        quote: run[0].text.slice(0, QUOTE_MAX),
        paragraph: run[0].index,
      });
    run = [];
  };
  for (const paragraph of paragraphs) {
    // Speech with almost nothing around it: the quoted spans removed, fewer
    // than nine words of narration are left.
    const outside = paragraph.speech.reduceRight(
      (text, [start, end]) => text.slice(0, start) + text.slice(end),
      paragraph.text,
    );
    const bare =
      paragraph.spoken &&
      (paragraph.speech.length === 0
        ? paragraph.text.split(/\s+/).length <= 40
        : outside.split(/\s+/).filter(Boolean).length <= 8);
    if (bare) run.push(paragraph);
    else close();
  }
  close();
  return out;
}

function marks(paragraphs: readonly Paragraph[]): SignalCandidate[] {
  const styleOf = (text: string): string | null => {
    const first = text.trimStart()[0];
    if (first === "«") return "guillemets";
    if (first === "“") return "curly";
    if (first === '"') return "straight";
    if (first === "—" || first === "–" || text.trimStart().startsWith("- "))
      return "dash";
    return null;
  };
  const byStyle = new Map<string, Paragraph[]>();
  for (const paragraph of paragraphs) {
    const style = styleOf(paragraph.text);
    if (style) byStyle.set(style, [...(byStyle.get(style) ?? []), paragraph]);
  }
  if (byStyle.size < 2) return [];
  const ranked = [...byStyle.values()].sort((a, b) => b.length - a.length);
  return ranked.slice(1).flatMap((minority) =>
    minority.map((paragraph) => ({
      detector: "dialogue-marks" as const,
      quote: paragraph.text.slice(0, QUOTE_MAX),
      paragraph: paragraph.index,
    })),
  );
}

function rhythm(paragraphs: readonly Paragraph[]): SignalCandidate[] {
  const all = paragraphs.flatMap((paragraph) =>
    sentencesOf(paragraph.text).map(([start, end]) => ({
      paragraph,
      text: paragraph.text.slice(start, end),
    })),
  );
  const out: SignalCandidate[] = [];
  for (let at = 0; at + RHYTHM_WINDOW <= all.length;) {
    const window = all.slice(at, at + RHYTHM_WINDOW);
    const lengths = window.map((one) => one.text.split(/\s+/).length);
    const sameLength =
      Math.min(...lengths) >= 6 &&
      Math.max(...lengths) / Math.min(...lengths) <= 1.25;
    const firsts = window.map((one) =>
      one.text
        .split(/\s+/)[0]
        ?.toLowerCase()
        .replace(/[^\p{L}]/gu, ""),
    );
    const sameOpening = firsts.every((word) => word && word === firsts[0]);
    if (sameLength || sameOpening) {
      out.push({
        detector: "sentence-rhythm",
        quote: window[0].text.slice(0, QUOTE_MAX),
        paragraph: window[0].paragraph.index,
      });
      at += RHYTHM_WINDOW;
    } else at += 1;
  }
  return out;
}

function echoes(
  paragraphs: readonly Paragraph[],
  lexicon: Lexicon,
): SignalCandidate[] {
  const stop = new Set(lexicon.echoStoplist);
  const out: SignalCandidate[] = [];
  const last = new Map<string, number>();
  let position = 0;
  for (const paragraph of paragraphs) {
    for (const match of paragraph.text.matchAll(/\p{L}+(?:['’]\p{L}+)?/gu)) {
      position += 1;
      const word = match[0];
      // Names are repeated by intent; so are the long function words.
      if (word.length < 6 || word[0] !== word[0].toLowerCase()) continue;
      const key = word.toLowerCase();
      if (stop.has(key)) continue;
      const before = last.get(key);
      last.set(key, position);
      if (before !== undefined && position - before <= ECHO_SPAN)
        out.push({
          detector: "word-echo",
          quote: quoteAround(paragraph.text, match.index, word.length),
          paragraph: paragraph.index,
        });
    }
  }
  return out;
}

/**
 * Run `detectors` over `text` with `lexicon`, and keep the candidates worth a
 * model's attention: at most `PER_DETECTOR` of each and `TOTAL_CANDIDATES` in
 * all, from the paragraphs where they are densest: twelve filter verbs in
 * one paragraph outrank one in a chapter. A detector keeps each quote once.
 */
export function detectSignals(
  text: string,
  lexicon: Lexicon,
  detectors: readonly DetectorId[],
): SignalReport {
  const paragraphs = paragraphsOf(text);
  const wanted = new Set(detectors);
  const found: SignalCandidate[] = [];
  const run = (id: DetectorId, make: () => SignalCandidate[]) => {
    if (wanted.has(id)) found.push(...make());
  };
  run("perception-verbs", () => perception(paragraphs, lexicon));
  run("hedges", () =>
    wordMatches(
      paragraphs,
      "hedges",
      phrasePattern(lexicon.hedges),
      "narration",
    ),
  );
  run("attempt-verbs", () =>
    wordMatches(
      paragraphs,
      "attempt-verbs",
      phrasePattern(lexicon.attempts),
      "narration",
    ),
  );
  run("manner-adverbs", () => adverbs(paragraphs, lexicon));
  run("dialogue-tags", () =>
    wordMatches(
      paragraphs,
      "dialogue-tags",
      phrasePattern(lexicon.tags),
      "speech-paragraphs",
    ),
  );
  run("numbers-in-narration", () => numbers(paragraphs, lexicon));
  run("dialogue-runs", () => runs(paragraphs));
  run("dialogue-marks", () => marks(paragraphs));
  run("sentence-rhythm", () => rhythm(paragraphs));
  run("word-echo", () => echoes(paragraphs, lexicon));

  const counts = new Map<DetectorId, number>();
  for (const one of found)
    counts.set(one.detector, (counts.get(one.detector) ?? 0) + 1);
  const density = new Map<number, number>();
  for (const one of found)
    density.set(one.paragraph, (density.get(one.paragraph) ?? 0) + 1);
  const ranked = found
    .map((one, order) => ({ one, order }))
    .sort(
      (a, b) =>
        (density.get(b.one.paragraph) ?? 0) -
          (density.get(a.one.paragraph) ?? 0) || a.order - b.order,
    )
    .map(({ one }) => one);
  const kept: SignalCandidate[] = [];
  const perDetector = new Map<DetectorId, number>();
  const quotes = new Set<string>();
  for (const one of ranked) {
    if (kept.length >= TOTAL_CANDIDATES) break;
    const taken = perDetector.get(one.detector) ?? 0;
    if (
      taken >= PER_DETECTOR ||
      quotes.has(`${one.detector}\u0000${one.quote}`)
    )
      continue;
    perDetector.set(one.detector, taken + 1);
    quotes.add(`${one.detector}\u0000${one.quote}`);
    kept.push(one);
  }
  return { candidates: kept, found: counts };
}
