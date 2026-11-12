// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Scrim } from "../../ui";

// The editor's confirmation, in place of `window.confirm`, for an action that
// costs something a writer cannot simply undo: reloading over unsaved prose,
// removing a Part that still has Sections.
//
// Built on the shared `Scrim`, so it follows the app's dialog rules,
// including the bottom sheet on a narrow screen. Do not give it a private
// overlay.
//
// Focus opens on Confirm. `AlertDialog` guards irreversible acts and rests on
// Cancel; this dialog stands in front of ordinary work, and the writer who
// opened it usually means to continue. Escape and the backdrop both cancel,
// because this choice can be escaped from.

interface Props {
  title: string;
  body?: string;
  /** Defaults to a plain "Continue". */
  confirmLabel?: string;
  /** Draws the confirm button as a warning rather than as the accent. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  return (
    <Scrim
      open
      role="alertdialog"
      dismissible
      onClose={onCancel}
      initialFocus={() => confirmRef.current}
      labelledBy={titleId}
      describedBy={body ? bodyId : undefined}
      className="ui-dialog ui-dialog-alert"
    >
      <header className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
      </header>

      {body && (
        <div className="ui-dialog-body">
          <p id={bodyId} className="ui-alert-body">
            {body}
          </p>
        </div>
      )}

      <footer className="ui-dialog-foot">
        <Button variant="quiet" onClick={onCancel}>
          {t("confirm.cancel")}
        </Button>
        <Button
          ref={confirmRef}
          variant={danger ? "danger" : "soft"}
          onClick={onConfirm}
        >
          {confirmLabel ?? t("confirm.continue")}
        </Button>
      </footer>
    </Scrim>
  );
}
