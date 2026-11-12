// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A job's own progress face: one segment per step of a job the writer is
// waiting on, the step's name in words under it, and a counter beside it when
// the step is a long one. The creation wizard and the import window share it,
// because two windows that draw the same work two ways are two products.
//
// The steps are whatever catalogue the caller holds (such as `CREATE_STEPS`),
// so a new step is one row there and nothing here changes. Labels arrive
// translated; the kit knows no keys.

export interface JobProgressProps {
  /** Each step's name, in words, already translated. */
  steps: readonly string[];
  /** The step running now, from 0. */
  current: number;
  /** A counter for the running step ("12 of 80"), already translated. */
  detail?: string;
}

export default function JobProgress({
  steps,
  current,
  detail,
}: JobProgressProps) {
  return (
    <div className="ui-job">
      <div
        className="ui-job-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={current + 1}
      >
        {steps.map((_, i) => (
          <span
            key={i}
            className="ui-job-seg"
            data-state={
              i < current ? "done" : i === current ? "current" : "upcoming"
            }
          />
        ))}
      </div>
      <div className="ui-job-meta">
        <span className="ui-prog-file" aria-live="polite">
          {steps[current]}
        </span>
        {/* Not live: a counter announced on every file would talk over the
            step's name, which is the news. */}
        {detail && <span className="ui-job-count">{detail}</span>}
      </div>
    </div>
  );
}
