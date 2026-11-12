// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Scrim } from "../../ui";

// Leaving with unsaved changes: asked whenever the writer is about to leave
// the current Section with a dirty buffer, for another Section or for the
// Library. Three different answers:
//
//   Save     write first, then go. The only choice that loses nothing.
//   Stay     do nothing, and stay where the writer was.
//   Skip     go, and abandon the buffer.
//
// The same three choices on both paths, because the writer cannot tell from
// the wording which path they triggered. Autosave does not change this: a
// silent save here would misstate what the writer asked for.
//
// Built on the shared `Scrim`, as `ConfirmDialog` is. Focus opens on Save,
// the answer that loses nothing; Escape and the backdrop mean Stay, the
// answer that changes nothing.

interface Props {
  title: string;
  body: string;
  onSave: () => void;
  onStay: () => void;
  onSkip: () => void;
}

export default function LeaveDialog({
  title,
  body,
  onSave,
  onStay,
  onSkip,
}: Props) {
  const { t } = useTranslation();
  const saveRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  return (
    <Scrim
      open
      role="alertdialog"
      dismissible
      onClose={onStay}
      initialFocus={() => saveRef.current}
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
        <p id={bodyId} className="ui-alert-body">
          {body}
        </p>
      </div>

      <footer className="ui-dialog-foot">
        <Button variant="quiet" onClick={onStay}>
          {t("leave.stay")}
        </Button>
        <Button variant="danger" onClick={onSkip}>
          {t("leave.skip")}
        </Button>
        <Button ref={saveRef} variant="soft" onClick={onSave}>
          {t("leave.save")}
        </Button>
      </footer>
    </Scrim>
  );
}
