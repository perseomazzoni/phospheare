// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { Button } from "../../ui";

// The widening block, shared by every answer that can widen. `/where` and
// the Part and Structure reviews can end with Sections their run could not
// route by, having no summary to read, and a button that summarises them and
// runs again in place. Both read the three states here, so no answer that
// widens states them another way.

/**
 * The Sections an answer skipped for want of a summary. The reason is
 * untrusted, since it came back from a chat file, so only a recognised
 * `unmapped` counts: a summary cannot fix `too-large` or `not-read`, and a
 * button that widens nothing would mislead.
 */
export function unmappedOf(
  skipped: readonly { sourceId: string; reason: unknown }[],
): string[] {
  return skipped
    .filter((row) => row.reason === "unmapped")
    .map((row) => row.sourceId);
}

/**
 * How many of an answer's Sections the chat's model could not summarise and
 * no click may offer yet: its `unsummarisable` rows, or none once
 * the chat asks another model (`lifted`) and they join the button's count
 * again.
 */
export function blockedOf(
  skipped: readonly { sourceId: string; reason: unknown }[],
  lifted: boolean,
): number {
  return lifted
    ? 0
    : skipped.filter((row) => row.reason === "unsummarisable").length;
}

/**
 * Which of the three states an answer is in, and the stored rows alone
 * cannot tell two of them apart. `unmapped` is the answer's own record;
 * `missing` is what a click would summarise now. After a Stop part-way those
 * differ, and the button must not offer six when three are left. Some still
 * missing: summarise them. None missing, yet the
 * answer skipped some: it predates their summaries, because the run after
 * them was stopped or failed, so the note would be false and it is out of
 * date. Nothing skipped: nothing to say.
 */
export function widenState(
  unmapped: readonly string[],
  missing: readonly string[],
): null | "summarise" | "outOfDate" {
  if (unmapped.length === 0) return null;
  return missing.length > 0 ? "summarise" : "outOfDate";
}

/**
 * The transit line of a button that summarises first: one lead sentence naming
 * what a summary request sends, then the line for what the run after it
 * sends. Every summarise button reads it here. The sentence must match
 * `generateNodeSummary` (`ai/application/summaries.ts`).
 */
export function summariseTransit(
  provider: string,
  then: string,
  t: TFunction,
): string {
  return `${t("dock.summariseTransit", { provider })} ${then}`;
}

/**
 * The one widening block: the note, then, on a remote model, where the click
 * sends the book, then the button. The disclosure comes before the control that
 * causes the transfer, as in the composer, and a screen reader reads it
 * first. The button is the kit's small soft button, so it reads as a control
 * and not as more of the note. No button, no transit line, since the line
 * describes the click. The note stays, because it is the answer's record.
 *
 * `blocked` says what no click can widen: Sections the chat's model could not
 * summarise. It comes first, its own paragraph with its own count, so the
 * button's note stays next to the button it counts for; with nothing a click
 * could do, it is the whole block, with no note, button or transit.
 */
export default function Widen({
  blocked,
  note,
  transit,
  action,
  onOpen,
}: {
  blocked?: ReactNode;
  /**
   * What the answer could not do, or, as a `/map` fit note, a line
   * with a model's name and words in it, which arrive as their own `<bdi>`
   * nodes rather than as a string.
   */
  note?: ReactNode;
  transit?: string;
  action?: string;
  onOpen?: () => void;
}) {
  const opens = onOpen && action !== undefined;
  return (
    <div className="ai-widen">
      {blocked ? <p className="dock-hint">{blocked}</p> : null}
      {note ? <p className="dock-hint">{note}</p> : null}
      {opens && transit ? <p className="dock-hint">{transit}</p> : null}
      {opens ? (
        <span className="ai-finding-actions">
          <Button variant="soft" className="ui-btn-sm" onClick={onOpen}>
            {action}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
