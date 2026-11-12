// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  CommandBar,
  CommandBarAction,
  CommandBarSegment,
  CommandBarToggle,
  CommandBarTrack,
  Dots,
  Icon,
  Tip,
} from "../../ui";
import { appIcons } from "../../ui/appIcons";
// The glyph table is shared with the structure panel's mark, so the two
// surfaces answering "where are my words" agree.
import { saveGlyph, type SaveState } from "../saveMark";
import type { EditorEngine } from "../views/engine";
import { formatShortcut } from "../views/shortcuts";
import type { Alignment, BlockType } from "../engine";
import { useFoldBehaviour } from "../foldBehaviour";
import { useSaveTight } from "../saveTight";
import { useNarrow, usePhone } from "../useNarrow";

// ── The bar ──────────────────────────────────────────────────────────────────
//
// The editor's command bar. A control's width depends on when it is drawn:
// the block type and alignment choices rest as their current answer and grow
// into a row under the pointer. That is safe because every control here is
// also a shortcut, listed in the sheet and reachable from the palette, so a
// folded control is one keystroke away.
//
// The bar knows nothing about find. `FindPanel` owns the field, the controls
// under it and the search state; the bar is handed a segment to draw. Do not
// move search state into this file.

export interface EditorBarProps {
  engine: EditorEngine;
  /** The find segment, built by `FindPanel`. */
  find: React.ReactNode;
  /** Whether a panel is open below the bar, so the dividers can step back. */
  panelOpen: boolean;
  /**
   * The search itself is open. Drives the find segment's `data-open`: the
   * field expands on click and stays expanded while the search panel is up,
   * but never on hover, so a passing pointer does not grow the field.
   */
  findOpen: boolean;
  /** Find has the writer's attention; the rest of the bar recedes. */
  findFocused: boolean;
  charsOpen: boolean;
  onToggleChars: () => void;
  /** Open the structure panel: the phone bar's first slot. */
  onOpenStructure: () => void;
  /** Open the command palette: the phone bar's overflow, its fifth slot. */
  onOpenPalette: () => void;
  askOpen?: boolean;
  /**
   * A web search waits on the writer and the Ask face is not in view:
   * the button takes the attention mark, its name says why, and
   * pressing it brings the writer to the ask. State only; the query never
   * reaches the bar.
   */
  askWaiting?: boolean;
  /**
   * The Ask button. Absent when there is no Assistant (the demo), and
   * then the toggle is not drawn at all. The bar's "disabled, never removed"
   * rule is for a mode that owns the document for a while, and a missing
   * Assistant is not a mode.
   */
  onToggleAsk?: () => void;
  snapshotOpen: boolean;
  onToggleSnapshot: () => void;
  /**
   * The margin's comments, shown or put away. Absent where there is no
   * margin (no node open, no comments service), and then not drawn.
   */
  commentsShown?: boolean;
  onToggleComments?: () => void;
  /**
   * The walk through the open node's comments, either side of the toggle.
   * Absent while there is nothing to walk to (no comment on a passage, or
   * the comments put away), and then not drawn.
   */
  onPreviousComment?: () => void;
  onNextComment?: () => void;
  /**
   * The revision rail, the history button (Ctrl+Shift+H): the snapshot
   * button opens the moments kept, this one the steps taken.
   */
  historyOpen: boolean;
  onToggleHistory: () => void;
  save: SaveFace;
  /**
   * Called while the bar is engaged (the pointer inside it or one of its
   * controls focused), so the shell can lift the bar over the panels it
   * overlaps as soon as a writer reaches for it.
   */
  onFoldEngaged?: (engaged: boolean) => void;
}

/**
 * What the leading segment says: six states in one box. It is a status until
 * there is something to do, since with autosave on a mostly disabled Save
 * button teaches the writer to ignore it. With autosave off it becomes a
 * plain Save button, because then only the writer saves.
 */
export interface SaveFace {
  /** The states `editor/saveMark.ts` defines; the panel's mark reads them. */
  state: SaveState;
  /** `Saved · 14:32`, or the reason a write did not land. */
  detail: string | null;
  onSave: () => void;
}

/**
 * Everything the bar's render reads from the engine, as one comparable value.
 * A new read of the engine in the bar belongs here, or it is drawn stale.
 */
export function barFacts(engine: EditorEngine): string {
  return [
    engine.currentBlockType,
    engine.currentAlignment,
    engine.isMonospaceInline,
    engine.isBold,
    engine.isItalic,
    engine.canUndo,
    engine.canRedo,
    engine.isInDiff,
    engine.inSnapshotDiff,
  ].join("|");
}

/**
 * Re-render only when what the bar shows of the engine changes, not on every
 * notification, which would redraw the whole bar per keystroke.
 * Typing inside a word changes none of these facts; the first keystroke after
 * a save, a caret moving into bold, or an undo does.
 */
function useEngineState(engine: EditorEngine) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let drawn = barFacts(engine);
    return engine.subscribe(() => {
      const facts = barFacts(engine);
      if (facts === drawn) return;
      drawn = facts;
      tick();
    });
  }, [engine]);
}

/**
 * Sizes the block fold's resting box to its face, measured, so the word is
 * never cut; a guessed width cuts the longest face in some language. The
 * fold carries `--ed-fold-rest`, written from the face's laid-out width; the
 * stylesheet reads it at rest and ignores it while open or folded to the
 * glyph. Written before paint (`useLayoutEffect`), so the box never flashes
 * from the fallback. A bar mounted before it has a size measures a zero face,
 * so the face is also observed and the var is written once it has a width;
 * without that the fold rests at the fallback. The write suspends the fold's
 * transition: a transitioned width fed through an unregistered custom
 * property latches its old value in Chrome (`editor.css`), so a late write
 * would leave the box at the fallback. Where every rect measures zero, as in
 * jsdom, the var is never written and the CSS fallback holds.
 */
function useFoldRestWidth(
  foldRef: React.RefObject<HTMLDivElement | null>,
  faceRef: React.RefObject<HTMLSpanElement | null>,
  blockType: BlockType,
) {
  useLayoutEffect(() => {
    const fold = foldRef.current;
    const face = faceRef.current;
    if (!fold || !face) return;
    const write = () => {
      const width = face.offsetWidth;
      const rest = `${Math.ceil(width)}px`;
      if (width <= 0 || fold.style.getPropertyValue("--ed-fold-rest") === rest)
        return;
      fold.style.transition = "none";
      fold.style.setProperty("--ed-fold-rest", rest);
      void fold.offsetWidth;
      fold.style.transition = "";
    };
    write();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(write);
    ro.observe(face);
    return () => ro.disconnect();
  }, [foldRef, faceRef, blockType]);
}

export default function EditorBar({
  engine,
  find,
  panelOpen,
  findOpen,
  findFocused,
  charsOpen,
  onToggleChars,
  onOpenStructure,
  onOpenPalette,
  askOpen,
  askWaiting = false,
  onToggleAsk,
  snapshotOpen,
  onToggleSnapshot,
  commentsShown,
  onToggleComments,
  onPreviousComment,
  onNextComment,
  historyOpen,
  onToggleHistory,
  save,
  onFoldEngaged,
}: EditorBarProps) {
  useEngineState(engine);
  const { t } = useTranslation();

  const blockType = engine.currentBlockType;
  const alignment = engine.currentAlignment;
  const monospace = engine.isMonospaceInline;
  // The comparing mode owns the document, so every control that would write
  // to it is disabled, never removed. The engine's own gates are the safety;
  // the disabled state tells the writer, since a live-looking Bold that does
  // nothing would teach them to trust nothing in the bar.
  const readonly = engine.isInDiff;

  // ── The fold behaviour ─────────────────────────────────────────────────────
  // The latched behaviour drives `data-open` for every control that declares
  // `data-fold` (the two folds and find), and the stylesheet keyed off them
  // takes over. No control in the bar is revealed by a resting pointer, which
  // a finger cannot reach; the autosave switch lives in the writing
  // preferences.
  const { barRef, open, engaged } = useFoldBehaviour();

  const foldRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLSpanElement>(null);
  useFoldRestWidth(foldRef, faceRef, blockType);

  // The save chip gives up its word for the dot before the bar shows its
  // scrollbar, the last resort (`saveTight.ts`). Narrow windows collapse it
  // the same way (`saveTip`).
  const { tight: saveTight } = useSaveTight(barRef);
  // Called unconditionally, then combined: `saveTight || useNarrow()` would
  // skip the hook call when the bar overflows, a Rules-of-Hooks violation
  // that jsdom, measuring no geometry, would never expose.
  const narrow = useNarrow();
  const phone = usePhone();
  const saveCollapsed = saveTight || narrow;

  useEffect(() => {
    onFoldEngaged?.(engaged);
  }, [engaged, onFoldEngaged]);

  const openAttr = (name: string) => (open(name) ? "1" : "0");

  // ── The phone bar ──────────────────────────────────────────────────────────
  //
  // Six slots in three pairs; everything else is in the palette.
  //
  // The desktop bar keeps its natural width and scrolls when the window
  // cannot hold it, which works where the scrollbar is drawn. On touch the
  // scrollbar is not drawn until a scroll is under way, so a scrolling bar
  // hides much of itself.
  //
  // What stays is what a writer reaches for while writing; the palette is the
  // overflow. Save keeps all six of its states (`SaveState`).
  if (phone)
    return (
      <CommandBar
        ref={barRef}
        open={panelOpen}
        data-phone="1"
        role="toolbar"
        aria-label={t("toolbar.formatting")}
      >
        <CommandBarSegment>
          <CommandBarToggle
            label={t("tree.panelLabel")}
            icon={appIcons.structure}
            pressed={false}
            onClick={onOpenStructure}
          />
          <CommandBarToggle
            label={t("toolbar.undo")}
            icon={appIcons.undo}
            pressed={false}
            disabled={!engine.canUndo || (readonly && !engine.inSnapshotDiff)}
            onClick={() => engine.undo()}
          />
        </CommandBarSegment>

        <CommandBarSegment>
          <CommandBarToggle
            label={t("toolbar.bold")}
            icon={appIcons.bold}
            pressed={engine.isBold}
            disabled={readonly}
            onClick={() => engine.toggleBold()}
          />
          <CommandBarToggle
            label={t("toolbar.italic")}
            icon={appIcons.italic}
            pressed={engine.isItalic}
            disabled={readonly}
            onClick={() => engine.toggleItalic()}
          />
        </CommandBarSegment>

        <CommandBarSegment>
          <CommandBarToggle
            label={t("titlebar.palette")}
            icon={appIcons.palette}
            pressed={false}
            onClick={onOpenPalette}
          />
          <SaveSegment save={save} collapsed />
        </CommandBarSegment>
      </CommandBar>
    );

  return (
    <CommandBar
      ref={barRef}
      open={panelOpen}
      data-focus={findFocused ? "find" : undefined}
      data-save-tight={saveTight ? "1" : undefined}
      role="toolbar"
      aria-label={t("toolbar.formatting")}
    >
      <CommandBarSegment>
        <SaveSegment save={save} collapsed={saveCollapsed} />
      </CommandBarSegment>

      {/* 3–6 · Block type. Page break is an insert, not a state, so it is not
          in the fold's row of states; it is its own button beside the fold,
          pressed only while the caret stands on a break. */}
      <CommandBarSegment>
        <div
          ref={foldRef}
          className="ed-fold ed-fold-block"
          data-fold="block"
          data-open={openAttr("block")}
        >
          <span className="ed-fold-face" ref={faceRef} aria-hidden>
            {/* The two heading kinds rest as their words (`BLOCK_FACE`), the
                same in every language, so no locale's label sets the resting
                width. Body and the break rest as their glyphs: the paragraph
                mark is the body's word. */}
            {blockType === "paragraph" || blockType === "pagebreak" ? (
              <Icon
                name={blockIcon(blockType)}
                size={14}
                data-icon={blockIcon(blockType)}
              />
            ) : (
              BLOCK_FACE[blockType]
            )}
          </span>
          <div className="ed-fold-row">
            <CommandBarTrack
              label={t("toolbar.blockType")}
              value={blockType}
              disabled={readonly}
              onChange={(next) => engine.setBlockType(next)}
              options={[
                {
                  value: "h1",
                  text: BLOCK_MARK.h1,
                  label: t("toolbar.title"),
                  shortcut: formatShortcut("setTitle"),
                },
                {
                  value: "h2",
                  text: BLOCK_MARK.h2,
                  label: t("toolbar.subtitle"),
                  shortcut: formatShortcut("setSubtitle"),
                },
                {
                  value: "paragraph",
                  icon: appIcons.body,
                  label: t("toolbar.body"),
                  shortcut: formatShortcut("setBody"),
                },
              ]}
            />
          </div>
        </div>
        <CommandBarToggle
          label={t("toolbar.pageBreak")}
          icon={appIcons.pageBreak}
          pressed={blockType === "pagebreak"}
          disabled={readonly}
          shortcut={formatShortcut("pageBreak")}
          onClick={() => engine.insertPageBreak()}
        />
      </CommandBarSegment>

      {/* 1–2 · Normal ↔ Monospace is a two-way choice, so it is a thumb. */}
      <CommandBarSegment>
        <CommandBarTrack
          label={t("toolbar.inlineFace")}
          className="ed-track-inline"
          cell={32}
          value={monospace ? "mono" : "normal"}
          disabled={readonly}
          onChange={(next) =>
            next === "mono" ? engine.toggleMonospace() : engine.setNormalText()
          }
          options={[
            {
              value: "normal",
              icon: appIcons.normalText,
              label: t("toolbar.normalText"),
              shortcut: formatShortcut("setNormalText"),
            },
            {
              value: "mono",
              icon: appIcons.monospace,
              label: t("toolbar.monospace"),
              shortcut: formatShortcut("monospaceInline"),
            },
          ]}
        />

        {/* 7–9 · The three a writer reaches for constantly, never folded. */}
        <CommandBarToggle
          label={t("toolbar.bold")}
          icon={appIcons.bold}
          pressed={engine.isBold}
          disabled={readonly}
          shortcut={formatShortcut("bold")}
          onClick={() => engine.toggleBold()}
        />
        <CommandBarToggle
          label={t("toolbar.italic")}
          icon={appIcons.italic}
          pressed={engine.isItalic}
          disabled={readonly}
          shortcut={formatShortcut("italic")}
          onClick={() => engine.toggleItalic()}
        />
        <CommandBarToggle
          label={t("toolbar.toggleCase")}
          icon={appIcons.changeCase}
          pressed={false}
          disabled={readonly}
          shortcut={formatShortcut("toggleCase")}
          onClick={() => engine.toggleCase()}
        />
      </CommandBarSegment>

      {/* 10–13 · Alignment rests as its own glyph, clearer than any word for
          it. */}
      <CommandBarSegment>
        <div
          className="ed-fold ed-fold-align"
          data-fold="align"
          data-open={openAttr("align")}
        >
          <span className="ed-fold-face" aria-hidden>
            <Icon
              name={alignIcon(alignment)}
              size={14}
              data-icon={alignIcon(alignment)}
            />
          </span>
          <div className="ed-fold-row">
            <CommandBarTrack
              label={t("toolbar.alignment")}
              // The open row's cells, 2px inside the fold's box.
              cell={32}
              value={alignment}
              disabled={readonly}
              onChange={(next) => engine.align(next)}
              options={[
                {
                  value: "left",
                  icon: appIcons.alignLeft,
                  label: t("toolbar.alignLeft"),
                  shortcut: formatShortcut("alignLeft"),
                },
                {
                  value: "center",
                  icon: appIcons.alignCenter,
                  label: t("toolbar.alignCenter"),
                  shortcut: formatShortcut("alignCenter"),
                },
                {
                  value: "right",
                  icon: appIcons.alignRight,
                  label: t("toolbar.alignRight"),
                  shortcut: formatShortcut("alignRight"),
                },
                {
                  value: "justify",
                  icon: appIcons.alignJustify,
                  label: t("toolbar.justify"),
                  shortcut: formatShortcut("alignJustify"),
                },
              ]}
            />
          </div>
        </div>
      </CommandBarSegment>

      {/* 14–15 · History */}
      <CommandBarSegment>
        <CommandBarToggle
          label={t("toolbar.undo")}
          icon={appIcons.undo}
          pressed={false}
          // Live in the snapshot comparison, where each accepted hunk is an
          // ordinary undoable step; the rail's walk owns its own wheel, so
          // there these stay disabled.
          disabled={!engine.canUndo || (readonly && !engine.inSnapshotDiff)}
          shortcut={formatShortcut("undo")}
          onClick={() => engine.undo()}
        />
        <CommandBarToggle
          label={t("toolbar.redo")}
          icon={appIcons.redo}
          pressed={false}
          disabled={!engine.canRedo || (readonly && !engine.inSnapshotDiff)}
          shortcut={formatShortcut("redo")}
          onClick={() => engine.redo()}
        />
      </CommandBarSegment>

      {/* 16 · Special characters */}
      <CommandBarSegment>
        <CommandBarToggle
          label={t("toolbar.specialChars")}
          text="Àé"
          pressed={charsOpen}
          onClick={onToggleChars}
        />
      </CommandBarSegment>

      <CommandBarSegment>
        {/* The two faces of the timeline, then the Ask button when there is an
            Assistant, in one segment so neither timeline button is stranded at
            the far end of the bar. */}
        <CommandBarToggle
          label={t("toolbar.history")}
          icon={appIcons.history}
          pressed={historyOpen}
          shortcut={formatShortcut("rail")}
          onClick={onToggleHistory}
        />
        <CommandBarToggle
          label={t("toolbar.snapshot")}
          icon={appIcons.snapshot}
          pressed={snapshotOpen}
          shortcut={formatShortcut("snapshot")}
          onClick={onToggleSnapshot}
        />
        {/* The margin's comments, pressed while shown. Put away, the margin
            is not drawn and keeps no room beside the prose. */}
        {/* With a comment to walk to, the toggle is a fold, as alignment
            is: at rest one glyph with the toggle's pressed look; under
            the pointer or focus, the toggle where the face was with the walk
            controls to its right. With nothing to walk to, the toggle
            stands alone. */}
        {onToggleComments &&
          (onPreviousComment && onNextComment ? (
            <div
              className="ed-fold ed-fold-comments"
              data-fold="comments"
              data-open={openAttr("comments")}
            >
              <span
                className="ed-fold-face"
                data-pressed={(commentsShown ?? true) ? "1" : "0"}
                aria-hidden
              >
                <Icon
                  name={appIcons.comment}
                  size={15}
                  data-icon={appIcons.comment}
                />
              </span>
              <div className="ed-fold-row">
                <CommandBarToggle
                  label={t("toolbar.comments")}
                  icon={appIcons.comment}
                  pressed={commentsShown ?? true}
                  onClick={onToggleComments}
                />
                {/* Next before previous: the walk's usual step is forward,
                    down the page, so it sits nearest the bubble. */}
                <CommandBarAction
                  label={t("toolbar.nextComment")}
                  icon={appIcons.nextComment}
                  keepsCaret
                  onClick={onNextComment}
                />
                <CommandBarAction
                  label={t("toolbar.previousComment")}
                  icon={appIcons.previousComment}
                  keepsCaret
                  onClick={onPreviousComment}
                />
              </div>
            </div>
          ) : (
            <CommandBarToggle
              label={t("toolbar.comments")}
              icon={appIcons.comment}
              pressed={commentsShown ?? true}
              onClick={onToggleComments}
            />
          ))}
        {onToggleAsk && (
          <CommandBarToggle
            // The name follows the mark: the shell passes `askWaiting` only
            // while the button is unpressed, so both say it at once.
            label={t(
              askWaiting ? "toolbar.assistantWaiting" : "toolbar.assistant",
            )}
            icon={appIcons.assistant}
            pressed={askOpen ?? false}
            attention={askWaiting}
            onClick={onToggleAsk}
          />
        )}
      </CommandBarSegment>

      {/* 17 · Find, and the controls it grows below the bar. Not a fold: a
          fold opens on hover, and a search field should not grow under a
          passing pointer. Its `data-open` follows the search's own state: a
          click expands it, and it stays expanded while the panel is up. */}
      <CommandBarSegment
        className="ed-seg-find"
        data-open={findOpen ? "1" : "0"}
      >
        {find}
      </CommandBarSegment>
    </CommandBar>
  );
}

/**
 * The save chip: one face in every `SaveState`. The word names what it
 * knows ("Saved · 14:32", "Unsaved", "Saving") whether autosave will act or
 * the writer must click; autosave changes what happens next, not what the
 * box says.
 */
function SaveSegment({
  save,
  collapsed,
}: {
  save: SaveFace;
  /**
   * The word is hidden (narrow window or overflow-tight), so the tooltip
   * carries the status the glyph cannot.
   */
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  if (save.state === "absent") return null;

  // `cached` is actionable: pressing it runs the drain. It is the state the
  // writer most wants a way out of, and a chip that looks pressable must do
  // something.
  const actionable =
    save.state === "dirty" ||
    save.state === "failed" ||
    save.state === "cached";
  // A clean file has nothing to say beside its word, but folded the chip
  // keeps a quiet tick, so it is never an empty slot (the stylesheet shows it
  // only folded).
  const glyph =
    saveGlyph(save.state) ?? (save.state === "clean" ? appIcons.confirm : null);

  return (
    <div className="ed-save-wrap">
      <button
        type="button"
        className="ed-save"
        data-state={save.state}
        disabled={!actionable}
        // Derived from the state, never a fixed `toolbar.save`: collapsed to a
        // glyph, the chip must still announce the states that mean the
        // writer's words are not where they think they are.
        aria-label={saveWord(save, t)}
        // Saving must not take the caret: the writer is mid-sentence.
        onMouseDown={(event) => event.preventDefault()}
        onClick={save.onSave}
      >
        {glyph && (
          // One glyph per state, drawn on every plane, since the narrow plane
          // has no room for the word and no hover for the tip. Shape carries
          // the distinction and colour only reinforces it, so a writer who
          // cannot tell the two warm inks apart still sees different shapes.
          <Icon
            name={glyph}
            size={13}
            className="ed-save-glyph"
            data-icon={glyph}
          />
        )}
        {save.state === "saving" ? (
          <Dots label={t("toolbar.saving")} />
        ) : (
          // A collapse hides the word and leaves the glyph; the accessible
          // name above carries the meaning either way.
          <span className="ed-save-label">{saveWord(save, t)}</span>
        )}
      </button>
      {/* The tip hangs off the wrap, not the button: a clean or saved state
          is a disabled button, which swallows pointer events, so the tooltip
          would never appear when the collapsed glyph needs it. The wrap is
          always hoverable. */}
      <Tip
        label={saveTipWord(save, collapsed, t)}
        shortcut={formatShortcut("save")}
      />
    </div>
  );
}

function saveWord(save: SaveFace, t: (key: string) => string): string {
  switch (save.state) {
    case "dirty":
      return t("toolbar.unsaved");
    case "failed":
      return save.detail ?? t("toolbar.notSaved");
    case "cached":
      // Its own key, never a variant of Saved: this state is not saved.
      //
      // It names the kind of destination, not the backend: naming the backend
      // is for screens that offer a choice.
      return t("toolbar.pushing");
    case "comparing":
      // The bar's one non-actionable status: a read-only comparison is up,
      // and there is nothing to save until the writer returns to the
      // adopted snapshot.
      return t("toolbar.comparing");
    default:
      // `Saved · 14:32` while there is a time to name, and the bare word before
      // the first write of a session, since there is no time to state.
      return save.detail
        ? `${t("toolbar.saved")} · ${save.detail}`
        : t("toolbar.saved");
  }
}

/**
 * The save tooltip's word. Collapsed, the tip carries the status word the
 * glyph replaced, but only while there is nothing to do: a dirty, failed or
 * cached save keeps the actionable "Save" tip, and a save with no timestamp
 * yet has no status worth a tooltip.
 */
export function saveTipWord(
  save: SaveFace,
  collapsed: boolean,
  t: (key: string) => string,
): string {
  const status =
    save.state !== "dirty" &&
    save.state !== "failed" &&
    save.state !== "cached";
  return collapsed && status && save.detail
    ? saveWord(save, t)
    : t("toolbar.save");
}

/**
 * The resting words of the block fold's two heading kinds, the same in every
 * language, so no locale's label sets the fold's resting width. The
 * accessible names in the engaged row speak the writer's language.
 */
const BLOCK_FACE: Record<"h1" | "h2", string> = {
  h1: "Title (H1)",
  h2: "Subtitle (H2)",
};

/**
 * The engaged row's cells: the heading marks as text, and Body as its glyph,
 * the same in every language for the same reason as `BLOCK_FACE`.
 */
const BLOCK_MARK: Record<"h1" | "h2", string> = { h1: "H1", h2: "H2" };

const blockIcon = (type: BlockType) =>
  type === "h1"
    ? appIcons.title
    : type === "h2"
      ? appIcons.subtitle
      : type === "pagebreak"
        ? appIcons.pageBreak
        : appIcons.body;

const alignIcon = (alignment: Alignment) =>
  alignment === "center"
    ? appIcons.alignCenter
    : alignment === "right"
      ? appIcons.alignRight
      : alignment === "justify"
        ? appIcons.alignJustify
        : appIcons.alignLeft;
