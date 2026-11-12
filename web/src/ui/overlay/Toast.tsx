// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// The toast: something already happened, and it may need taking back.
//
// Not a layer: it never traps focus, never dims anything, and stays clickable
// behind a sheet, which is why the toast host sits outside the background a
// modal makes inert.

export interface ToastMessage {
  id: number;
  text: string;
  /** Present when the thing can be taken back; absent for plain news. */
  undo?: () => void;
}

/**
 * Long enough to read the sentence and reach the button; short enough that the
 * shelf does not permanently carry a bar across its foot. An undoable toast
 * gets the longer life because it is asking for a decision, not just reporting.
 */
const WITH_UNDO_MS = 6000;
const PLAIN_MS = 3600;

export interface Toasts {
  toasts: ToastMessage[];
  /** Shows a toast and returns its id, which `dismiss` takes. */
  post: (text: string, undo?: () => void) => number;
  dismiss: (id: number) => void;
}

export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const post = useCallback((text: string, undo?: () => void) => {
    const id = (nextId.current += 1);
    setToasts((current) => [...current, { id, text, undo }]);
    return id;
  }, []);

  return { toasts, post, dismiss };
}

/**
 * Fixed to the foot of the window, outside the page's scroll, so a toast about
 * the card just removed is not somewhere else on the shelf.
 */
export function ToastHost({
  toasts,
  dismiss,
}: Pick<Toasts, "toasts" | "dismiss">) {
  if (toasts.length === 0) return null;
  return (
    <div className="ui-toasts">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} dismiss={dismiss} />
      ))}
    </div>
  );
}

function Toast({
  toast,
  dismiss,
}: {
  toast: ToastMessage;
  dismiss: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { id, text, undo } = toast;

  useEffect(() => {
    const timer = window.setTimeout(
      () => dismiss(id),
      undo ? WITH_UNDO_MS : PLAIN_MS,
    );
    return () => window.clearTimeout(timer);
  }, [id, undo, dismiss]);

  return (
    // `status` rather than `alert`: this reports what already happened, and
    // interrupting a screen reader mid-sentence to say so would be rude.
    <div className="ui-toast" role="status">
      <span className="ui-toast-text">{text}</span>
      {undo && (
        <button
          type="button"
          className="ui-toast-undo"
          onClick={() => {
            undo();
            dismiss(id);
          }}
        >
          {t("toast.undo")}
        </button>
      )}
    </div>
  );
}
