// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ReactNode } from "react";
import { appIcons } from "./appIcons";
import { Icon } from "./icons";
import { Reason } from "./Bits";

// A list of things that tick themselves from what is true: the Library's
// storage setup. A step is never ticked by hand. Its action opens the place
// where the thing is done, and the tick follows from the state that place
// leaves behind.
//
// With `oneIsEnough`, the first tick completes the list: only the done steps
// stay drawn, and a step not done shrinks to its `later` way in below them.
//
// An `unavailable` step is a place that exists but cannot be used here. It
// stays drawn, dimmed, with its reason and no way in, so the writer learns it
// exists without being offered a control that can only fail. It never ticks;
// once the list is complete it shrinks to its name and reason below the rest.

export interface ChecklistStep {
  id: string;
  name: string;
  /** What the step is, while it is not done. */
  note: ReactNode;
  done: boolean;
  /** What was settled, in place of the note once the step is done. */
  doneNote?: ReactNode;
  /** The step's own buttons, drawn while it is not done. */
  actions?: ReactNode;
  /** The step's way in once the list is complete without it. */
  later?: ReactNode;
  /** Why the step cannot be taken here; set, it draws no actions or later. */
  unavailable?: ReactNode;
}

export interface ChecklistProps {
  title: string;
  steps: readonly ChecklistStep[];
  /** Read after a done step's name, since the tick is only drawn. */
  doneLabel: string;
  /** One done step completes the list. */
  oneIsEnough?: boolean;
  /**
   * Draws the eye to the steps not done. A new value replays it, so pressing
   * a locked control twice flashes twice; 0 draws nothing.
   */
  flash?: number;
  className?: string;
}

export default function Checklist({
  title,
  steps,
  doneLabel,
  oneIsEnough = false,
  flash = 0,
  className,
}: ChecklistProps) {
  const complete = oneIsEnough && steps.some((step) => step.done);
  const shown = complete ? steps.filter((step) => step.done) : steps;
  const later = complete
    ? steps.filter((step) => !step.done && (step.later || step.unavailable))
    : [];

  return (
    <section
      className={["ui-checklist", className ?? ""].filter(Boolean).join(" ")}
      aria-label={title}
    >
      <h2 className="ui-checklist-title">{title}</h2>
      <ul className="ui-checklist-steps">
        {shown.map((step) => (
          <li
            key={step.id}
            className="ui-checklist-step"
            data-done={step.done ? "1" : undefined}
            data-unavailable={step.unavailable ? "1" : undefined}
          >
            {flash > 0 && !step.done && !step.unavailable && (
              <span
                key={flash}
                className="ui-checklist-flash"
                aria-hidden="true"
              />
            )}
            <span className="ui-checklist-mark" aria-hidden="true">
              <Icon name={appIcons.confirm} size={12} />
            </span>
            <div className="ui-checklist-body">
              <span className="ui-checklist-name">
                {step.name}
                {step.done && (
                  <span className="ui-visually-hidden">, {doneLabel}</span>
                )}
              </span>
              <div className="ui-checklist-note">
                {step.done ? (step.doneNote ?? step.note) : step.note}
              </div>
              {step.unavailable && (
                <div className="ui-checklist-reason">
                  <Reason>{step.unavailable}</Reason>
                </div>
              )}
              {!step.done && !step.unavailable && step.actions && (
                <div className="ui-checklist-actions">{step.actions}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {later.length > 0 && (
        <div className="ui-checklist-later">
          {later.map((step) =>
            step.unavailable ? (
              <div
                key={step.id}
                className="ui-checklist-unavailable"
                data-unavailable="1"
              >
                <span className="ui-checklist-unavailable-name">
                  {step.name} ·
                </span>{" "}
                <Reason>{step.unavailable}</Reason>
              </div>
            ) : (
              <div key={step.id}>{step.later}</div>
            ),
          )}
        </div>
      )}
    </section>
  );
}
