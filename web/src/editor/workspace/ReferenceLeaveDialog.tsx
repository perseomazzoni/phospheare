// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { referenceTitle } from "../../project/reference";
import ConfirmDialog from "../components/ConfirmDialog";
import type { RefLeave } from "./useReferenceSession";

export interface ReferenceLeaveDialogProps {
  /** The exit waiting on the writer, from `useReferenceSession`. */
  refLeave: RefLeave | null;
  /** The reference file in the editor, or null with none. */
  refEditFile: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The reference editor's leaving question: an exit that would drop the draft
 * (another reference file, or the Ask face) asks first. Closing the dock does
 * not: the dock stays mounted while shut, so the draft survives.
 */
export function ReferenceLeaveDialog({
  refLeave,
  refEditFile,
  onConfirm,
  onCancel,
}: ReferenceLeaveDialogProps) {
  const { t } = useTranslation();
  if (!refLeave) return null;
  return (
    <ConfirmDialog
      title={t("dock.discardEditTitle")}
      body={t("dock.discardEditBody", {
        title: referenceTitle(
          refLeave.kind === "open" ? refLeave.fileName : (refEditFile ?? ""),
        ),
      })}
      confirmLabel={t("dock.discardEditConfirm")}
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
