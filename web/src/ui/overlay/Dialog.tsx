// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId } from "react";
import { useTranslation } from "react-i18next";
import Dots from "../Dots";
import Scrim from "./Scrim";

// The dialog, for the rung of the ladder that needs it: input is required
// before anything can proceed, as when starting a project needs a name, a
// place and a shape, none of which can be guessed.
//
// A modal is the most expensive control in an interface: it stops everything,
// holds the keyboard and demands a decision before other work continues. So
// the rule is the lowest rung that works, and this is nearly the top.
// Everything reversible goes to a toast; everything that belongs to one object
// goes to a menu.

export interface DialogProps {
  open: boolean;
  /**
   * The heading. Optional: a dialog that opens straight into a form with a
   * self-evident first field (the creation dialog) gains vertical space by
   * dropping it, and `label` names the dialog instead.
   */
  title?: string;
  /**
   * The dialog's accessible name when there is no heading. With a heading,
   * the heading names it and this is ignored, so the two never both reach the
   * reader.
   */
  label?: string;
  /** One optional line under the title saying what will happen. */
  lede?: string;
  /** False while a job is in flight, or when there is input worth losing. */
  dismissible?: boolean;
  confirmLabel: string;
  /**
   * `danger` when the answer chosen deletes something, so the button warns
   * only while it would; `quiet` when the button only leaves a job running
   * behind the dialog; `primary` otherwise.
   */
  confirmTone?: "primary" | "danger" | "quiet";
  cancelLabel?: string;
  /**
   * Why the last attempt did not happen, as in `AlertDialog`: the dialog
   * stays on the same question and its buttons are the retry.
   */
  problem?: string;
  /** Off until the form is answerable. */
  confirmDisabled?: boolean;
  /**
   * A job in flight. The confirm becomes the dots and stops reading as
   * pressable, but a busy button is not a disabled one: `:disabled`'s 40%
   * opacity says "this is off", and the control is working.
   */
  confirmBusy?: boolean;
  /**
   * The way out is shut: a job that cannot be called back is running (an
   * export already writing into the book's homes). Escape and the
   * backdrop follow `dismissible`; this covers the footer's button, which
   * otherwise always calls `onCancel`, so a dialog that ignored the press
   * would still look as if it could be left.
   */
  cancelDisabled?: boolean;
  /**
   * There is nothing to cancel: the dialog can only be left (a window that
   * could not read what it was opened on). The foot draws the confirm
   * alone, which the caller names Close and points at `onCancel`, because a
   * Cancel beside a primary that can never be pressed is two buttons that
   * both mean "go back", one of them greyed out.
   */
  cancelHidden?: boolean;
  /** Where focus lands on open: the first field, not the confirm button. */
  initialFocus?: () => HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
  /** An extra class for the dialog element, such as a wide variant. */
  className?: string;
}

export default function Dialog({
  open,
  title,
  label,
  lede,
  dismissible = true,
  confirmLabel,
  confirmTone = "primary",
  cancelLabel,
  problem,
  confirmDisabled = false,
  confirmBusy = false,
  cancelDisabled = false,
  cancelHidden = false,
  initialFocus,
  onConfirm,
  onCancel,
  children,
  className,
}: DialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const ledeId = useId();

  return (
    <Scrim
      open={open}
      dismissible={dismissible}
      onClose={onCancel}
      initialFocus={initialFocus}
      labelledBy={title ? titleId : undefined}
      describedBy={lede ? ledeId : undefined}
      label={label}
      className={["ui-dialog", className].filter(Boolean).join(" ")}
    >
      {(title || lede) && (
        <header className="ui-dialog-head">
          {title && (
            <h2 id={titleId} className="ui-dialog-title">
              {title}
            </h2>
          )}
          {lede && (
            <p id={ledeId} className="ui-dialog-lede">
              {lede}
            </p>
          )}
        </header>
      )}

      <div className="ui-dialog-body">
        {children}
        {problem && (
          <p className="ui-alert-problem" role="alert">
            {problem}
          </p>
        )}
      </div>

      <footer className="ui-dialog-foot">
        {!cancelHidden && (
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            disabled={cancelDisabled}
            onClick={onCancel}
          >
            {cancelLabel ?? t("confirm.cancel")}
          </button>
        )}
        <button
          type="button"
          className={`ui-btn ui-btn-${confirmTone}`}
          disabled={confirmDisabled}
          aria-busy={confirmBusy || undefined}
          data-loading={confirmBusy ? "1" : undefined}
          onClick={onConfirm}
        >
          {confirmBusy ? (
            <span className="ui-btn-load">
              <span className="ui-btn-load-label">{confirmLabel}</span>
              <span className="ui-btn-load-dots" aria-hidden>
                <Dots />
              </span>
            </span>
          ) : (
            confirmLabel
          )}
        </button>
      </footer>
    </Scrim>
  );
}
