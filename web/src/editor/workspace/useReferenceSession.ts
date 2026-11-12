// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { MD_EXT, SUMMARY_PREFIX } from "../../project/naming";
import { sameReaderFace } from "../../project/reference";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { DockFace } from "../components/Dock";
import { referenceFolderChanged } from "../reference/referenceShared";
import type { EditorServices } from "../services/port";
import {
  createDraftKeeper,
  type DraftTarget,
  type KeptDraft,
} from "./draftKeeper";
import {
  editAsks,
  faceOf,
  isDirty,
  isReaderFace,
  openAsks,
  worthWriting,
  type EditSession,
  type ReaderFace,
} from "./domain/referenceGuard";

// The documents the dock's reader faces hold, and the reference edit
// session. The session lives in the shell, not the dock, because the shell
// owns every exit that could destroy it: the dock renders the session, and
// this hook decides what happens to it.

/** An exit that waits for the writer to confirm dropping a dirty draft. */
export type RefLeave =
  | { kind: "open"; fileName: string }
  // `then` runs only once the face has switched: a caller that must act
  // after the switch (the waiting ask's reveal) never acts on a cancel.
  | { kind: "face"; face: DockFace; then?: () => void }
  | { kind: "edit"; fileName: string; text: string; unborn?: boolean };

export interface ReferenceSessionOptions {
  provider: StorageProvider | undefined;
  projectRef: ProjectRef | null;
  /** A summary file deleted from the shelf, by the node id it summarises. */
  onSummaryDeleted?: (nodeId: string) => void;
  setDockFace: (face: DockFace) => void;
  setDockOpen: (open: boolean) => void;
  holdOpenWork: EditorServices["holdOpenWork"];
}

export function useReferenceSession({
  provider,
  projectRef,
  onSummaryDeleted,
  setDockFace,
  setDockOpen,
  holdOpenWork,
}: ReferenceSessionOptions) {
  // One open document per face: Reference and Notes share the dock but not
  // their reading position. A document open on one face never appears under
  // the other; a face with nothing chosen shows its own empty reader. Each
  // face remembers what it had, so coming back restores it.
  const [referenceFile, setReferenceFile] = useState<string | null>(null);
  const [noteFile, setNoteFile] = useState<string | null>(null);

  const [refEdit, setRefEdit] = useState<EditSession | null>(null);
  const [keeper] = useState(() => createDraftKeeper(referenceFolderChanged));
  // A document not yet on disk is at stake only once it holds something the
  // writer wrote: until then no exit asks about it and none writes it, so an
  // abandoned "Write X" leaves no empty file behind.
  const refDirty = isDirty(refEdit);

  const target = useCallback(
    (): DraftTarget | null =>
      provider && projectRef ? { provider, projectRef } : null,
    [provider, projectRef],
  );

  // Opening a document lands it on its own face and ends only a session of
  // that same face, so reading Reference never disturbs a note draft, and the
  // reverse. A clean same-face session ends silently; a dirty one
  // never reaches here, because the guard asks first.
  const openInFace = useCallback(
    (fileName: string, face: ReaderFace) => {
      if (face === "notes") setNoteFile(fileName);
      else setReferenceFile(fileName);
      setDockFace(face);
      setDockOpen(true);
      setRefEdit((now) =>
        now &&
        now.fileName !== fileName &&
        sameReaderFace(now.fileName, fileName)
          ? null
          : now,
      );
    },
    [setDockFace, setDockOpen],
  );

  const openNotesTab = useCallback(() => {
    setDockFace("notes");
    setDockOpen(true);
  }, [setDockFace, setDockOpen]);

  // A deleted note or reference document ends whatever pointed at it: the
  // reader must not show a missing file as unreadable, and a dangling edit
  // session could never save. One callback clears the file from whichever
  // face holds it, and the session.
  const closeDeletedNote = useCallback(
    (fileName: string) => {
      // The file is gone: a kept draft has nothing to restore.
      keeper.forget(fileName);
      setReferenceFile((now) => (now === fileName ? null : now));
      setNoteFile((now) => (now === fileName ? null : now));
      setRefEdit((now) => (now && now.fileName === fileName ? null : now));
      // A summary deleted from the shelf would otherwise leave its binding,
      // and the properties would claim a summary exists. The file name
      // carries the node id the binding is keyed by, so no lookup is needed.
      // Optional, because the harnesses render the workspace bare.
      if (fileName.startsWith(SUMMARY_PREFIX) && fileName.endsWith(MD_EXT))
        onSummaryDeleted?.(
          fileName.slice(SUMMARY_PREFIX.length, -MD_EXT.length),
        );
    },
    [keeper, onSummaryDeleted],
  );

  const startRefEdit = useCallback(
    (fileName: string, text: string, unborn = false) => {
      setRefEdit(
        unborn
          ? { fileName, savedText: text, draft: text, unborn }
          : { fileName, savedText: text, draft: text },
      );
    },
    [],
  );

  const draftRefEdit = useCallback((draft: string) => {
    setRefEdit((now) => (now ? { ...now, draft } : now));
  }, []);

  // A document never on disk has nothing to fall back to: leaving its
  // session also closes it, so the reader never reads a missing file.
  const cancelRefEdit = useCallback(() => {
    if (refEdit?.unborn)
      setReferenceFile((now) => (now === refEdit.fileName ? null : now));
    setRefEdit(null);
  }, [refEdit]);

  const saveRefEdit = useCallback(async () => {
    if (!refEdit) return false;
    // A failed write keeps the session alive and the draft on screen.
    const place = target();
    if (!place) return false;
    // The reader refuses this save first and says why; this is the shell's
    // own guard, so no path creates an empty document.
    if (!worthWriting(refEdit)) {
      cancelRefEdit();
      return true;
    }
    const saved = await keeper.save(place, refEdit);
    if (saved) setRefEdit(null);
    return saved;
  }, [refEdit, target, keeper, cancelRefEdit]);

  /** Writes a dirty draft for an exit; resolves to whether it landed. */
  const persistRefDraft = useCallback(
    (edit: EditSession): Promise<boolean> => {
      const place = target();
      return place ? keeper.persist(place, edit) : Promise.resolve(false);
    },
    [target, keeper],
  );

  /**
   * The page going away writes a dirty draft and keeps the session open.
   * Answers whether a draft was at stake.
   */
  const writeDraftForExit = useCallback((): boolean => {
    if (!refDirty || !refEdit) return false;
    void persistRefDraft(refEdit);
    return true;
  }, [refDirty, refEdit, persistRefDraft]);

  const restoreKept = useCallback(
    (kept: KeptDraft) => {
      const place = target();
      if (place) void keeper.restore(place, kept);
    },
    [target, keeper],
  );

  // A session that ends without a save, by Cancel, a confirmed discard or
  // another document opening, gives the file back its text. A save clears
  // the kept draft before it ends the session, and a deleted file clears it
  // too, so neither is restored.
  const sessionFile = refEdit?.fileName ?? null;
  useEffect(() => {
    const kept = keeper.takeUnless(sessionFile);
    if (kept) restoreKept(kept);
  }, [sessionFile, keeper, restoreKept]);

  /**
   * Leaving the editor route unmounts the session without ending it, so a
   * draft an exit kept is restored here.
   */
  const restoreOnLeave = useCallback(() => {
    const kept = keeper.takeUnless(null);
    if (kept) restoreKept(kept);
  }, [keeper, restoreKept]);

  // A sign-out, here or in another tab, unmounts the shell and the draft it
  // holds. The account layer writes a dirty draft first, as it does the open
  // Section's buffer through the project layer. Registered once and read
  // through a ref, so a keystroke in the draft does not re-register it. A
  // draft that did not land answers `false`, which stops the sign-out.
  const refDraftWriteRef = useRef<() => Promise<unknown>>(async () => {});
  refDraftWriteRef.current = async () =>
    refDirty && refEdit ? persistRefDraft(refEdit) : true;
  useEffect(
    () => holdOpenWork(() => refDraftWriteRef.current()),
    [holdOpenWork],
  );

  // The guard for exits that would destroy a dirty draft: picking another
  // document of the same face, and switching the face to Ask
  // (`referenceGuard`). The dialog remembers what the writer asked for and
  // does it only if they confirm the discard.
  const [refLeave, setRefLeave] = useState<RefLeave | null>(null);

  const requestOpen = useCallback(
    (fileName: string, face: ReaderFace) => {
      if (openAsks(refEdit, fileName)) {
        setRefLeave({ kind: "open", fileName });
        return;
      }
      openInFace(fileName, face);
    },
    [refEdit, openInFace],
  );

  const requestOpenReference = useCallback(
    (fileName: string) => requestOpen(fileName, "reference"),
    [requestOpen],
  );

  const requestOpenNote = useCallback(
    (fileName: string) => requestOpen(fileName, "notes"),
    [requestOpen],
  );

  // The guard around entering the editor (`referenceGuard`): switching faces
  // is safe, but pressing Edit on the other face destroys a dirty draft for
  // another file. The same file has nothing at stake.
  const requestStartRefEdit = useCallback(
    (fileName: string, text: string) => {
      if (editAsks(refEdit, fileName)) {
        setRefLeave({ kind: "edit", fileName, text });
        return;
      }
      startRefEdit(fileName, text);
    },
    [refEdit, startRefEdit],
  );

  // The chat's "Write X": opens the document on the Reference face straight
  // into its editor, under the same guard as pressing Edit, since it is the
  // same exit for a dirty draft of another file.
  const requestWriteSection = useCallback(
    (fileName: string, text: string, unborn: boolean) => {
      if (editAsks(refEdit, fileName)) {
        setRefLeave({ kind: "edit", fileName, text, unborn });
        return;
      }
      openInFace(fileName, "reference");
      if (refEdit?.fileName !== fileName) startRefEdit(fileName, text, unborn);
    },
    [refEdit, openInFace, startRefEdit],
  );

  // Any exit from the reference or notes editor with a dirty draft asks
  // first, including to the ask and snapshot faces. Keyed on `refDirty`,
  // not the session, so a keystroke in the draft does not re-identify every
  // handler built on it.
  const requestFace = useCallback(
    (face: DockFace, then?: () => void) => {
      if (refDirty && !isReaderFace(face)) {
        setRefLeave({ kind: "face", face, then });
        return;
      }
      setDockFace(face);
      then?.();
    },
    [refDirty, setDockFace],
  );

  /** The writer confirmed the discard: drop the draft and do what waited. */
  const confirmLeave = useCallback(() => {
    const leave = refLeave;
    if (!leave) return;
    setRefEdit(null);
    setRefLeave(null);
    if (leave.kind === "open") {
      openInFace(leave.fileName, faceOf(leave.fileName));
    } else if (leave.kind === "edit") {
      // Starting the session is not enough: the reader shows an editor only
      // for the file its face holds, so the confirm lands the writer on that
      // file too.
      openInFace(leave.fileName, faceOf(leave.fileName));
      startRefEdit(leave.fileName, leave.text, leave.unborn);
    } else {
      setDockFace(leave.face);
      leave.then?.();
    }
  }, [refLeave, openInFace, startRefEdit, setDockFace]);

  const cancelLeave = useCallback(() => setRefLeave(null), []);

  return {
    referenceFile,
    noteFile,
    refEdit,
    refDirty,
    refLeave,
    openNotesTab,
    closeDeletedNote,
    draftRefEdit,
    cancelRefEdit,
    saveRefEdit,
    writeDraftForExit,
    restoreOnLeave,
    requestOpenReference,
    requestOpenNote,
    requestStartRefEdit,
    requestWriteSection,
    requestFace,
    confirmLeave,
    cancelLeave,
  };
}
