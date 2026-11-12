// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// An answer's parts: what the writer reads, and the blocks that leave it.
// A drafting answer's for-later notes go to the margin, an editor's plan and
// its verdicts go to the chat's list, and a pointer to another chat becomes
// a button. Each chat kind holds back only its own blocks.

import { takeBlocks } from "./blocks";
import { splitForLater } from "./drafting";
import { applyPlanCheck, foldPlan, splitPlan, splitPlanCheck } from "./plan";
import { splitRoute } from "./route";
import type { ChatKind, RevisionPlan } from "./types";

/**
 * What the writer sees of an answer as it streams: never a held block. A
 * drafting answer's for-later notes stay hidden, since the writer mid-scene
 * reads help, not the critique held back.
 */
export function shownOf(kind: ChatKind, partial: string): string {
  if (kind === "drafting")
    return takeBlocks(splitForLater(partial).answer, "room").answer;
  if (kind === "editorial")
    return splitPlanCheck(splitPlan(partial).answer).answer;
  if (kind === "general") return takeBlocks(partial, "room").answer;
  return partial;
}

/** An ended answer, split into its text and the blocks that leave it. */
export interface AnswerParts {
  /** A drafting answer's notes kept for later, with the answer without them. */
  held: ReturnType<typeof splitForLater> | null;
  /** An editor's revision plan, with the letter without it. */
  planned: ReturnType<typeof splitPlan> | null;
  /** The editor's verdicts on the earlier plan, with the letter without them. */
  checked: ReturnType<typeof splitPlanCheck> | null;
  /** A pointer to another chat, with the answer without it. */
  routed: ReturnType<typeof splitRoute> | null;
  /** What the turn stores and the writer reads. */
  answerText: string;
}

/**
 * An ended answer's parts, by its chat's kind. `sectionIds` are the Sections
 * the book holds: a pointer to a reader is only set to read through one of
 * them.
 */
export function partsOf(
  kind: ChatKind,
  text: string,
  sectionIds: ReadonlySet<string>,
): AnswerParts {
  // The notes a drafting answer kept for later leave the answer for good:
  // the stored text is what the writer read.
  const held = kind === "drafting" ? splitForLater(text) : null;
  const planned = kind === "editorial" ? splitPlan(text) : null;
  // A letter written over an earlier plan judges that plan first: resolved,
  // still open, made worse.
  const checked = planned ? splitPlanCheck(planned.answer) : null;
  const routed =
    kind === "general" || kind === "drafting"
      ? splitRoute(held?.answer ?? text, kind, sectionIds)
      : null;
  const answerText =
    checked?.answer ?? routed?.answer ?? held?.answer ?? text.trim();
  return { held, planned, checked, routed, answerText };
}

/**
 * The plan after an ended letter: the verdicts land on the old items before
 * the new plan is folded over them, so an item the new letter repeats keeps
 * its verdict, and one it resolved stays on the list, ticked (`foldPlan`).
 */
export function replanned(
  current: RevisionPlan | undefined,
  parts: Pick<AnswerParts, "planned" | "checked">,
  turnId: string,
  newId: () => string,
): RevisionPlan | undefined {
  let plan = current;
  if (parts.checked && parts.checked.checks.length > 0)
    plan = applyPlanCheck(plan, parts.checked.checks, turnId);
  if (parts.planned && parts.planned.items.length > 0)
    plan = foldPlan(plan, parts.planned.items, turnId, newId);
  return plan;
}
