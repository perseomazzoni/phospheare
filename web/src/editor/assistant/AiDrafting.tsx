// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui";
import { DRAFTING_NEEDS, type DraftingNeed } from "../../ai/domain/types";

// The drafting room's opening question. Drafting asks the writer what they
// need before anything else, and the app asks it rather than a model turn: a
// question answered with one press costs nothing, where a model turn that
// asks costs a round trip. It shows while the open Section has no need on
// record and returns when the writer moves to another Section.
//
// What the persona keeps for later is drawn as ghost comments in the margin,
// beside the words they are about, not here.

export function AiNeedQuestion({
  onPick,
  stoppedAt,
}: {
  /** The writer's answer; the panel records it and fills the field. */
  onPick: (need: DraftingNeed) => void;
  /**
   * The last line of the open Section, when this chat is coming back to it,
   * said above the question so the writer picks up where they stopped. It is
   * the writer's own words, so it renders as a quoted text node.
   */
  stoppedAt?: string | null;
}) {
  const { t } = useTranslation();
  const questionId = useId();
  return (
    <div className="ai-need" role="group" aria-labelledby={questionId}>
      {stoppedAt ? (
        <p className="dock-hint ai-stopped">
          {t("dock.drafting.stoppedAt")} <q>{stoppedAt}</q>
        </p>
      ) : null}
      <p id={questionId} className="dock-hint">
        {t("dock.drafting.question")}
      </p>
      <div className="ai-need-options">
        {DRAFTING_NEEDS.map((need) => (
          <Button
            key={need}
            variant="soft"
            className="ui-btn-sm"
            onClick={() => onPick(need)}
          >
            {t(`dock.drafting.need.${need}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}
