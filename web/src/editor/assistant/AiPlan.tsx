// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { Tick } from "../../ui";
import {
  PLAN_PRIORITIES,
  type PlanItem,
  type RevisionPlan,
} from "../../ai/domain/types";

// The editorial revision plan: the letter's Must / Should / Could list, taken
// out of its prose and folded over the transcript like the other rooms'
// records, to be consulted rather than read. Each item is a kit `Tick`,
// because the list is a checklist the writer works through, which is what
// `role="checkbox"` says. Each open item offers the one move the
// editor cannot make: taking it to a drafting chat.
//
// Under an item the next letter judged sits its verdict (resolved, still open
// or made worse) and the editor's one sentence on why. It follows the row in
// reading order, so a screen reader hears it after the item.
//
// The items and notes are the model's words, so they render as text nodes
// only.

export default function AiPlan({
  plan,
  onMark,
  onDraft,
}: {
  plan: RevisionPlan;
  onMark: (itemId: string, state: PlanItem["state"]) => void;
  /** Take an item to a new drafting chat; absent where none can be made. */
  onDraft?: (item: PlanItem) => void;
}) {
  const { t } = useTranslation();
  if (plan.items.length === 0) return null;
  const open = plan.items.filter((item) => item.state === "open").length;
  return (
    <details className="ai-reading ai-plan">
      <summary className="ai-reading-summary">
        {t("dock.plan.title", { count: open })}
      </summary>
      {PLAN_PRIORITIES.map((priority) => {
        const items = plan.items.filter((item) => item.priority === priority);
        if (items.length === 0) return null;
        return (
          <section key={priority} className="ai-plan-group">
            <h3 className="ai-finding-head">
              {t(`dock.plan.priority.${priority}`)}
            </h3>
            <ul className="ai-plan-list">
              {items.map((item) => (
                <li key={item.id}>
                  <Tick
                    className="ai-plan-item"
                    checked={item.state === "done"}
                    aria-label={t("dock.plan.done", { item: item.text })}
                    onToggle={() =>
                      onMark(item.id, item.state === "done" ? "open" : "done")
                    }
                  >
                    {item.text}
                  </Tick>
                  {onDraft && item.state === "open" ? (
                    <button
                      type="button"
                      className="ai-text-button"
                      onClick={() => onDraft(item)}
                    >
                      {t("dock.plan.draft")}
                    </button>
                  ) : null}
                  {item.check ? (
                    <p
                      className="ai-plan-verdict"
                      data-verdict={item.check.verdict}
                    >
                      <strong>
                        {t(`dock.plan.verdict.${item.check.verdict}`)}
                      </strong>
                      {item.check.note ? ` — ${item.check.note}` : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </details>
  );
}
