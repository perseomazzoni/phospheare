// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a room keeps on its chat between turns, outside any run: the drafting
// room's need and where the writer stopped, and the editorial plan's ticks.

import { now } from "./runRecords";
import type { WorkflowHost } from "./workflowRun";
import { needFor, returningTo, stoppedAt } from "../domain/drafting";
import { markPlanItem } from "../domain/plan";
import type { DraftingNeed } from "../domain/types";
import { withHost } from "./features";

export type RoomHost = Pick<
  WorkflowHost,
  "dependencies" | "writes" | "activeChat"
>;

// ── The drafting room's memory ───────────────────────────────────────────────

/**
 * The writer's answer to the drafting room's question (what they need for
 * the Section open now), kept on the active drafting chat until they
 * move to another Section. `null` takes it back, so the question is asked
 * again. Anywhere but a drafting chat this does nothing.
 */
export async function setDraftingNeed(
  host: RoomHost,
  kind: DraftingNeed | null,
): Promise<void> {
  const chat = host.activeChat();
  if (!chat || chat.kind !== "drafting") return;
  const nodeId = host.dependencies.defaultNode()?.id;
  // The Sections visited are the chat's sense of a return, not part of
  // the answer, so a need given or taken back keeps them.
  const visited = chat.drafting?.visited;
  const kept = visited ? { visited } : {};
  await host.writes.persist({
    ...chat,
    updatedAt: now(),
    drafting: kind
      ? {
          ...kept,
          need: { kind, ...(nodeId ? { nodeId } : {}), at: now() },
        }
      : kept,
  });
}

/** The need the active drafting chat holds for the open Section, or null. */
export function draftingNeed(host: RoomHost): DraftingNeed | null {
  const chat = host.activeChat();
  if (!chat || chat.kind !== "drafting") return null;
  return needFor(chat.drafting, host.dependencies.defaultNode()?.id);
}

/**
 * Where the writer stopped in the open Section, when the active drafting
 * chat is coming back to it, or null. Read from the manuscript every time,
 * never stored: the chat keeps no prose.
 */
export async function draftingStoppedAt(
  host: RoomHost,
): Promise<string | null> {
  const chat = host.activeChat();
  const nodeId = host.dependencies.defaultNode()?.id;
  if (chat?.kind !== "drafting" || !returningTo(chat.drafting, nodeId))
    return null;
  return nodeId ? stoppedLine(host, nodeId) : null;
}

/** The Section's last line as it is now; null when it cannot be read. */
export async function stoppedLine(
  host: Pick<RoomHost, "dependencies">,
  nodeId: string,
): Promise<string | null> {
  try {
    const { text } = await host.dependencies.sources.read(`node:${nodeId}`);
    return stoppedAt(text);
  } catch {
    return null;
  }
}

// ── The editorial revision plan ──────────────────────────────────────────────

/** One of the active chat's plan items, ticked off or put back. */
export async function setPlanItem(
  host: RoomHost,
  itemId: string,
  state: "open" | "done",
): Promise<void> {
  const chat = host.activeChat();
  if (!chat?.plan) return;
  if (markPlanItem(chat.plan, itemId, state) === chat.plan) return;
  await host.writes.persistChange(chat, (latest) =>
    latest.plan
      ? {
          ...latest,
          updatedAt: now(),
          plan: markPlanItem(latest.plan, itemId, state),
        }
      : latest,
  );
}

/** What a room keeps on its chat, bound to the aggregate. */
export function bind(host: RoomHost) {
  return {
    setDraftingNeed: withHost(host, setDraftingNeed),
    draftingNeed: withHost(host, draftingNeed),
    draftingStoppedAt: withHost(host, draftingStoppedAt),
    setPlanItem: withHost(host, setPlanItem),
  };
}
