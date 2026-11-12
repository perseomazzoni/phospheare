// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";
import { referenceTitle } from "../../project/reference";
import LeaveDialog from "../components/LeaveDialog";
import type { EditorEngine } from "../views/engine";

export interface LeaveGuardProps {
  /** Read when the writer answers, so the guard sees the buffer as it is. */
  engine: EditorEngine;
  /** The open Section's name, for the question. */
  openTitle: string;
  saveSection: () => Promise<boolean>;
  refDirty: boolean;
  /** The reference file in the editor, or null with none. */
  refEditFile: string | null;
  saveRefEdit: () => Promise<boolean>;
  /** Puts the reference draft back as it was before this session's edits. */
  restoreOnLeave: () => void;
}

/**
 * Leaving the editor with unsaved work. Routing out with a dirty buffer is
 * blocked until the writer answers, in the same `LeaveDialog` that guards a
 * Section switch, so both boundaries use the same words, autosave on or off.
 * A dirty reference edit is the same boundary: its draft is not in the
 * engine, so it is asked about here or it would vanish silently. There is no
 * flush on unmount: a writer who chose "Don't save" means it.
 */
export function LeaveGuard({
  engine,
  openTitle,
  saveSection,
  refDirty,
  refEditFile,
  saveRefEdit,
  restoreOnLeave,
}: LeaveGuardProps) {
  const { t } = useTranslation();
  const blocker = useBlocker(() => engine.hasChanges || refDirty);
  if (blocker.state !== "blocked") return null;
  return (
    <LeaveDialog
      title={t("leave.title")}
      body={
        // The name with unsaved work: the open section, or the reference
        // file the writer is editing, whichever is at stake.
        refDirty && !engine.hasChanges
          ? t("leave.bodyReference", {
              title: refEditFile ? referenceTitle(refEditFile) : "",
            })
          : t("leave.body", { title: openTitle })
      }
      onSave={async () => {
        // A failed write keeps the writer here with the buffer intact: a save
        // that did not land must not look like one. The error is already on
        // screen from `saveActiveFile`.
        const sectionSaved = engine.hasChanges ? await saveSection() : true;
        // The reader's own Save, so a document not yet on disk is created
        // only where no file stands.
        const refSaved = refDirty ? await saveRefEdit() : true;
        if (sectionSaved && refSaved) blocker.proceed();
        else blocker.reset();
      }}
      onStay={() => blocker.reset()}
      onSkip={() => {
        restoreOnLeave();
        blocker.proceed();
      }}
    />
  );
}
