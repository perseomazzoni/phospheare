// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trustedHtml } from "../../security/trustedHtml";
import { commonmarkCodec, htmlRenderer } from "../engine";
import { Icon, ListAddButton, ListRow, RowVerb } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import { useProjectActions, useProjectState } from "../ProjectContext";
import { nodeOfFile } from "../../project/structure";
import { filePath, parseSnapshotName } from "../../project/naming";
import { defaultSnapshotTitle } from "../../project/mutations";
import type { Snapshot } from "../../project/types";
import type { ProjectRef, StorageProvider } from "../../storage";
import ConfirmDialog from "./ConfirmDialog";
import LeaveDialog from "./LeaveDialog";
import { splitHeight, useSplitDrag } from "./useSplitDrag";
import { formatWhen } from "./datetime";

// The snapshot face: the project's saved moments, for the node that is open.
// A table on top, one row per snapshot, newest first, the adopted one ticked;
// below it the snapshot's full text, rendered by the engine's own codec and
// renderer, so the preview shows what the editor would show of that file. A
// draggable divider separates the halves.
//
// Nothing here mutates the manuscript: adding copies the adopted file (the
// save-first gate settles the buffer first), adopting swaps the yaml pointer
// and lands the editor in the newly adopted file, and deleting moves a
// snapshot to the recycle bin, which is refused while it is adopted.
//
// The shell owns the comparison, a selected snapshot shown as a read-only
// diff in the main editor; this panel owns the table, the preview and the
// verbs.

// The writer's own folder is not a trust boundary, so the preview's safety
// property is the renderer's contract:
// `escapeHtml`/`escapeAttr` escape every run and every emitted attribute, the
// dialect has no link or image syntax, and the only attribute the renderer
// emits is a parser-whitelisted `text-align`. A hostile file renders as inert
// text, never as live markup, which is stricter than markdown-it's
// `html: false`.

/** The resting split of the panel: the table takes the top third. */
const DEFAULT_SPLIT = 1 / 3;
const MIN_SPLIT = 0.2;
const MAX_SPLIT = 0.6;
/** How far one arrow key moves the divider. */
const SPLIT_KEY_STEP = 0.04;

interface Props {
  provider: StorageProvider;
  projectRef: ProjectRef | null;
  /** The open file; the panel's subject is its node's snapshots. */
  activeFile: string | null;
  /**
   * The comparison reported up to the shell: the two snapshot titles and
   * files the editor should show, or null when the writer is back in the
   * adopted text.
   */
  onCompare?: (info: CompareInfo | null) => void;
  /**
   * Bumped by the shell whenever a comparison exits from outside (Esc, the
   * face closing, the rail opening). The panel clears its selection, so a
   * row never stays highlighted over a closed diff.
   */
  compareExits?: number;
}

export interface CompareInfo {
  compared: string;
  adopted: string;
  comparedFile: string;
  adoptedFile: string;
}

export default function SnapshotPanel({
  provider,
  projectRef,
  activeFile,
  onCompare,
  compareExits = 0,
}: Props) {
  const { t, i18n } = useTranslation();
  const { structure, props } = useProjectState();
  const {
    saveActiveFile,
    hasUnsavedChanges,
    addSnapshot,
    adoptSnapshot,
    renameSnapshotTitle,
    deleteSnapshot,
    setSnapshotSplit,
  } = useProjectActions();

  // The open node, resolved from the file. The structure is read from the
  // context so a commit (adopt, add, delete) re-renders the table in place.
  const node = useMemo(() => {
    if (!structure || !activeFile) return null;
    return nodeOfFile(structure, activeFile);
  }, [structure, activeFile]);

  // ── The selection and the preview ──────────────────────────────────────────
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    file: string;
    text: string;
    failed: boolean;
  } | null>(null);

  // ── Adding: the ghost row's title field ────────────────────────────────────
  // The ghost row is the row for a snapshot that does not exist yet. Its
  // state is declared here, above the file-switch effect, because that effect
  // dismisses the ghost. The behaviour lives with the verbs below.
  const [adding, setAdding] = useState(false);
  const [addingPending, setAddingPending] = useState(false);
  const [addingValue, setAddingValue] = useState("");
  /**
   * The default title captured when [+] was pressed: what the placeholder
   * promises and an empty Enter delivers. Computing it after the add would
   * name the next default, since the structure has grown by one.
   */
  const [addingDefault, setAddingDefault] = useState("");

  // A file switch ends the comparison, as it closes the rail, and dismisses a
  // pending add's ghost row: blur usually comes first, but a switch that lands
  // elsewhere must not leave a ghost over a different node's table.
  useEffect(() => {
    setSelected(null);
    setAdding(false);
    setAddingValue("");
  }, [activeFile]);

  // The selection clears with the diff. The panel's own toggle-off bumps
  // `compareExits` too, but that path already cleared the selection.
  useEffect(() => {
    setSelected(null);
  }, [compareExits]);

  // The comparison reported to the shell: a non-adopted selection names the
  // two snapshots and their files; anything else means "back in the adopted
  // text". The adopted selection itself is a return, never a comparison of
  // a snapshot against itself.
  useEffect(() => {
    if (!node || !selected || selected === node.adopted) {
      onCompare?.(null);
      return;
    }
    const compared = node.snapshots.find((s) => s.file === selected);
    const adopted = node.snapshots.find((s) => s.file === node.adopted);
    if (!compared || !adopted) {
      onCompare?.(null);
      return;
    }
    onCompare?.({
      compared: compared.title,
      adopted: adopted.title,
      comparedFile: compared.file,
      adoptedFile: adopted.file,
    });
  }, [node, selected, onCompare]);

  // A row adopted while selected returns the panel to editing.
  useEffect(() => {
    if (node && selected && selected === node.adopted) setSelected(null);
  }, [node, selected]);

  // The preview follows the selection; at rest it shows the adopted
  // snapshot's text, so the tick and the preview always agree.
  useEffect(() => {
    if (!node || !projectRef) {
      setPreview(null);
      return;
    }
    const file = selected ?? node.adopted;
    if (!file) {
      setPreview(null);
      return;
    }
    let live = true;
    setPreview((now) => (now && now.file === file ? now : null));
    void (async () => {
      try {
        const text = await provider.readFile(projectRef, filePath(file));
        if (live) setPreview({ file, text, failed: false });
      } catch {
        if (live) setPreview({ file, text: "", failed: true });
      }
    })();
    return () => {
      live = false;
    };
  }, [node, selected, provider, projectRef]);

  // The engine's own parse→render, so `{align:…}` renders as its block too.
  const previewHtml = useMemo(
    () =>
      preview && !preview.failed
        ? htmlRenderer.render(commonmarkCodec.parse(preview.text))
        : "",
    [preview],
  );

  // ── The table's rows ───────────────────────────────────────────────────────
  // Newest first. The tick marks the adopted row; every other row reveals an
  // Adopt button on hover or keyboard focus. A click on the title or the date
  // selects the row for the preview and the diff.
  const rows = useMemo(() => {
    if (!node) return [] as Snapshot[];
    return [...node.snapshots].sort((a, b) =>
      b.created.localeCompare(a.created),
    );
  }, [node]);

  // The relative-position badge: each row's offset from the adopted one in
  // file order (the `xy` suffix, the naming module's own order), never the
  // `created` sort whose tie is stable. A snapshot taken in the
  // same millisecond as another still reports its true file position.
  const fileOrder = useMemo(() => {
    if (!node) return [] as Snapshot[];
    return [...node.snapshots].sort((a, b) => {
      const ax = parseSnapshotName(a.file)?.xy ?? 0;
      const bx = parseSnapshotName(b.file)?.xy ?? 0;
      return ax - bx;
    });
  }, [node]);
  const adoptedFileIndex = fileOrder.findIndex((s) => s.file === node?.adopted);
  const relativeOf = (file: string) => {
    const at = fileOrder.findIndex((s) => s.file === file);
    if (at === -1 || at === adoptedFileIndex) return null;
    return {
      dir: (at < adoptedFileIndex ? "back" : "ahead") as "back" | "ahead",
      count: Math.abs(at - adoptedFileIndex),
    };
  };

  // ── The gates and the verbs ────────────────────────────────────────────────
  //
  // The save-first gate guards every verb that reads or moves the disk state:
  // adding a snapshot copies the adopted file (the copy must happen after the
  // save resolves), adopting replaces the open buffer's file, and selecting a
  // snapshot for comparison reads two files the dirty buffer is not part of.
  // All three use the same modal, so the writer meets one question. Skip
  // proceeds anyway: the snapshot captures the saved text, and the dialog
  // says so.
  const [gate, setGate] = useState<
    | { kind: "add" }
    | { kind: "adopt"; file: string }
    | { kind: "select"; file: string }
    | null
  >(null);

  // ── Adding: the ghost row's title field ────────────────────────────────────
  // [+] mounts the ghost row (an empty lane, an empty date cell, the title
  // field in the title cell, no actions), and Enter creates the snapshot with
  // the typed title, or the default the placeholder promised when empty. Esc
  // and blur abort the creation: nothing is written and the ghost unmounts.
  // Unlike the rename field, which commits on blur, blur here means no,
  // because add creates and rename edits: an involuntary blur must not create
  // an unconfirmed file.

  // The rename field lives in the same title-cell slot as the add field, and
  // the two are mutually exclusive by construction (`requestAdd` dismisses a
  // rename, `beginRename` dismisses an add), so the cell never holds two live
  // inputs with two commit paths. Declared here, above `requestAdd`, because
  // the exclusivity cuts both ways.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

  /**
   * Mount the ghost row. Nothing has been written yet; the field's default is
   * captured now, before any creation, so the placeholder and an empty Enter
   * agree on the name.
   */
  const beginAdd = useCallback(() => {
    if (!node || addingPending || adding) return;
    setAddingValue("");
    setAddingDefault(defaultSnapshotTitle(node));
    setAdding(true);
  }, [node, addingPending, adding]);

  const requestAdd = useCallback(() => {
    if (!node || addingPending || adding) return;
    setRenaming(null);
    if (hasUnsavedChanges()) setGate({ kind: "add" });
    else beginAdd();
  }, [node, addingPending, adding, hasUnsavedChanges, beginAdd]);

  /** Abort the creation on Esc or blur; only the ghost row goes. */
  const abortAdding = useCallback(() => {
    setAdding(false);
    setAddingValue("");
  }, []);

  const requestAdopt = useCallback(
    (file: string) => {
      if (!node) return;
      if (hasUnsavedChanges()) setGate({ kind: "adopt", file });
      else void adoptSnapshot(node.id, file);
    },
    [hasUnsavedChanges, adoptSnapshot, node],
  );

  const requestSelect = useCallback(
    (file: string) => {
      if (!node) return;
      if (file === node.adopted) {
        // The adopted row is the return button: back to editing.
        setSelected(null);
        return;
      }
      if (selected === file) {
        // Re-clicking the selected row toggles the comparison off.
        setSelected(null);
        return;
      }
      if (hasUnsavedChanges()) setGate({ kind: "select", file });
      else setSelected(file);
    },
    [selected, hasUnsavedChanges, node],
  );

  // A save that fails stops the verb: the writer stays where they were, with
  // the buffer dirty and the shell's error on screen. Adopting would replace
  // the unsaved text with another file, and the add and the comparison would
  // read a disk the text never reached.
  const proceedGate = useCallback(async () => {
    const pending = gate;
    setGate(null);
    if (!pending || !node) return;
    if (!(await saveActiveFile())) return;
    if (pending.kind === "add") beginAdd();
    else if (pending.kind === "adopt")
      await adoptSnapshot(node.id, pending.file);
    else setSelected(pending.file);
  }, [gate, node, saveActiveFile, adoptSnapshot, beginAdd]);

  const skipGate = useCallback(() => {
    const pending = gate;
    setGate(null);
    if (!pending || !node) return;
    if (pending.kind === "add") beginAdd();
    else if (pending.kind === "adopt")
      void adoptSnapshot(node.id, pending.file, { discarded: true });
    else setSelected(pending.file);
  }, [gate, node, adoptSnapshot, beginAdd]);

  /**
   * Enter on the ghost row creates the snapshot in one commit, with the typed
   * title or the default. The ghost is dismissed before the write so a
   * failure cannot leave a phantom that reads as a real row; the shell
   * surfaces the error.
   */
  const commitAdding = useCallback(async () => {
    if (!node || addingPending) return;
    const value = addingValue.trim();
    setAdding(false);
    setAddingValue("");
    setAddingPending(true);
    try {
      await addSnapshot(node.id, value);
    } finally {
      setAddingPending(false);
    }
  }, [node, addingPending, addingValue, addSnapshot]);

  // ── Renaming a title in place ──────────────────────────────────────────────
  const beginRename = useCallback((snapshot: Snapshot) => {
    setAdding(false);
    setAddingValue("");
    setRenaming(snapshot.file);
    setRenamingValue(snapshot.title);
  }, []);

  const commitRename = useCallback(() => {
    const file = renaming;
    const value = renamingValue.trim();
    setRenaming(null);
    if (!file || !node || value.length === 0) return;
    void renameSnapshotTitle(node.id, file, value);
  }, [renaming, renamingValue, node, renameSnapshotTitle]);

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── The divider ────────────────────────────────────────────────────────────
  // The shared hook owns the drag and the keyboard; this face only persists
  // the settled fraction to the writer's prefs.
  const persisted = props?.ui.snapshotSplit ?? null;
  const { split, panelRef, beginSplitDrag, onSplitKeyDown } = useSplitDrag({
    default: DEFAULT_SPLIT,
    min: MIN_SPLIT,
    max: MAX_SPLIT,
    keyStep: SPLIT_KEY_STEP,
    external: persisted,
    onCommit: setSnapshotSplit,
  });

  // ── The empty states ───────────────────────────────────────────────────────
  if (!node) {
    return (
      <div className="dock-face dock-face-empty">
        <p>{t("snapshots.emptyNoNode")}</p>
      </div>
    );
  }

  const adopted = node.adopted;
  const tableHeight = splitHeight(split);

  return (
    <div className="dock-face snap-face" ref={panelRef}>
      {/* ── The table ────────────────────────────────────────────────────────
          A list of rows, not a <table>: every cell is a real button in the
          accessibility tree. Column one is a fixed 44px lane where the tick
          and the Adopt button crossfade without moving the layout. The [+]
          button sits at the head's right end so it never scrolls with the
          list. */}
      <div className="snap-table" style={{ height: tableHeight }}>
        <ListAddButton
          label={t("snapshots.addNewSnapshot")}
          onClick={requestAdd}
        />
        <div
          className="snap-scroll"
          role="list"
          aria-label={t("snapshots.label")}
        >
          {adding && (
            /* The ghost row: nothing ticked or dated, the title field where
               the real row's title will be. */
            <ListRow
              title={
                <input
                  className="snap-title-input snap-add-input"
                  value={addingValue}
                  placeholder={addingDefault}
                  aria-label={addingDefault || t("snapshots.add")}
                  spellCheck={false}
                  autoFocus
                  onChange={(e) => setAddingValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitAdding();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      abortAdding();
                    }
                    e.stopPropagation();
                  }}
                  onBlur={abortAdding}
                />
              }
            />
          )}
          {rows.map((snapshot) => {
            const isAdopted = snapshot.file === adopted;
            const isSelected = selected === snapshot.file;
            const isRenaming = renaming === snapshot.file;
            // The edit time is the node's perNode stamp. Only the adopted
            // file is ever written, so its save time is this row's edit time;
            // a non-adopted row was never written and shows its creation
            // moment, which is the same answer as "never edited".
            const edited = isAdopted
              ? (props?.stats.perNode.find((n) => n.nodeId === node.id)
                  ?.updatedAt ?? "")
              : "";
            const relative = relativeOf(snapshot.file);
            // The relative-position label appears three times in the row (the
            // button's visible text, its aria-label, its tooltip), from one
            // string, so the count interpolation never diverges.
            const relativeLabel = relative
              ? t(
                  relative.dir === "back"
                    ? "snapshots.rowBack"
                    : "snapshots.rowAhead",
                  { count: relative.count },
                )
              : "";
            return (
              <ListRow
                key={snapshot.file}
                className={
                  [isAdopted ? "adopted" : "", isSelected ? "selected" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                lead={
                  isAdopted ? (
                    <Icon
                      name={appIcons.confirm}
                      size={13}
                      className="snap-tick"
                      title={t("snapshots.adopted")}
                    />
                  ) : (
                    <button
                      type="button"
                      className="snap-adopt"
                      onClick={() => requestAdopt(snapshot.file)}
                    >
                      {t("snapshots.adopt")}
                    </button>
                  )
                }
                meta={
                  <>
                    {/* The adopted row's word beside its tick, drawn only by
                        a theme that sets it at the title's end. */}
                    {isAdopted && (
                      <span className="snap-adopted" aria-hidden>
                        {t("snapshots.adopted")}
                      </span>
                    )}
                    {relative && (
                      <button
                        type="button"
                        className="snap-rel"
                        data-dir={relative.dir}
                        data-count={relative.count}
                        aria-label={relativeLabel}
                        title={relativeLabel}
                        onClick={() => requestSelect(snapshot.file)}
                      >
                        {relativeLabel}
                      </button>
                    )}
                    <button
                      type="button"
                      className="snap-when"
                      aria-pressed={isSelected}
                      onClick={() => requestSelect(snapshot.file)}
                    >
                      {formatWhen(edited || snapshot.created, i18n.language)}
                    </button>
                  </>
                }
                title={
                  isRenaming ? (
                    <input
                      className="snap-title-input"
                      value={renamingValue}
                      aria-label={t("snapshots.rename")}
                      spellCheck={false}
                      autoFocus
                      onChange={(e) => setRenamingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenaming(null);
                        }
                        e.stopPropagation();
                      }}
                      onBlur={commitRename}
                    />
                  ) : (
                    <button
                      type="button"
                      className="snap-title"
                      aria-pressed={isSelected}
                      onClick={() => requestSelect(snapshot.file)}
                    >
                      {snapshot.title}
                    </button>
                  )
                }
                verbs={
                  <>
                    <RowVerb
                      icon="rename"
                      label={t("snapshots.rename")}
                      onClick={() => beginRename(snapshot)}
                    />
                    {!isAdopted && (
                      <RowVerb
                        icon="delete"
                        label={t("snapshots.delete")}
                        onClick={() => setConfirmDelete(snapshot.file)}
                      />
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      </div>

      {/* ── The divider ───────────────────────────────────────────────── */}
      <div
        className="snap-divider"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("dock.resize")}
        tabIndex={0}
        onPointerDown={beginSplitDrag}
        onKeyDown={onSplitKeyDown}
      />

      {/* ── The preview ───────────────────────────────────────────────── */}
      <div className="snap-preview">
        <div className="dock-scroll">
          {preview && preview.failed ? (
            <p className="dock-problem">{t("dock.unreadable")}</p>
          ) : preview ? (
            <div
              className="snap-preview-body dock-read"
              dangerouslySetInnerHTML={{ __html: trustedHtml(previewHtml) }}
            />
          ) : (
            <p className="snap-preview-empty">{t("snapshots.previewEmpty")}</p>
          )}
        </div>
      </div>

      {/* ── The dialogs ───────────────────────────────────────────────── */}
      {gate && node && (
        <LeaveDialog
          title={t("snapshots.saveBeforeTitle", { title: node.title })}
          body={t("snapshots.saveBeforeBody")}
          onSave={() => void proceedGate()}
          onStay={() => setGate(null)}
          onSkip={skipGate}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={t("snapshots.deleteTitle", {
            name: deleteName(confirmDelete, rows),
          })}
          body={t("snapshots.deleteBody")}
          confirmLabel={t("bin.moveTo")}
          danger
          onConfirm={() => {
            const file = confirmDelete;
            setConfirmDelete(null);
            if (file === selected) setSelected(null);
            void deleteSnapshot(node.id, file);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/** The title a deleted row names, so the dialog uses the writer's words. */
function deleteName(file: string, rows: Snapshot[]): string {
  return rows.find((s) => s.file === file)?.title ?? file;
}
