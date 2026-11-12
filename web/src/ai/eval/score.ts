// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Plant scoring ────────────────────────────────────────────────────────────
//
// Whether a review's findings quote the planted words from the Section, or
// the sheet, they were planted in (`found`). Where a plant was lost before
// that, never in a ledger or never raised as a candidate, is read off a live
// run's stored files by `scripts/plant-eval.mjs ledgers`.
//
// A plant counts once. Recall is per kind.

import { fold } from "../domain/textMatch";
import type { Plant, PlantKind } from "./plant";

/** The evidence a finding quotes, as a review writes it, and its own words. */
export interface ScoredFinding {
  evidence: ReadonlyArray<{ sourceId: string; quote: string }>;
  title?: string;
  explanation?: string;
}

/**
 * How a finding that touched a plant relates to the slip:
 *
 * - `witness`: the finding also quotes one of the plant's witnesses, the
 *   sentences where the book states the same fact, which the planter
 *   recorded when it chose the plant. The two places of the slip.
 * - `self-verifying`: the plant stands on its own (a weekday the calendar
 *   pins, a name used three times), so one citation is the diagnosis.
 * - `contact-only`: the finding quotes the planted words and nothing that
 *   states the fact elsewhere. That is evidence contact, which a mistaken or
 *   irrelevant finding makes too: neither any second source nor any quote
 *   of the old word is a diagnosis on its own.
 * - `missed`: no finding quotes the plant.
 */
export type Diagnosis =
  "witness" | "self-verifying" | "contact-only" | "missed";

export interface ScoredPlant {
  plant: Plant;
  /** Some finding quotes the planted words from their source. */
  found: boolean;
  /** That finding also quotes a witness of the plant. */
  witnessed: boolean;
  diagnosis: Diagnosis;
  /**
   * Whether the finding's own words, its title and explanation, name both
   * sides of the slip, the old words and the new. Read apart from the
   * evidence: two findings quoting the same places, one about the slip and
   * one about something else, are told apart here and nowhere else.
   * Absent when the finding carries no words to read.
   */
  explained?: boolean;
}

/**
 * Each plant against a review's findings. `sourceIdOf` maps a plant's
 * source to the id a finding cites (a project's `node:EL4` for its
 * `section--….md`); identity by default.
 *
 * A witness is quoted when the finding's anchor in the witness's source
 * overlaps its sentence (the anchor within the sentence, or the sentence
 * within the anchor) and holds the old words. Nothing here reads the
 * relationship a finding asserts between its places; the explanation check
 * is a word test, and says so.
 */
export function scoreFindings(
  plants: readonly Plant[],
  findings: readonly ScoredFinding[],
  sourceIdOf: (plant: Plant) => string = (plant) => plant.sourceId,
): ScoredPlant[] {
  return plants.map((plant) => {
    const id = sourceIdOf(plant);
    const after = fold(plant.after);
    const before = fold(plant.before);
    const touches = (item: { sourceId: string; quote: string }) =>
      item.sourceId === id && fold(item.quote).includes(after);
    const contact = findings.filter((finding) =>
      finding.evidence.some(touches),
    );
    const witnesses = (plant.witnesses ?? []).map((one) => ({
      sourceId: sourceIdOf({ ...plant, sourceId: one.sourceId }),
      quote: fold(one.quote),
    }));
    const quotesWitness = (item: { sourceId: string; quote: string }) => {
      const quote = fold(item.quote);
      return (
        !touches(item) &&
        quote.includes(before) &&
        witnesses.some(
          (witness) =>
            witness.sourceId === item.sourceId &&
            (witness.quote.includes(quote) || quote.includes(witness.quote)),
        )
      );
    };
    const witnessing = contact.filter((finding) =>
      finding.evidence.some(quotesWitness),
    );
    const found = contact.length > 0;
    const witnessed = witnessing.length > 0;
    const diagnosis: Diagnosis = !found
      ? "missed"
      : witnessed
        ? "witness"
        : plant.selfVerifying
          ? "self-verifying"
          : "contact-only";
    const worded = (witnessed ? witnessing : contact).filter(
      (finding) =>
        finding.title !== undefined || finding.explanation !== undefined,
    );
    const explained =
      worded.length === 0
        ? undefined
        : worded.some((finding) => {
            const words = fold(
              `${finding.title ?? ""} ${finding.explanation ?? ""}`,
            );
            return words.includes(before) && words.includes(after);
          });
    return {
      plant,
      found,
      witnessed,
      diagnosis,
      ...(explained === undefined ? {} : { explained }),
    };
  });
}

export interface KindRecall {
  kind: PlantKind;
  planted: number;
  hit: number;
}

/**
 * Hits over plants, per kind, in `PLANT_KINDS` order; a kind never planted
 * is left out.
 */
export function recallByKind(
  results: ReadonlyArray<{ plant: Plant; hit: boolean }>,
  kinds: readonly PlantKind[],
): KindRecall[] {
  return kinds.flatMap((kind) => {
    const mine = results.filter((one) => one.plant.kind === kind);
    return mine.length === 0
      ? []
      : [
          {
            kind,
            planted: mine.length,
            hit: mine.filter((one) => one.hit).length,
          },
        ];
  });
}

// ── Written disagreements ────────────────────────────────────────────────────
//
// The guided book (`src/ai/eval/guided`) plants nothing: its
// disagreements are written into it, and its guidebook explains some of them
// away. What a check should say of it is fixed in `expect.json`. A finding on
// an explained disagreement is a false positive; an unexplained one is a slip
// the guidance must not hide. A finding matches when it quotes both sides.

/** One side of a written disagreement: the Sections stating it, its words. */
export interface ExpectedSide {
  sources: readonly string[];
  words: readonly string[];
}

/**
 * What a check is known not to find, and why: `loss`, a
 * disagreement whose reference side is context only by policy (a free note,
 * a field the writer renamed), so no candidate may stand on it; `limit`,
 * one the check does not claim to detect (a person acting on knowledge they
 * have not acquired yet). Scored and reported like any other, beside recall
 * and never in it, so the figure never hides the loss the policy chose.
 */
export type KnownMiss = "loss" | "limit";

/**
 * A disagreement the book was written with, and whether its guidebook
 * explains it.
 */
export interface Expectation {
  id: string;
  explained: boolean;
  known?: KnownMiss;
  sides: readonly ExpectedSide[];
}

export interface ScoredExpectation {
  id: string;
  explained: boolean;
  known?: KnownMiss;
  /** How many findings quote both of its sides. */
  findings: number;
}

/**
 * Whether `finding` quotes every side of `expectation` from a Section that
 * states it.
 */
function quotesEverySide(
  finding: ScoredFinding,
  expectation: Expectation,
): boolean {
  return expectation.sides.every((side) =>
    finding.evidence.some(
      (anchor) =>
        side.sources.includes(anchor.sourceId) &&
        side.words.some((word) => fold(anchor.quote).includes(fold(word))),
    ),
  );
}

/**
 * Each written disagreement with the findings that quote it, and how many
 * findings quote none: those are about something the book was not written
 * to disagree on, and every one is a false positive.
 */
export function scoreExpectations(
  expectations: readonly Expectation[],
  findings: readonly ScoredFinding[],
): { expectations: ScoredExpectation[]; unexpected: number } {
  return {
    expectations: expectations.map((expectation) => ({
      id: expectation.id,
      explained: expectation.explained,
      ...(expectation.known ? { known: expectation.known } : {}),
      findings: findings.filter((finding) =>
        quotesEverySide(finding, expectation),
      ).length,
    })),
    unexpected: findings.filter(
      (finding) =>
        !expectations.some((expectation) =>
          quotesEverySide(finding, expectation),
        ),
    ).length,
  };
}
