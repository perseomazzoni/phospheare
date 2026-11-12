// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatTurn, Finding } from "./types";

// The writer's verdicts outlive a re-run. "Review again" replaces an
// answer in place, and the answer it replaces may carry the writer's triage:
// findings they resolved or dismissed. That work is the writer's, not the
// model's, and a re-run must not quietly reopen it. So a new finding standing
// on the same evidence as an old one takes its verdict.
//
// The same evidence means the same set of anchors, each the same source and
// the same quote. Two findings on the same quotes are one claim whatever the
// model titled them, and the anchors are verified text, so wording cannot
// steer the match. A finding with no evidence (an observation) keeps no
// verdict: a title is the model's word, and two observations titled alike
// need not be the same one. Only a writer's verdict travels; `stale` is the
// app's.

const KEPT: ReadonlySet<Finding["status"]> = new Set(["resolved", "dismissed"]);

/**
 * A finding's evidence, as one comparable value; empty when it has none.
 * It is a set: a model that repeats an anchor, or pads a quote with
 * whitespace, has not made a different claim, and either difference could
 * only wrongly drop a verdict, never wrongly carry one. Nothing looser
 * matches: a superset is the new cross-Section claim the re-run exists to
 * surface, a subset is a split claim cut to one side, and quote containment
 * is the plausible-but-wrong match `validateEvidence` refuses everywhere
 * else. A wrong carry hides a claim behind a collapsed "Dismissed"; a wrong
 * drop costs one click.
 */
function evidenceKey(finding: Finding): string {
  const parts = finding.evidence.map(
    (anchor) => `${anchor.sourceId}\u0000${anchor.quote.trim()}`,
  );
  return [...new Set(parts)].sort().join("\u0001");
}

/**
 * `findings`, each carrying the verdict the writer gave the finding on the
 * same evidence in `replaced` — resolved or dismissed only.
 */
export function keptVerdicts(
  replaced: ChatTurn | undefined,
  findings: readonly Finding[],
): Finding[] {
  const verdicts = new Map<string, Finding["status"]>();
  for (const old of replaced?.findings ?? []) {
    const key = evidenceKey(old);
    if (key && KEPT.has(old.status)) verdicts.set(key, old.status);
  }
  return findings.map((finding) => {
    const kept = verdicts.get(evidenceKey(finding));
    return kept ? { ...finding, status: kept } : finding;
  });
}
