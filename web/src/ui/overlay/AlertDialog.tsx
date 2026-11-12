// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import DialogText from "./DialogText";
import Scrim from "./Scrim";

// The alert dialog, for what an undo toast cannot cover: an action that
// cannot be taken back, such as deleting a folder or an account. A
// confirmation on a reversible action is friction that teaches people to
// click through, and a control everyone clicks through protects nothing. So a
// reversible action acts at once and offers Undo, and only the irreversible
// gets this.
//
// Focus opens on the safe exit, never on the destructive button: a stray
// Enter must not delete a novel.
//
// Without `onDismiss`, Escape and the backdrop do nothing: the choice is made,
// not escaped. `dismissible: false` swallows the key, as `layerStack` says.
//
// The buttons carry the verb. "Delete the folder" beside "Keep it" cannot be
// misread under stress; Yes and No can.

export interface AlertDialogProps {
  open: boolean;
  title: string;
  /** The opening sentence; `items` and `after` complete it. */
  body: string;
  /** The things the destructive answer touches, one per list item. */
  items?: readonly string[];
  /** Sentences after the list, each its own paragraph. */
  after?: readonly string[];
  /** Path, counts, what is about to be lost; set in mono, so it can be read. */
  evidence?: string;
  /**
   * Why the last attempt did not happen, when it did not. The dialog reopens
   * on the same question rather than closing on a failure nobody sees, so the
   * buttons are the retry. Announced as an alert, because it
   * appears in a dialog the writer already read.
   */
  problem?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** An optional third button: a safe exit that carries out neither action. */
  dismissLabel?: string;
  onConfirm: () => void;
  /**
   * The middle, non-destructive act, and optional, because a question can
   * lose its middle answer. In the undrained sign-out, "just sign
   * out" keeps the device handles while dropping the only copy of the
   * writer's afternoon, which no one means, so it is withdrawn rather than
   * offered and refused.
   *
   * Without it there are two buttons, and `onDismiss` must be present:
   * `Scrim` needs a way out, and a modal alert with no exit is a trap. Two of
   * the three are always drawn.
   */
  onCancel?: () => void;
  onDismiss?: () => void;
}

export default function AlertDialog({
  open,
  title,
  body,
  items,
  after,
  evidence,
  problem,
  confirmLabel,
  cancelLabel,
  dismissLabel,
  onConfirm,
  onCancel,
  onDismiss,
}: AlertDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const dismissRef = useRef<HTMLButtonElement>(null);

  return (
    <Scrim
      open={open}
      role="alertdialog"
      dismissible={!!onDismiss}
      onClose={onDismiss ?? onCancel ?? (() => {})}
      initialFocus={() => dismissRef.current}
      labelledBy={titleId}
      describedBy={bodyId}
      className="ui-dialog ui-dialog-alert"
    >
      <header className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
      </header>

      <div className="ui-dialog-body">
        <DialogText id={bodyId} lead={body} items={items} after={after} />
        {evidence && <p className="ui-alert-evidence">{evidence}</p>}
        {problem && (
          <p className="ui-alert-problem" role="alert">
            {problem}
          </p>
        )}
      </div>

      <footer className="ui-dialog-foot">
        {dismissLabel && (
          <button
            ref={dismissRef}
            type="button"
            className="ui-btn ui-btn-quiet"
            onClick={onDismiss}
          >
            {dismissLabel}
          </button>
        )}
        {!dismissLabel && onCancel && (
          <button
            ref={dismissRef}
            type="button"
            className="ui-btn ui-btn-quiet"
            onClick={onCancel}
          >
            {cancelLabel ?? t("confirm.cancel")}
          </button>
        )}
        {dismissLabel && onCancel && (
          <button
            type="button"
            className="ui-btn ui-btn-quiet"
            onClick={onCancel}
          >
            {cancelLabel ?? t("confirm.cancel")}
          </button>
        )}
        <button
          type="button"
          className="ui-btn ui-btn-danger"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </footer>
    </Scrim>
  );
}
