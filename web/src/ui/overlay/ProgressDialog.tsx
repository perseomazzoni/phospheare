// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId } from "react";
import Scrim from "./Scrim";

// A long job, shown honestly: copying a project into Remote Storage is a
// multi-minute operation over dozens of files.
//
// Not dismissible: Escape and the backdrop do nothing, because a copy stopped
// by a stray keypress is a copy the writer must restart without knowing why.
// `dismissible: false` swallows Escape, as `layerStack` says. Cancel is a
// real button, so stopping is a decision rather than an accident.
//
// The file name is `aria-live="polite"` and the count is not. A screen reader
// reading forty file paths in a row is unusable, and one that says nothing
// leaves a blind writer with a dialog that might be finished or stuck. So the
// work announces itself and the arithmetic stays quiet.

export interface ProgressDialogProps {
  open: boolean;
  title: string;
  lede?: string;
  /** Files finished so far. */
  done: number;
  /** How many there are, or null while that is still being counted. */
  total: number | null;
  /** What is being written right now. */
  current: string | null;
  cancelLabel: string;
  onCancel: () => void;
}

export default function ProgressDialog({
  open,
  title,
  lede,
  done,
  total,
  current,
  cancelLabel,
  onCancel,
}: ProgressDialogProps) {
  const titleId = useId();
  const ledeId = useId();

  // A null total means the source folder is still being walked. An
  // indeterminate bar says "working" without claiming a fraction it cannot
  // know yet.
  const known = total !== null && total > 0;
  const pct = known ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <Scrim
      open={open}
      dismissible={false}
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={lede ? ledeId : undefined}
      className="ui-dialog"
    >
      <header className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
        {lede && (
          <p id={ledeId} className="ui-dialog-lede">
            {lede}
          </p>
        )}
      </header>

      <div className="ui-dialog-body">
        <div className="ui-prog">
          <div
            className={`ui-prog-bar${pct === null ? " ui-prog-bar-unknown" : ""}`}
            role="progressbar"
            aria-valuenow={pct ?? undefined}
            aria-valuemin={pct === null ? undefined : 0}
            aria-valuemax={pct === null ? undefined : 100}
          >
            <i style={pct === null ? undefined : { width: `${pct}%` }} />
          </div>
          <div className="ui-prog-meta">
            <span>{known ? `${done} / ${total}` : `${done}`}</span>
            {pct !== null && <span>{pct}%</span>}
          </div>
        </div>
        <p className="ui-prog-file" aria-live="polite">
          {current}
        </p>
      </div>

      <footer className="ui-dialog-foot">
        <button
          type="button"
          className="ui-btn ui-btn-ghost"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      </footer>
    </Scrim>
  );
}
