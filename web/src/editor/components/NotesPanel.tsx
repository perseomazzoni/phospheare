// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ListAddButton, ListRow, RowVerb } from "../../ui";
import { REFERENCE_DIR, referenceFileName } from "../../project/naming";
import { deleteReference } from "../reference/referenceDelete";
import { renameReference } from "../reference/referenceRename";
import AiBarToggle from "../assistant/AiBarToggle";
import { notesOf, referencePrefixOf } from "../../project/reference";
import type { ProjectRef, StorageProvider } from "../../storage";
import { useReferenceFiles } from "../reference/referenceShared";
import { writeReference } from "../reference/referenceWrite";
import ReferenceReader, {
  type ReferenceEditSession,
} from "../reference/ReferenceReader";
import ReferenceNameInput from "../reference/ReferenceNameInput";
import ConfirmDialog from "./ConfirmDialog";
import { splitHeight, useSplitDrag, FACE_SPLIT_OPTIONS } from "./useSplitDrag";
import { formatWhen } from "./datetime";
import { appLog, describeError } from "../../log";

let metaFailureLogged = false;

// The Dock's `notes` face, split as the Reference and Snapshot faces are: the
// notes table on top (an add button, then rows of date, title and actions),
// and the selected note below in the shared `ReferenceReader` and edit
// session. A row's date is `updatedAt`, else `created`, from
// `provider.statFile` where the provider has it; without it a row has no
// date, because the file system has no cheap timestamp.

export interface NotesPanelProps {
  provider: StorageProvider;
  projectRef: ProjectRef | null;
  reference: string | null;
  editing: ReferenceEditSession | null;
  onStartEdit: (fileName: string, text: string) => void;
  onDraft: (draft: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<boolean>;
  onOpen: (fileName: string) => void;
  /**
   * Fired after a note is deleted. The shell owns `reference` (the open note)
   * and the edit session, and clears them when they name the deleted file,
   * so the reader never shows "unreadable" over a note that is gone.
   */
  onDeleted?: (fileName: string) => void;
  /**
   * The project's barred-from-the-assistant list, and the way to change it.
   * Absent, the row carries no toggle.
   */
  barredSourceIds?: readonly string[];
  onBarSource?: (sourceId: string, barred: boolean) => void;
}

interface NoteWithMeta {
  fileName: string;
  title: string;
  created?: string;
  updatedAt?: string;
  /** The row's date: `updatedAt`, else `created`. */
  when?: string;
}

export default function NotesPanel({
  provider,
  projectRef,
  reference,
  editing,
  onStartEdit,
  onDraft,
  onCancelEdit,
  onSaveEdit,
  onOpen,
  onDeleted,
  barredSourceIds,
  onBarSource,
}: NotesPanelProps) {
  const { t, i18n } = useTranslation();
  const { files, reload } = useReferenceFiles(provider, projectRef);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // A note creation that did not land: the field stays open and the failure
  // is said, rather than the row closing on nothing.
  const [writeFailed, setWriteFailed] = useState(false);
  /** A delete the port refused, said where the create failure is said. */
  const [deleteFailed, setDeleteFailed] = useState(false);
  /** The note whose name the writer is editing in place, if any. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameFailed, setRenameFailed] = useState(false);

  const notesDocs = useMemo(() => notesOf(files), [files]);

  const taken = useMemo(
    () => new Set(files.map((f) => f.toLowerCase())),
    [files],
  );

  const label = t("reference.group.notes");

  const [metaMap, setMetaMap] = useState<
    Map<string, { created?: string; updatedAt?: string }>
  >(new Map());
  const statFile = provider.statFile;
  // Saving an edit rewrites the file (`updatedAt` moves) while the list stays
  // unchanged, so the stat fetch would not re-run; the tick after a
  // successful save refetches the row's date.
  const [saveTick, setSaveTick] = useState(0);

  const handleSaveEdit = useCallback(async () => {
    const ok = await onSaveEdit();
    if (ok) setSaveTick((v) => v + 1);
    return ok;
  }, [onSaveEdit]);

  useEffect(() => {
    if (!projectRef || !statFile) {
      setMetaMap(new Map());
      return;
    }
    let live = true;
    void (async () => {
      let unread = 0;
      let lastError: unknown;
      const entries = await Promise.all(
        notesDocs.map(async (doc) => {
          try {
            const meta = await statFile(
              projectRef,
              `${REFERENCE_DIR}/${doc.fileName}`,
            );
            return [doc.fileName, meta] as const;
          } catch (err) {
            unread += 1;
            lastError = err;
            return [doc.fileName, null] as const;
          }
        }),
      );
      // The read reruns with every change to the notes: one line a session.
      if (unread > 0 && !metaFailureLogged) {
        metaFailureLogged = true;
        appLog.warn("editor", "The notes' dates could not be read.", {
          count: unread,
          ...describeError(lastError),
        });
      }
      if (!live) return;
      const map = new Map<string, { created?: string; updatedAt?: string }>();
      for (const [fileName, meta] of entries) {
        if (meta) map.set(fileName, meta);
      }
      setMetaMap(map);
    })();
    return () => {
      live = false;
    };
  }, [provider, projectRef, notesDocs, statFile, saveTick]);

  const notesWithMeta: NoteWithMeta[] = useMemo(
    () =>
      notesDocs.map((doc) => {
        const meta = metaMap.get(doc.fileName);
        return {
          fileName: doc.fileName,
          title: doc.title,
          created: meta?.created,
          updatedAt: meta?.updatedAt,
          when: meta?.updatedAt ?? meta?.created,
        };
      }),
    [notesDocs, metaMap],
  );

  const commitAdd = useCallback(
    async (title: string): Promise<boolean> => {
      if (!projectRef) return false;
      const fileName = referenceFileName(referencePrefixOf("notes"), title);
      // The one reference-write seam; a note is a reference file with an
      // empty template, opened straight into its editor. The field closes on
      // success only: a failure keeps it open for the retry and says so. The
      // listing is re-read either way, so a write that landed but answered
      // with an error still shows up.
      const ok = await writeReference(provider, projectRef, fileName, "");
      if (!ok) {
        reload();
        setWriteFailed(true);
        return false;
      }
      setWriteFailed(false);
      setAdding(false);
      reload();
      onOpen(fileName);
      onStartEdit(fileName, "");
      return true;
    },
    [provider, projectRef, reload, onOpen, onStartEdit],
  );

  /**
   * Commit a note's new name. A note's title is its file name, since the
   * folder is the record, so this renames the file and the open note
   * follows: left pointing at the old name, the reader would show a note
   * that vanished.
   */
  const commitRename = useCallback(
    async (fileName: string, title: string): Promise<boolean> => {
      setRenameFailed(false);
      const next = await renameReference(provider, projectRef, fileName, title);
      if (next === null) {
        setRenameFailed(true);
        reload();
        return false;
      }
      setRenaming(null);
      reload();
      if (reference === fileName) onOpen(next);
      return true;
    },
    [provider, projectRef, reload, reference, onOpen],
  );

  const handleDelete = useCallback(
    async (fileName: string) => {
      if (!projectRef) return;
      setDeleteFailed(false);
      // A note is the writer's own, so it goes to the bin rather than being
      // removed; `referenceDelete` owns that rule for both panels.
      if (!(await deleteReference(provider, projectRef, fileName))) {
        // A refused delete is said: on a project whose bytes commit over the
        // network, a silent failure leaves the note in the list with no word
        // of why.
        setDeleteFailed(true);
        return;
      }
      reload();
      onDeleted?.(fileName);
    },
    [provider, projectRef, reload, onDeleted],
  );

  const { split, panelRef, beginSplitDrag, onSplitKeyDown } =
    useSplitDrag(FACE_SPLIT_OPTIONS);

  const barred = new Set(barredSourceIds ?? []);

  const topHeight = splitHeight(split);

  return (
    <div
      className="dock-face ref-face notes-face snap-face"
      // Whether the rows carry the AI toggle, set once for the whole face so
      // every row, the add row included, takes the same actions track
      // (`.notes-face[data-ai-toggle]` in `editor.css`).
      data-ai-toggle={onBarSource ? "1" : undefined}
      ref={panelRef}
    >
      <div className="snap-table" style={{ height: topHeight }}>
        <ListAddButton
          className="notes-head"
          label={t("reference.addNewNote")}
          onClick={() => {
            setWriteFailed(false);
            setAdding(true);
          }}
        />
        <div className="snap-scroll" role="list" aria-label={label}>
          {adding && (
            <ListRow
              title={
                <ReferenceNameInput
                  prefix={referencePrefixOf("notes")}
                  group={label}
                  taken={taken}
                  rowClassName="ref-name-row"
                  onCommit={commitAdd}
                  onCancel={() => {
                    // Dismissing the field dismisses its failure with it.
                    setWriteFailed(false);
                    setAdding(false);
                  }}
                />
              }
            />
          )}
          {writeFailed && (
            <p className="ref-write-error" role="alert">
              {t("reference.createFailed")}
            </p>
          )}
          {deleteFailed && (
            <p className="ref-write-error" role="alert">
              {t("reference.deleteFailed")}
            </p>
          )}
          {/* A rename the port refused: a name already taken, or a write that
              did not land. The field stays open above it for the retry. */}
          {renameFailed && (
            <p className="ref-write-error" role="alert">
              {t("reference.renameFailed")}
            </p>
          )}
          {notesWithMeta.map((note) => {
            const isSelected = reference === note.fileName;
            const when = note.when;
            return (
              <ListRow
                key={note.fileName}
                className={isSelected ? "selected" : undefined}
                meta={
                  when ? (
                    <button
                      type="button"
                      className="snap-when"
                      aria-pressed={isSelected}
                      onClick={() => onOpen(note.fileName)}
                    >
                      {formatWhen(when, i18n.language)}
                    </button>
                  ) : null
                }
                title={
                  renaming === note.fileName &&
                  editing?.fileName !== note.fileName ? (
                    <ReferenceNameInput
                      prefix={referencePrefixOf("notes")}
                      group={label}
                      // The note's own name is not a duplicate of itself: a
                      // rename that only changes case must not be refused.
                      taken={
                        new Set(
                          [...taken].filter(
                            (name) => name !== note.fileName.toLowerCase(),
                          ),
                        )
                      }
                      initial={note.title}
                      rowClassName="ref-name-row"
                      onCommit={(title) => commitRename(note.fileName, title)}
                      onCancel={() => {
                        setRenameFailed(false);
                        setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="snap-title"
                      aria-pressed={isSelected}
                      onClick={() => onOpen(note.fileName)}
                    >
                      {note.title}
                    </button>
                  )
                }
                verbs={
                  <>
                    {onBarSource && (
                      <AiBarToggle
                        sourceId={`reference:${note.fileName}`}
                        barred={barred.has(`reference:${note.fileName}`)}
                        onToggle={onBarSource}
                      />
                    )}
                    {/* The note being edited is neither renamed nor binned:
                        the session holds its draft under this name, and its
                        save would write the old name back beside the moved
                        file. Ending the edit brings both controls back; a
                        rename field or a confirm already open waits with them. */}
                    {editing?.fileName !== note.fileName && (
                      <>
                        <RowVerb
                          icon="rename"
                          label={t("reference.rename")}
                          onClick={() => {
                            setRenameFailed(false);
                            setRenaming(note.fileName);
                          }}
                        />
                        <RowVerb
                          icon="delete"
                          label={t("reference.delete")}
                          onClick={() => setConfirmDelete(note.fileName)}
                        />
                      </>
                    )}
                  </>
                }
              />
            );
          })}
          {notesWithMeta.length === 0 && !adding && (
            <ListRow
              title={
                <span className="ref-card-empty">
                  {t("reference.emptyNotes")}
                </span>
              }
            />
          )}
        </div>
      </div>

      <div
        className="snap-divider ref-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("dock.resize")}
        tabIndex={0}
        onPointerDown={beginSplitDrag}
        onKeyDown={onSplitKeyDown}
      />

      <div className="ref-bottom">
        <ReferenceReader
          provider={provider}
          projectRef={projectRef}
          fileName={reference}
          emptyLabel={t("dock.pickNote")}
          editing={editing}
          onStartEdit={onStartEdit}
          onDraft={onDraft}
          onCancelEdit={onCancelEdit}
          onSaveEdit={handleSaveEdit}
        />
      </div>

      {confirmDelete && editing?.fileName !== confirmDelete && (
        <ConfirmDialog
          title={t("reference.deleteTitle", {
            name:
              notesWithMeta.find((n) => n.fileName === confirmDelete)?.title ??
              confirmDelete,
          })}
          body={t("reference.deleteBody")}
          confirmLabel={t("bin.moveTo")}
          danger
          onConfirm={() => {
            const file = confirmDelete;
            setConfirmDelete(null);
            void handleDelete(file);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
