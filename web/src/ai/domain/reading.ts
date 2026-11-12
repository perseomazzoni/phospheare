// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  READING_LIMITS,
  type Attention,
  type JournalEntry,
  type Prediction,
  type PredictionState,
  type ReadingRecord,
  type SourceDescriptor,
} from "./types";

// A beta reader's reading: the rules of the journal and the prediction
// ledger, apart from any run.
//
// A beta reader's predictions are worth something only because it has not
// read what comes next, so the journal walks the book one Section at a time
// and never skips ahead. The next Section is the one after the last one
// journaled, never a Section the writer happens to have open.

/** An empty reading: nothing read, nothing expected. */
export const NO_READING: ReadingRecord = { entries: [], predictions: [] };

/** The manuscript's Sections, in reading order (the listing's own order). */
function sectionsOf(catalog: readonly SourceDescriptor[]): SourceDescriptor[] {
  return catalog.filter(
    (source) =>
      source.kind === "manuscript" &&
      source.nodeKind === "section" &&
      source.nodeId !== undefined,
  );
}

/**
 * The Section `/read-on` reads next: the first one after the last Section the
 * journal holds that it does not hold yet — or the first Section of the book
 * when nothing is journaled. Null when the reader has finished the book.
 *
 * "After the last one it holds" and not "after the last entry", because a
 * Section can be deleted or moved after it was read: an entry whose Section
 * is gone is skipped over, and a Section moved behind the reader is not read
 * a second time.
 *
 * Null too when the journal is at its cap: `foldReading` would drop the
 * entry, and the same Section would be offered on every run.
 */
export function nextSection(
  catalog: readonly SourceDescriptor[],
  reading: ReadingRecord | undefined,
): SourceDescriptor | null {
  if ((reading?.entries.length ?? 0) >= READING_LIMITS.entries) return null;
  const sections = sectionsOf(catalog);
  const read = new Set((reading?.entries ?? []).map((entry) => entry.nodeId));
  let from = 0;
  sections.forEach((section, at) => {
    if (read.has(section.nodeId as string)) from = at + 1;
  });
  return (
    sections
      .slice(from)
      .find((section) => !read.has(section.nodeId as string)) ?? null
  );
}

/** Where the reader stands: the last Section it journaled, or null. */
export function readingPosition(
  reading: ReadingRecord | undefined,
): string | null {
  const entries = reading?.entries ?? [];
  return entries.length > 0 ? entries[entries.length - 1].nodeId : null;
}

/** A prediction id's shape: `p` and a number. */
export const PREDICTION_ID = /^p[1-9]\d{0,5}$/;

/**
 * The next prediction id: `p` and one past the highest number the ledger
 * holds. Short and readable because the model settles predictions by id,
 * and a uuid is forty characters of noise it can mistype. One past the
 * highest, not the ledger's length, so an id is never handed out twice
 * even when a hand-edited file lost a row the codec dropped.
 */
function nextPredictionId(predictions: readonly Prediction[]): string {
  const highest = predictions.reduce(
    (most, one) => Math.max(most, Number(one.id.slice(1)) || 0),
    0,
  );
  return `p${highest + 1}`;
}

/** How the reader settled one open prediction after reading on. */
export interface Settlement {
  id: string;
  state: PredictionState;
  note?: string;
}

/**
 * The record with one answer folded in: a Section journaled (`entry`), the
 * open predictions it settled, and new ones written where the reader now
 * stands. Pure, capped and total:
 *
 * - a settlement for an id the ledger does not hold, or one already settled,
 *   is dropped, because the model may only settle what it was shown as open;
 * - `open` as a settlement leaves the prediction open, keeping any note;
 * - the ledger and the journal stop growing at their caps, keeping the
 *   oldest, because the start of a reading is what a later one is measured
 *   by.
 */
export function foldReading(
  record: ReadingRecord | undefined,
  answer: {
    entry?: JournalEntry;
    settled?: readonly Settlement[];
    predictions?: readonly string[];
    /** Where new predictions are made: the Section just read, or absent. */
    madeAt?: string;
    at: string;
  },
): ReadingRecord {
  const base = record ?? NO_READING;
  const settled = new Map(
    (answer.settled ?? []).map((one) => [one.id, one] as const),
  );
  const predictions = base.predictions.map((prediction) => {
    const settlement = settled.get(prediction.id);
    if (!settlement || prediction.state !== "open") return prediction;
    const note = settlement.note?.trim();
    if (settlement.state === "open")
      return note ? { ...prediction, note } : prediction;
    return {
      ...prediction,
      state: settlement.state,
      ...(answer.madeAt ? { resolvedAt: answer.madeAt } : {}),
      ...(note ? { note } : {}),
    };
  });
  for (const text of answer.predictions ?? []) {
    if (predictions.length >= READING_LIMITS.predictions) break;
    predictions.push({
      id: nextPredictionId(predictions),
      text,
      ...(answer.madeAt ? { madeAt: answer.madeAt } : {}),
      state: "open",
    });
  }
  const entries =
    answer.entry && base.entries.length < READING_LIMITS.entries
      ? [...base.entries, answer.entry]
      : base.entries;
  return { entries, predictions };
}

/**
 * The attention curve: one point per Section read, in reading order. A
 * put-down point is a Section after which the reader would not read on.
 * The curve marks it whatever the attention score says, because "I would
 * stop here" is the reader's verdict and the score is only its mood.
 */
export function attentionCurve(
  reading: ReadingRecord | undefined,
): { nodeId: string; attention: Attention; putDown: boolean }[] {
  return (reading?.entries ?? []).map((entry) => ({
    nodeId: entry.nodeId,
    attention: entry.attention,
    putDown: !entry.keepReading,
  }));
}
