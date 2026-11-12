// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { RESIZE_KEY_STEP, useEdgeDrag } from "./useEdgeDrag";
import { CommandBarTrack, Icon } from "../../ui";
import { appIcons } from "../../ui/appIcons";
import type { ReferenceEditSession } from "../reference/ReferenceReader";
import AiPanel from "../assistant/AiPanel";
import SnapshotPanel, { type CompareInfo } from "./SnapshotPanel";
import ReferencePanel from "../reference/ReferencePanel";
import NotesPanel from "./NotesPanel";
import type { Assistant } from "../../ai";
import type { KeyVerdict } from "../assistant/keyVerdict";
import type { ProjectRef, StorageProvider } from "../../storage";
import type { ReferenceGroupId } from "../../project/reference";
import type { ReadRef } from "../../ai/domain/types";
import { sectionDraft } from "../reference/referenceWrite";
import type { DocumentStructure } from "../../project/types";

// The Dock: one surface with several faces, not one panel per face. It
// settles the width budget in one move, since 248 + 680 + 340 plus gutters
// does not fit 1280, and every face is something consulted while writing,
// rarely more than one at once.
//
// The assistant lives here rather than in the left panel, which is about the
// project, and a persona file is not part of the writing. The snapshots live
// here for the same reason: the project's saved moments are consulted, not
// browsed in the tree.

export type DockFace = "ask" | "reference" | "notes" | "snapshot";

/** The dock tab's cell width, sized by the longest label in any locale. */
export const DOCK_CELL = 78;

/**
 * How far the dock can be dragged, and the width it opens at, in px.
 * `clampDockWidth` is the one gate every drag, keystroke and loaded value
 * passes through.
 *
 * The floor is 340, and the dock never opens narrower. Where the head is
 * short for four tabs named in words, the tracks compress (`.dock-head
 * .ui-bar-track` in `editor.css`), and the close is never pushed past the
 * dock's edge.
 *
 * The ceiling is 960, wide enough to read a reference document or hold a
 * conversation, and the window has the last word: the shell caps the drawn
 * width at `dockRoom`'s `reach`, never over the structure panel, and gives
 * the drag a detent at `fit`, where the measure starts to be covered.
 */
export const MIN_DOCK_W = 340;
export const MAX_DOCK_W = 960;

/** What the dock's grip points `aria-controls` at; the editor has one dock. */
export const DOCK_ID = "editor-dock";

export function clampDockWidth(width: number): number {
  return Math.min(MAX_DOCK_W, Math.max(MIN_DOCK_W, width));
}

export interface DockProps {
  open: boolean;
  face: DockFace;
  onFace: (face: DockFace) => void;
  /**
   * A web search waits on the writer and the Ask face is not in view:
   * the Ask tab takes the attention mark and the waiting name. State
   * only; where the ask is, the Assistant knows.
   */
  askWaiting?: boolean;
  /**
   * A chat is answering: the Ask tab's spark takes the Stop button's rainbow
   * while another face is shown, so a writer waiting on the Reference tab
   * still sees the answer coming. State only, like `askWaiting`.
   */
  askRunning?: boolean;
  onClose: () => void;
  provider: StorageProvider;
  projectRef: ProjectRef | null;
  structure: DocumentStructure | null;
  /** The project's `document.language`, for seeding new reference documents. */
  language: string | null;
  /** The open document of the face being shown. Reference and Notes each
   *  keep their own selection, so this is scoped to `face`. */
  reference: string | null;
  activeFile: string | null;
  /**
   * The open file's node, id and display name, resolved by the shell. The id
   * keys the conversation file (stable across renames and adoptions); the
   * title is what the Ask face's header and the Snapshot face's captions
   * speak. `null` when nothing is open.
   */
  activeNode: { id: string; title: string } | null;
  quote: string | null;
  /** Set what rides on the next question, or clear it (`AiPanelProps`). */
  onQuote: (quote: string | null) => void;
  assistant?: Assistant | null;
  /** Paths waiting for the remote; the assistant's foot never says "saved". */
  queuedPaths?: ReadonlySet<string>;
  /** The account's remote providers, for `AiPanel`'s renewal warning. */
  remoteProviders?: Record<string, KeyVerdict>;
  /** The editor's shared toast, for `AiPanel`'s Undo. */
  onNotify?: (text: string, undo?: () => void) => void;
  /** Per-chat composer drafts, mirrored by the shell for `AiPanel`. */
  aiDrafts?: Record<string, string>;
  onAiDrafts?: (next: Record<string, string>) => void;
  /** The edit session for the open reference file, if it is being edited. */
  editing: ReferenceEditSession | null;
  onStartEdit: (fileName: string, text: string) => void;
  /**
   * Open a reference document straight into its editor on the Reference
   * face: the chat's "Write X" and every add control of the Reference panel.
   * `unborn` when it is not on disk yet: the shell then creates it only on a
   * save that says something.
   */
  onWriteSection: (fileName: string, text: string, unborn: boolean) => void;
  onDraft: (draft: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<boolean>;
  /**
   * The snapshot face's comparison, reported up: the two snapshots being
   * shown in the editor, or `null` when the writer is back in the adopted
   * text. The shell owns the engine's diff mode and the caption.
   */
  onCompare?: (info: CompareInfo | null) => void;
  /**
   * Bumped by the shell every time a snapshot comparison is exited from
   * outside the panel (Esc, the face closing, the rail opening): the panel
   * clears its selection on the bump, so a row can never stay highlighted
   * over a closed diff.
   */
  compareExits?: number;
  /**
   * The dock's current width, in px. The shell sets it as `--dock-w`, so the
   * panel and the measure's re-centre follow it together; this is the anchor
   * a drag starts from.
   */
  width: number;
  /**
   * How wide the drag may take the dock right now: `MAX_DOCK_W`, or less
   * where the window's `reach` stops it short of the structure panel. Never
   * below the floor. Defaults to the product ceiling.
   */
  maxWidth?: number;
  /** Where the drag sticks on its way past: the widest dock beside which the
   *  whole measure stays visible, or `null` where that is outside the
   *  travel. */
  detent?: number | null;
  /** Fired on every drag move, so the surface can re-centre live. */
  onResize: (width: number) => void;
  /** Fired once when a drag or a keyboard step ends: the persist moment. */
  onResizeEnd: (width: number) => void;
  /** The dock went away mid-drag: stop believing one is in flight. */
  onResizeCancel?: () => void;
  /** Open a reference document, routed through the shell's dirty guard. */
  onOpenReference?: (fileName: string) => void;
  /** Open a notes document: a separate face, the same editor. */
  onOpenNote?: (fileName: string) => void;
  /** A note was deleted; the shell clears the open note when it matches. */
  onDeletedNote?: (fileName: string) => void;
  /** A reference document was deleted; same clearing duty as a note. */
  onDeletedReference?: (fileName: string) => void;
  /**
   * The project's barred-from-the-assistant list, and the way to change it.
   * Passed down rather than reached for, because the harnesses render these
   * panels bare, with no project provider to ask.
   */
  barredSourceIds?: readonly string[];
  onBarSource?: (sourceId: string, barred: boolean) => void;
  /**
   * The reference cards the shell keeps open. It lives above the dock because
   * the reference panel unmounts when another face is shown: the fold must
   * survive the switch and must not replay its animation on return.
   */
  expandedCards: ReadonlySet<ReferenceGroupId>;
  onExpandedCardsChange: Dispatch<
    SetStateAction<ReadonlySet<ReferenceGroupId>>
  >;
}

export default function Dock({
  remoteProviders,
  onNotify,
  open,
  face,
  onFace,
  askWaiting = false,
  askRunning = false,
  onClose,
  provider,
  projectRef,
  structure,
  language,
  reference,
  activeFile,
  quote,
  onQuote,
  assistant,
  queuedPaths,
  aiDrafts,
  onAiDrafts,
  editing,
  onStartEdit,
  onWriteSection,
  onDraft,
  onCancelEdit,
  onSaveEdit,
  onCompare,
  compareExits,
  width,
  maxWidth = MAX_DOCK_W,
  detent = null,
  onResize,
  onResizeEnd,
  onResizeCancel,
  onOpenReference,
  onOpenNote,
  onDeletedNote,
  onDeletedReference,
  barredSourceIds,
  onBarSource,
  expandedCards,
  onExpandedCardsChange,
}: DockProps) {
  const { t } = useTranslation();
  const askText = t("dock.ask");
  const askWaitingText = t("dock.askWaiting");
  // The assistant's "write the document this chat relies on": the section
  // opens in its editor on the Reference face, and nothing is written until a
  // save carries something the writer wrote (`sectionDraft`). A shelf
  // (`characters`) has no one file to open, so only its name is said.
  const writeOrOpen = async (reference: ReadRef) => {
    if (!provider) return;
    const draft = await sectionDraft(provider, projectRef, reference, language);
    if (draft) onWriteSection(draft.fileName, draft.text, draft.unborn);
  };
  // The Reference reader's summary badge, judged by the assistant against the
  // source's current text. Memoised on the assistant, so the
  // reader's effect re-runs when the summary is re-read, not on every render.
  const judgeSummary = useMemo(
    () =>
      assistant
        ? (nodeId: string) => assistant.sources.summaryStateFor(nodeId)
        : undefined,
    [assistant],
  );
  // The reference and notes rows' AI toggle bars a source from the Assistant,
  // so without one there is nothing to bar it from and the toggle is not
  // drawn. Keyed on the same `assistant` the Ask tab keys on, so the
  // tab and its face cannot disagree.
  const barSource = assistant ? onBarSource : undefined;

  // The drag lives in `useEdgeDrag`, shared with the structure panel's grip;
  // the dock grows as the pointer moves left. The live ceiling joins the
  // product's limits in the one gate, so a drag, a keystroke and End all stop
  // where the window does.
  const clamp = useCallback(
    (w: number) => Math.min(maxWidth, clampDockWidth(w)),
    [maxWidth],
  );
  const { onPointerDown, onKeyDown, separatorProps } = useEdgeDrag({
    width,
    side: "right",
    clamp,
    keyStep: RESIZE_KEY_STEP,
    min: MIN_DOCK_W,
    max: maxWidth,
    detent,
    controls: DOCK_ID,
    onResize,
    onResizeEnd,
    onResizeCancel,
  });

  return (
    // Mounted while shut, because conditional rendering can animate open but
    // never closed: React removes the node on the frame the class changes.
    <aside
      id={DOCK_ID}
      className="ed-dock"
      data-open={open ? "1" : "0"}
      aria-label={t("dock.label")}
    >
      <span
        className="dock-resize"
        {...separatorProps}
        aria-label={t("dock.resize")}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div className="dock-head">
        {/* Seated rather than tinted: this is the top of a panel naming its
            faces, not a region of a bar, and an accent thumb there reads as a
            selected list item instead of a switch. */}
        <CommandBarTrack
          label={t("dock.label")}
          cell={DOCK_CELL}
          seat="sunk"
          fit
          value={face}
          onChange={onFace}
          options={[
            // The feature's name after its spark: the tab is the one place the
            // name and the spark that marks every AI control sit together, so
            // the writer learns what the spark means. Present only with an
            // Assistant.
            ...(assistant
              ? [
                  {
                    value: "ask" as const,
                    text: askText,
                    // The visible word stays; the accessible name and the tip
                    // say a search waits, only while the mark does.
                    label: askWaiting ? askWaitingText : askText,
                    icon: appIcons.assistant,
                    attention: askWaiting,
                    busy: askRunning,
                  },
                ]
              : []),
            {
              value: "reference",
              text: t("dock.reference"),
              label: t("dock.reference"),
            },
            {
              value: "notes",
              text: t("dock.notes"),
              label: t("dock.notes"),
            },
            {
              value: "snapshot",
              text: t("dock.snapshot"),
              label: t("dock.snapshot"),
            },
          ]}
        />
        {/* No `.ui-spacer` here: the row has 301px for four tabs and a close,
            and `margin-left: auto` on the close does the spacer's work
            without its 16px. */}
        <button
          type="button"
          className="dock-close"
          aria-label={t("dock.close")}
          onClick={onClose}
        >
          <Icon name={appIcons.close} size={13} />
        </button>
      </div>

      {face === "reference" ? (
        <ReferencePanel
          provider={provider}
          projectRef={projectRef}
          structure={structure}
          language={language}
          reference={reference}
          editing={editing}
          onStartEdit={onStartEdit}
          onDraft={onDraft}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onOpen={(fileName) => onOpenReference?.(fileName)}
          onWrite={onWriteSection}
          onDeleted={onDeletedReference}
          barredSourceIds={barredSourceIds}
          onBarSource={barSource}
          expandedCards={expandedCards}
          onExpandedCardsChange={onExpandedCardsChange}
          judgeSummary={judgeSummary}
        />
      ) : face === "notes" ? (
        <NotesPanel
          provider={provider}
          projectRef={projectRef}
          reference={reference}
          editing={editing}
          onStartEdit={onStartEdit}
          onDraft={onDraft}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onOpen={(fileName) => onOpenNote?.(fileName)}
          onDeleted={onDeletedNote}
          barredSourceIds={barredSourceIds}
          onBarSource={barSource}
        />
      ) : face === "snapshot" && open ? (
        // Mounted only while the face is open, unlike the other faces: the
        // panel's whole state is transient (the selection, the save-first
        // gate, the ghost row, the rename field) and must die with the face.
        // A selection that survived a close would reopen as a pressed row
        // with no comparison behind it, since the shell's close-effect ends
        // the diff.
        <SnapshotPanel
          provider={provider}
          projectRef={projectRef}
          activeFile={activeFile}
          onCompare={onCompare}
          compareExits={compareExits}
        />
      ) : (
        <AiPanel
          open={open}
          assistant={assistant ?? null}
          quote={quote}
          onQuote={onQuote}
          queuedPaths={queuedPaths}
          drafts={aiDrafts}
          onDrafts={onAiDrafts}
          remoteProviders={remoteProviders}
          onNotify={onNotify}
          structure={structure}
          onWriteReference={provider && projectRef ? writeOrOpen : undefined}
        />
      )}
    </aside>
  );
}
