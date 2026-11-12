// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { UndoableAction } from "../ProjectContext";

// The undo toast. Structural changes write themselves to disk the moment
// they happen, which is what makes "unsaved changes" mean only the editor
// buffer. This is the other half of that bargain: nothing is done that
// cannot be taken back for the next few seconds.

const LIFETIME_MS = 8000;

interface Props {
  action: UndoableAction;
  onUndo: () => void;
  onDismiss: () => void;
}

export default function Toast({ action, onUndo, onDismiss }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, LIFETIME_MS);
    return () => window.clearTimeout(timer);
    // Re-armed per action, so a second change restarts the countdown rather
    // than inheriting what was left of the first.
  }, [action, onDismiss]);

  return (
    <div className="dt-toast" role="status">
      <span className="dt-toast-text">
        {t(`toast.${action.code}`, {
          title: action.title,
          newTitle: action.newTitle,
          count: action.count,
        })}
      </span>
      {action.undo && (
        <button type="button" className="dt-toast-undo" onClick={onUndo}>
          {t("toast.undo")}
        </button>
      )}
    </div>
  );
}
