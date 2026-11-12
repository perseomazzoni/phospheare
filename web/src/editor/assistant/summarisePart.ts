// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatTurn, ReviewScope } from "../../ai/domain/types";
import { summariseSkill } from "../../ai/domain/skills";

// `/summarise part` in the dock. The two readings the panel makes of
// it that are not the run's: which scope a line typed with the open Section's
// own title stands for, and which title an answer names as the Part it came
// from. Pure, so both are pinned here rather than through the panel's
// translated text.

/** The node the editor has open, as the assistant reports it. */
export type OpenNode = { id: string; kind: "part" | "section" };

/**
 * `/summarise` typed with the open Section's own title is `section`: the
 * writer named where they are, so it is the current question, never the
 * refusal another Section's title gets. Read by the submit, the transit notice
 * and an edited question alike, so none of them can disagree.
 */
export function nearScope(
  scope: ReviewScope,
  open: OpenNode | null,
): ReviewScope {
  return scope.kind === "node" &&
    open?.kind === "section" &&
    scope.nodeId === open.id
    ? { kind: "section" }
    : scope;
}

/**
 * The Part a `/summarise part` answer was composed from, by its live title,
 * or, once the Part is gone, by the title its question was asked with, so the
 * line still says where the account came from. The Part's id is the one thing
 * the answer stores. Undefined on every other turn, and when neither is there
 * to say.
 */
export function partTitleOf(
  turn: ChatTurn,
  turns: readonly ChatTurn[],
  titles: ReadonlyMap<string, string>,
): string | undefined {
  const part = turn.summarisedPart;
  if (!part) return undefined;
  const live = titles.get(`node:${part.nodeId}`);
  if (live) return live;
  // Its own question only: a pair shares a run id, and a turn with none
  // pairs with nothing.
  const asked = turn.runId
    ? turns.find((one) => one.runId === turn.runId && one.role === "user")?.text
    : undefined;
  const command = `/${summariseSkill.command} `;
  return asked?.startsWith(command)
    ? asked.slice(command.length) || undefined
    : undefined;
}
