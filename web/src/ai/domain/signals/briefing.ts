// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Obsession } from "../obsessions";
import { DETECTOR_IDS, detectSignals, type DetectorId } from "./detect";
import { lexiconFor } from "./lexicons";

// The pre-pass as the model reads it. `detectSignals` finds; this decides
// what a turn is handed, by three rules:
//
//   Only the persona's own detectors run. A candidate is a question an
//   obsession asks, so an editor whose preset does not care about hedges is
//   not handed hedges: it would report them, because a model handed a list
//   treats the list as the assignment.
//
//   Only the writer's prose runs. A reference sheet is full of "felt" and
//   "seemed" by design; scanning it would teach the model that the notes are
//   the problem.
//
//   Candidates are labelled as candidates. The block says, before the list,
//   that nothing in it is a finding: each is judged against the obsession's
//   exceptions and the writer's declared prose style, and only the faults
//   are reported. A candidate the model agrees with silently is the pre-pass
//   working; one it repeats unjudged is the failure this framing prevents.
//
// An unknown language runs nothing, since there is no lexicon to be wrong
// with, and a turn with no candidates adds nothing to the prompt.

/** One obsession's candidates: what it notices, and the passages found. */
export interface SignalGroup {
  readonly obsession: string;
  readonly notices: string;
  readonly exceptions?: string;
  /** How many the detector found before the cap. */
  readonly found: number;
  readonly quotes: readonly string[];
}

/**
 * The candidates in `prose`, grouped by the obsession whose detector found
 * them, most important obsession first; empty when there is nothing to judge.
 * `prose` is manuscript text in its order; `obsessions` the persona's active
 * ones, most important first.
 */
export function signalGroups(
  prose: readonly string[],
  languageCode: string | undefined,
  obsessions: readonly Obsession[],
): SignalGroup[] {
  const lexicon = lexiconFor(languageCode);
  if (!lexicon) return [];
  const owners = new Map<DetectorId, Obsession>();
  for (const one of obsessions)
    if (one.detector && DETECTOR_IDS.has(one.detector))
      if (!owners.has(one.detector as DetectorId))
        owners.set(one.detector as DetectorId, one);
  if (owners.size === 0) return [];
  const text = prose.filter((one) => one.trim()).join("\n\n");
  if (!text) return [];
  const report = detectSignals(text, lexicon, [...owners.keys()]);
  return [...owners].flatMap(([detector, obsession]) => {
    const quotes = report.candidates
      .filter((one) => one.detector === detector)
      .map((one) => one.quote.replace(/\s+/g, " "));
    if (quotes.length === 0) return [];
    return [
      {
        obsession: obsession.id,
        notices: obsession.notices,
        ...(obsession.exceptions ? { exceptions: obsession.exceptions } : {}),
        found: report.found.get(detector) ?? quotes.length,
        quotes,
      },
    ];
  });
}

/**
 * What a `read_source` result says above its candidates. On a remote model
 * every Section arrives through the tool, never attached, so a pre-pass over
 * attached prose alone would never run. The framing matches the briefing's,
 * since the same list is handed over.
 */
export const SIGNALS_NOTE =
  "Candidates from a mechanical pre-pass over this text, for your own obsessions. None is a finding: a word list found them and it cannot read. Judge each against its exceptions, the writer's declared prose style and the book's genre, mention only the ones you judge faults, quoting them as they appear, and never report the list itself.";

/** The candidates block for groups already found, or "" for none. */
export function briefingOf(found: readonly SignalGroup[]): string {
  if (found.length === 0) return "";
  const groups = found.map((group) => {
    const shown =
      group.found > group.quotes.length
        ? ` (found ${group.found} in all; the densest ${group.quotes.length} shown)`
        : "";
    return [
      `${group.obsession} — ${group.notices}${shown}`,
      group.exceptions
        ? `  A choice, not a fault, when: ${group.exceptions}`
        : "",
      ...group.quotes.map((quote) => `  - "${quote}"`),
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    `CANDIDATES FROM A MECHANICAL PRE-PASS over the attached prose. None of these is a finding. A word list found them; it cannot read. For each, decide whether it is a fault or a choice — against its exceptions, the writer's declared prose style when you have it, and the book's genre — and mention only the ones you judge faults, quoting them as they appear. Say nothing about the rest, and never report the list itself. Answer the writer's request first; these are for where it touches the prose.`,
    ...groups,
  ].join("\n\n");
}

/** How many candidates the groups hand over. */
export function candidateCount(groups: readonly SignalGroup[]): number {
  return groups.reduce((sum, group) => sum + group.quotes.length, 0);
}
