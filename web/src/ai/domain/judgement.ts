// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What the judge said about each candidate, kept. The judge
// (`application/judge.ts`) asks one question per candidate, and its answer
// depends only on that question, so an answer is as reusable as a ledger:
// while the question and the judge's prompt are the same, asking again costs
// money and says the same thing. A kept verdict can also be read afterwards,
// which tells a slip the judge turned down apart from one the ledgers never
// raised (`scripts/plant-eval.mjs ledgers`).
//
// One file per project, derived like a ledger: lost or unreadable, every
// candidate is asked again.

export const VERDICTS = [
  "conflict",
  "different-things",
  "narrated-change",
  "unsure",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const SEVERITIES = ["observation", "minor", "major"] as const;
export type JudgedSeverity = (typeof SEVERITIES)[number];

export interface Judgement {
  verdict: Verdict;
  severity: JudgedSeverity;
  title: string;
  explanation: string;
  /** For `unsure`, what the passages could not tell; otherwise empty. */
  doubt: string;
}

/** A kept judgement, with the model that gave it, for the record. */
export interface KeptJudgement extends Judgement {
  model: string;
}

export interface Judgements {
  /**
   * Which judge wrote them (`JUDGE_RECIPE_REVISION`); another judge's are
   * asked again.
   */
  recipeRevision: string;
  /** By `judgementId`, oldest first. */
  judgements: Record<string, KeptJudgement>;
}

/**
 * Bumped when the judge's prompt or answer shape changes, because a verdict
 * given under another prompt or field order was given by another judge.
 */
export const JUDGE_RECIPE_REVISION = "10";

/**
 * How many judgements the file keeps. The newest stay: a judgement for a
 * text edited since is never asked for again, and falls out by age.
 */
export const JUDGEMENTS_KEPT = 400;

/**
 * What a judgement is of: the candidate's key, the revision of each text
 * its sides point into, and a digest of the whole question as the judge
 * was shown it. Any of them changing asks again.
 *
 * The question holds more than the two quoted places: the story's last date
 * before each, how often the book states each value, what the writer's
 * sheets say about the fact, and the fact's history through the book. Any of
 * those can change while both quoted Sections stay the same, so an id keyed
 * on the two revisions alone would hand back the verdict of a question
 * nobody asked. The message is built from its inputs and nothing else, so
 * keying on it still reuses unchanged inputs. The revisions stay in the id so
 * a reader of the file can tell which texts a verdict was of.
 */
export function judgementId(
  key: string,
  sides: readonly { sourceId: string; revision: string }[],
  message: string,
  /**
   * Who answered: the model, and the language its title and explanation
   * were written in. Another model's verdict is not this one's, and a
   * verdict worded in another language would be shown to the writer in it.
   * The language instruction sits outside the hashed question, so it must
   * be part of the id.
   */
  by: string,
): string {
  return [
    key,
    ...sides.map((side) => `${side.sourceId}@${side.revision}`),
    `q:${digestOf(message)}`,
    `by:${by}`,
  ]
    .map((part) => encodeURIComponent(part))
    .join(" ");
}

/**
 * A short, stable digest of a string: FNV-1a over its UTF-16 units, in
 * hex. It is not a cryptographic hash: two questions that collide reuse a
 * verdict wrongly, and 32 bits over a few hundred entries makes that
 * vanishingly rare. It is synchronous, which `crypto.subtle` is not, so an id
 * can be built where it is needed.
 */
export function digestOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function line(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/gu, " ").trim().slice(0, max)
    : "";
}

/**
 * A judgement as the model answered it, or `null` when it is none: a verdict
 * off the list, or no title or explanation. An unknown severity is minor.
 */
export function judgementOf(value: unknown): Judgement | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as Record<string, unknown>;
  const verdict = answer.verdict as Verdict;
  if (!VERDICTS.includes(verdict)) return null;
  const title = line(answer.title, 160);
  const explanation = line(answer.explanation, 1_200);
  if (!title || !explanation) return null;
  const severity = SEVERITIES.includes(answer.severity as JudgedSeverity)
    ? (answer.severity as JudgedSeverity)
    : "minor";
  return {
    verdict,
    severity,
    title,
    explanation,
    doubt: line(answer.doubt, 600),
  };
}

/** The kept file, or `null` when it is not one. A bad entry is left out. */
export function judgementsOf(value: unknown): Judgements | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.recipeRevision !== "string" ||
    !raw.judgements ||
    typeof raw.judgements !== "object"
  )
    return null;
  const judgements: Record<string, KeptJudgement> = {};
  for (const [id, one] of Object.entries(raw.judgements)) {
    const judgement = judgementOf(one);
    const model = (one as Record<string, unknown> | null)?.model;
    if (judgement && typeof model === "string")
      judgements[id] = { ...judgement, model };
  }
  return { recipeRevision: raw.recipeRevision, judgements };
}

/**
 * `kept` with `fresh` added as the newest, trimmed to `JUDGEMENTS_KEPT`. A
 * judgement asked again moves to the end, so what is in use stays.
 */
export function keepJudgements(
  kept: Judgements | null,
  fresh: Readonly<Record<string, KeptJudgement>>,
): Judgements {
  const all = new Map(
    kept?.recipeRevision === JUDGE_RECIPE_REVISION
      ? Object.entries(kept.judgements)
      : [],
  );
  for (const [id, judgement] of Object.entries(fresh)) {
    all.delete(id);
    all.set(id, judgement);
  }
  return {
    recipeRevision: JUDGE_RECIPE_REVISION,
    judgements: Object.fromEntries([...all].slice(-JUDGEMENTS_KEPT)),
  };
}
