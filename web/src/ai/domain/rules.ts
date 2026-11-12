// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ParsedReference, ReferenceRecord } from "./referenceRecords";
import { mentions } from "./referenceRender";
import { excerptAround, fold } from "./textMatch";
import { escapeRegExp } from "../../text/regExp";

// ── The writer's rules in the prose ──────────────────────────────────────────
//
// The fact check finds what two places state two ways. A rule broken by one
// scene is no such pair: "no one can teleport" is never stated twice, it is
// broken on page forty. The candidates cannot raise it, and the judge, which
// answers only what the candidates ask, never sees it; a rule shown to the
// judge is not a rule detected. So the rules are checked on their own:
// each rule record (a field the catalogue flags `rules`) is joined
// with what qualifies it, the prose is searched for the passages it could
// bear on, and one question asks whether each passage breaks it.
//
// Three facts about a rule are kept apart, because conflating them is how a
// check claims more than it did:
// - what qualifies it: the page's own exceptions and costs, and any record
//   on another page flagged as an exception that names the rule's entity, so
//   "teleportation is impossible" is never asked without "except through the
//   temple gates";
// - how much of the scope was looked at (`RuleCoverage`);
// - the verdict, which speaks only for the passages examined.

/** A record with the document it came from. */
export interface PlacedRecord {
  sourceId: string;
  title: string;
  revision: string;
  /** The document's text as parsed, which the record's offsets index. */
  text: string;
  record: ReferenceRecord;
}

/** One rule to hold the prose to, with what qualifies it. */
export interface Rule extends PlacedRecord {
  /** Whom it is about: a block's instance, a character sheet's person. */
  entity: string | null;
  exceptions: PlacedRecord[];
}

/** A reference as the rule check reads it. */
export interface RuleDocument {
  sourceId: string;
  title: string;
  revision: string;
  /** The text `parsed` was parsed from. */
  text: string;
  parsed: ParsedReference;
}

/** The whole text of a record, its lines joined. */
export function recordText(record: ReferenceRecord): string {
  return record.lines.map((line) => line.text).join("\n");
}

/**
 * Every rule in `documents`, each with its exceptions: a record flagged
 * `exceptions` in the same document and the same block instance (or at the
 * page's own level, for a rule there), and one in another document when it
 * names the rule's entity. A record flagged both (a page's "Costs and
 * limitations") is a rule and qualifies the page's other rules.
 */
export function rulesOf(
  documents: readonly RuleDocument[],
  // Which notes: the writer's rules, or their notes on who knows what and
  // from when, which the knowledge check asks about the same way.
  flag: "rules" | "knowing" = "rules",
): Rule[] {
  const placed = documents.flatMap((document) =>
    document.parsed.records.map((record) => ({
      sourceId: document.sourceId,
      title: document.title,
      revision: document.revision,
      text: document.text,
      record,
    })),
  );
  const exceptions = placed.filter(
    (one) => one.record.field?.flags.has("exceptions") === true,
  );
  return placed
    .filter((one) => one.record.field?.flags.has(flag) === true)
    .map((rule) => {
      const entity = rule.record.entity;
      return {
        ...rule,
        entity,
        exceptions: exceptions.filter(
          (one) =>
            one.record !== rule.record &&
            (one.sourceId === rule.sourceId
              ? one.record.instance === rule.record.instance
              : entity !== null && mentions(entity, recordText(one.record))),
        ),
      };
    });
}

/** A Section the rule check may read, as the run read it. */
export interface RuleSection {
  sourceId: string;
  title: string;
  revision: string;
  text: string;
  /**
   * Its place in the book, when the run knows it: a note on who knows what
   * says "only in section 5", and only the place can hold a passage to it.
   */
  position?: { at: number; of: number };
}

/** A place in the prose a rule may bear on. */
export interface RulePassage {
  sourceId: string;
  /** Where the passage starts in its Section's text. */
  at: number;
  text: string;
}

/**
 * How much of the scope a rule's verdict speaks for. `unmatched`:
 * no passage of the scope mentions what the rule is about, so it was not
 * checked, never "kept". `partial`: more passages matched than one
 * question may examine, or the rule was not asked this time. `checked`:
 * every matching passage in the scope was examined.
 */
export type RuleCoverage = "unmatched" | "partial" | "checked";

/** Characters each way around a match in a passage. */
export const RULE_PASSAGE_SIDE = 240;

/**
 * The most characters of matches one passage spans, its sides aside, so a
 * passage stays a passage when a rule's words run through a whole scene.
 */
export const RULE_PASSAGE_SPAN = 600;

/** The most passages one rule's question examines. */
export const RULE_PASSAGES = 4;

/** A word worth searching for: five letters or more, folded. */
const SEARCH_WORD = 5;

/**
 * The words a rule is searched for by: those of the rule, its exceptions
 * and its entity's name, five letters or more, folded, less every word that
 * nearly every Section of a scope of five or more uses, which says nothing
 * of where the rule applies ("which", "their", "quale"). Nearly every, not
 * most: a rule the book breaks in most chapters is still searched by its own
 * words. A rule of frequency, not a list of words, so it holds in
 * every language.
 */
export function ruleTerms(
  rule: Rule,
  sections: readonly RuleSection[],
): string[] {
  const words = new Set<string>();
  for (const text of [
    recordText(rule.record),
    ...rule.exceptions.map((one) => recordText(one.record)),
    rule.entity ?? "",
  ])
    for (const word of fold(text).split(/[^\p{L}\p{N}]+/u))
      if (word.length >= SEARCH_WORD) words.add(word);
  if (sections.length < COMMON_SCOPE) return [...words];
  const folded = sections.map((one) => ` ${fold(one.text)} `);
  return [...words].filter(
    (word) =>
      folded.filter((text) =>
        new RegExp(`[^\\p{L}\\p{N}]${word}[^\\p{L}\\p{N}]`, "u").test(text),
      ).length <
      sections.length * COMMON_SHARE,
  );
}

/** The fewest Sections a scope needs before a word can be too common. */
const COMMON_SCOPE = 5;

/** The share of a scope's Sections a word must be in to be too common. */
const COMMON_SHARE = 0.8;

/**
 * The passages of `sections` a rule may bear on, best first, and how much
 * of the scope they cover. A passage is the words around a place where two
 * or more of the rule's terms meet within a passage's reach, or where its
 * entity is named, through every match that follows; passages
 * overlap only past `RULE_PASSAGE_SPAN`. At most `RULE_PASSAGES` are
 * returned; more matching is `partial`, none is `unmatched`.
 */
export function rulePassages(
  rule: Rule,
  sections: readonly RuleSection[],
): { passages: RulePassage[]; coverage: RuleCoverage } {
  const terms = ruleTerms(rule, sections);
  const entityWords = rule.entity
    ? fold(rule.entity)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 4)
    : [];
  const found: Array<RulePassage & { score: number }> = [];
  for (const section of sections) {
    const folded = fold(section.text);
    const hits: Array<{ at: number; word: string }> = [];
    for (const word of new Set([...terms, ...entityWords]))
      for (const match of folded.matchAll(
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`,
          "gu",
        ),
      ))
        hits.push({ at: match.index, word });
    hits.sort((a, b) => a.at - b.at);
    let reach = -1;
    for (const hit of hits) {
      if (hit.at < reach) continue;
      const near = new Set(
        hits
          .filter((one) => Math.abs(one.at - hit.at) <= RULE_PASSAGE_SIDE)
          .map((one) => one.word),
      );
      const named = entityWords.some((word) => near.has(word));
      if (near.size < 2 && !named) continue;
      // The passage runs on to every match that follows within two sides of
      // the last one it took, so no match between two shown passages is
      // skipped unseen. Past `RULE_PASSAGE_SPAN` the next match
      // opens a passage of its own.
      let last = hit.at + hit.word.length;
      for (const one of hits) {
        if (one.at <= hit.at) continue;
        if (one.at > last + RULE_PASSAGE_SIDE * 2) break;
        if (one.at + one.word.length - hit.at > RULE_PASSAGE_SPAN) break;
        last = Math.max(last, one.at + one.word.length);
      }
      const start = Math.max(0, hit.at - RULE_PASSAGE_SIDE);
      const text = excerptAround(section.text, hit.at, last, RULE_PASSAGE_SIDE);
      found.push({
        sourceId: section.sourceId,
        at: start,
        text,
        score: near.size + (named ? 1 : 0),
      });
      // One side on: a match the span cap left out opens the next passage,
      // which may then share up to a side of text with this one.
      reach = last + RULE_PASSAGE_SIDE;
    }
  }
  if (found.length === 0) return { passages: [], coverage: "unmatched" };
  const best = [...found]
    .sort((a, b) => b.score - a.score)
    .slice(0, RULE_PASSAGES)
    .map(({ score: _, ...one }) => one);
  return {
    passages: best,
    coverage: found.length > RULE_PASSAGES ? "partial" : "checked",
  };
}

// ── A rule's answer and the kept answers ─────────────────────────────────────

/** What one passage does to the rule, as the check's reader answered. */
export const RULE_VERDICTS = ["breaks", "keeps", "unclear"] as const;
export type RuleVerdict = (typeof RULE_VERDICTS)[number];

export interface RulePassageAnswer {
  /** The passage's number in the question, from 1. */
  passage: number;
  explanation: string;
  /** The passage's own words that break it, or that leave it unclear. */
  quote: string;
  verdict: RuleVerdict;
  severity: "minor" | "major";
}

/**
 * Bumped when the rule check's question or answer shape changes; a kept
 * answer under another is asked again.
 */
export const RULE_CHECK_RECIPE_REVISION = "1";

/** The most kept answers the cache holds; the oldest go first. */
export const RULE_CHECKS_KEPT = 400;

export interface RuleChecks {
  recipeRevision: string;
  /** By question key (`ruleQuestionKey`). */
  answers: Record<string, RulePassageAnswer[]>;
  /**
   * The keys of `answers`, oldest first. An object lists a key of digits
   * alone ("12345678", a digest like any other) before every other key, so
   * its own order cannot say which is oldest. Absent, every key is as old.
   */
  order?: string[];
}

/** One kept answer, or `null` when it is not one. */
function passageAnswerOf(value: unknown): RulePassageAnswer | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.passage !== "number" ||
    !Number.isInteger(raw.passage) ||
    raw.passage < 1 ||
    typeof raw.explanation !== "string" ||
    typeof raw.quote !== "string" ||
    !RULE_VERDICTS.includes(raw.verdict as RuleVerdict) ||
    (raw.severity !== "minor" && raw.severity !== "major")
  )
    return null;
  return {
    passage: raw.passage,
    explanation: raw.explanation.slice(0, 2_000),
    quote: raw.quote.slice(0, 600),
    verdict: raw.verdict as RuleVerdict,
    severity: raw.severity,
  };
}

/** A rule's answer as a list of passage answers, or `null` if it is none. */
export function ruleAnswerOf(value: unknown): RulePassageAnswer[] | null {
  const list = (value as { passages?: unknown } | null)?.passages;
  if (!Array.isArray(list)) return null;
  const answers: RulePassageAnswer[] = [];
  for (const one of list.slice(0, RULE_PASSAGES)) {
    const answer = passageAnswerOf(one);
    if (answer) answers.push(answer);
  }
  return answers;
}

/**
 * Kept answers, or `null` when they are none or not the current recipe's. A
 * malformed entry drops that entry; the rest are kept.
 */
export function ruleChecksOf(value: unknown): RuleChecks | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.recipeRevision !== RULE_CHECK_RECIPE_REVISION ||
    !raw.answers ||
    typeof raw.answers !== "object"
  )
    return null;
  const answers: Record<string, RulePassageAnswer[]> = {};
  for (const [key, one] of Object.entries(raw.answers as object)) {
    // A key is a digest (`digestOf`: eight hex digits) and nothing else: a
    // file edited to hold `__proto__` would re-parent the object it is
    // written into.
    if (!/^[0-9a-f]{8}$/u.test(key)) continue;
    const answer = ruleAnswerOf({ passages: one });
    if (answer) answers[key] = answer;
  }
  return {
    recipeRevision: RULE_CHECK_RECIPE_REVISION,
    answers,
    order: orderOf(answers, raw.order),
  };
}

/**
 * The keys of `answers`, oldest first, by `order`: a key it does not list
 * counts as older than every key it does, and a key it lists that `answers`
 * lacks is left out.
 */
function orderOf(
  answers: Readonly<Record<string, unknown>>,
  order: unknown,
): string[] {
  const keys = Object.keys(answers);
  const present = new Set(keys);
  const listed = new Set(
    (Array.isArray(order) ? order : []).filter(
      (key): key is string => typeof key === "string" && present.has(key),
    ),
  );
  return [...keys.filter((key) => !listed.has(key)), ...listed];
}

/**
 * `kept` with `fresh` added as the newest, the oldest dropped past
 * `RULE_CHECKS_KEPT`. An answer given again moves to the newest.
 */
export function keepRuleChecks(
  kept: RuleChecks | null,
  fresh: Readonly<Record<string, RulePassageAnswer[]>>,
): RuleChecks {
  const merged = { ...(kept?.answers ?? {}), ...fresh };
  const asked = Object.keys(fresh);
  const again = new Set(asked);
  const keys = [
    ...orderOf(kept?.answers ?? {}, kept?.order).filter(
      (key) => !again.has(key),
    ),
    ...asked,
  ].slice(-RULE_CHECKS_KEPT);
  return {
    recipeRevision: RULE_CHECK_RECIPE_REVISION,
    answers: Object.fromEntries(keys.map((key) => [key, merged[key]])),
    order: keys,
  };
}
