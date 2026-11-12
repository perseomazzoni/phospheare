// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { TFunction } from "i18next";
import { appIcons } from "../../ui/appIcons";
import type { IconName } from "../../ui";
import {
  judged,
  type ChatTurn,
  type ClaimVerdict,
  type VerifyOutcome,
  type WebSearchRecord,
} from "../../ai/domain/types";
import type { CitedSource } from "../../ai/domain/webCitations";

// What a `/verify` answer says, before anything draws it. Pure: no
// React and no i18n instance, like `mapAnswer.ts`. The screen
// (`AiVerifyAnswer.tsx`) and the plain-text Copy (`turnText.ts`) read the
// same functions here, so the hint, the quotes and their order can never say
// one thing on screen and another on the clipboard.
//
// Everything is read from the stored answer (the block the codec kept,
// `sanitizeVerified`) and the chat's one citation walk; nothing here derives
// an ordinal or a host of its own.

/** A `/verify` that reached a verdict. */
type JudgedOutcome = Extract<VerifyOutcome, { verdict: ClaimVerdict }>;

/**
 * A `/verify` answer's outcome, only once the check settled: the answer is
 * marked `verifies`, holds a block, and its run ended `complete`. The one
 * test the screen and the Copy both ask, so neither shows a verdict the
 * other would not. A run writes the block only with `complete`, but the
 * codec checks the block alone, so an edited file can hold one beside an
 * interrupted or failed ending, and an unfinished check draws no mark and
 * copies nothing.
 */
export function settledVerdict(turn: ChatTurn): VerifyOutcome | null {
  return turn.verifies && turn.verified && turn.outcome === "complete"
    ? turn.verified
    : null;
}

/**
 * The degree each verdict draws, as the `.ai-mark` modifier names it (a
 * modifier names what is drawn, so `/map` and `/verify` share one family),
 * and the glyph that draws it. Closed lookups over the four verdicts: a
 * fifth does not compile until someone decides how it looks.
 */
export const VERDICT_MARK: Record<
  ClaimVerdict,
  { degree: "full" | "partly" | "none" | "unsettled"; icon: IconName }
> = {
  plausible: { degree: "full", icon: appIcons.verdictPlausible },
  doubtful: { degree: "partly", icon: appIcons.verdictDoubtful },
  implausible: { degree: "none", icon: appIcons.verdictImplausible },
  inconclusive: { degree: "unsettled", icon: appIcons.verdictUnsettled },
};

/**
 * Whether "can't tell" is worth one line about Wikipedia: only when
 * connecting a wider engine is a real next step. So only on an inconclusive
 * verdict whose searches all came back from Wikipedia, which covers
 * encyclopaedic topics only, and whose check holds no record of a provider
 * at all, searched, failed or declined: a provider record exists only for a
 * writer with a usable connection. The clause holds on every record, not
 * only on searched ones, or it would fire on a failed provider search
 * re-asked on Wikipedia, where the trace already says the provider failed.
 */
export function wikipediaLimited(
  verified: VerifyOutcome,
  records: readonly WebSearchRecord[],
): boolean {
  if (!judged(verified) || verified.verdict !== "inconclusive") return false;
  return (
    records.some((record) => record.status === "searched") &&
    records.every((record) => record.engine.kind === "wikipedia")
  );
}

/**
 * The Wikipedia editions whose language a quote is marked with, by host.
 * Closed, and only the app's own languages: the edition says what language
 * the page is written in, and nothing else does. An OpenRouter result's
 * language is unknowable, so it gets none rather than a guess a screen
 * reader would pronounce wrongly.
 */
const WIKIPEDIA_EDITIONS: ReadonlyMap<string, string> = new Map([
  ["en.wikipedia.org", "en"],
  ["it.wikipedia.org", "it"],
]);

/** A quote under a source row: the stored words, and their language. */
export interface SourceQuote {
  text: string;
  lang?: string;
}

/**
 * The quotes a verdict's rows carry, keyed by the row's id. A quote is drawn
 * only under a row that resolved to one of this turn's searched results: the
 * walk's `cited` also holds an earlier answer's source when the reasoning
 * names it, and a verdict never rests on one, so a quote hung under it would
 * say it did (reachable only from an edited file). The language is read off
 * the row's checked site, never stored. Only a judged verdict has sources to
 * quote, and its callers have already asked.
 */
export function quotesOf(
  verified: JudgedOutcome,
  records: readonly WebSearchRecord[],
  cited: readonly CitedSource[],
): ReadonlyMap<string, SourceQuote> {
  const quotes = new Map<string, SourceQuote>();
  const own = new Set(
    records.flatMap((record) =>
      record.status === "searched" ? record.results.map((one) => one.id) : [],
    ),
  );
  const rows = new Map(cited.map((source) => [source.id, source]));
  for (const source of verified.sources) {
    const row = rows.get(source.id);
    if (!source.quote || !row || !own.has(source.id)) continue;
    const lang = WIKIPEDIA_EDITIONS.get(row.site);
    quotes.set(source.id, { text: source.quote, ...(lang ? { lang } : {}) });
  }
  return quotes;
}

/**
 * A `/verify` answer as the screen reads it, in words: the verdict word and
 * its hint, the reasoning as the renderer parsed it (`body`), each row as
 * `[n] Title · url` with its quote indented in the locale's marks under it,
 * then the fix under its eyebrow. No claim: the writer's own words are the
 * question above it. An unjudged check is its one line.
 */
export function verifyAsText(
  verified: VerifyOutcome,
  records: readonly WebSearchRecord[],
  cited: readonly CitedSource[],
  body: string,
  sourceLine: (source: CitedSource) => string,
  t: TFunction,
): string {
  if (!judged(verified)) return t(`dock.verify.unjudged.${verified.unjudged}`);
  const quotes = quotesOf(verified, records, cited);
  const verdict = [
    t(`dock.verify.verdict.${verified.verdict}`),
    ...(wikipediaLimited(verified, records)
      ? [t("dock.verify.wikipediaLimit")]
      : []),
  ].join("\n");
  const rows = cited.map((source) => {
    const quote = quotes.get(source.id);
    return quote
      ? `${sourceLine(source)}\n    ${t("dock.verify.quoted", { text: quote.text })}`
      : sourceLine(source);
  });
  return [
    verdict,
    body,
    ...(rows.length ? [rows.join("\n")] : []),
    ...(verified.fix ? [`${t("dock.verify.fix")}\n${verified.fix}`] : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}
