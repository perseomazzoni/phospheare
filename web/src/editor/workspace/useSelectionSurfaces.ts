// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { selectedPlacement, textOf } from "../comments/presentation/Margin";
import { paragraphText } from "../engine/application/diff/blocks";
import type { Rect } from "../selectionBubble";
import { writeClipboard, readClipboard } from "../views/clipboardIO";
import type { EditorEngine } from "../views/engine";
import { searchWebUrl } from "../views/searchWeb";
import { formatShortcut } from "../views/shortcuts";
import type { WritingViewHandle } from "../views/view/port";
import {
  inSameDocument,
  inSameParagraph,
  restoreDomSelection,
} from "../views/writing/dom";
import { coversText, extractWord } from "./domain/selectionWord";

// The surfaces that answer a selection in the prose: the repetition
// highlight, the selection bubble's anchor, and the context menu with the
// clipboard verbs. One `selectionchange` listener feeds the first two.
//
// A repetition highlight is one word inside one paragraph. A selection that
// spans paragraphs can never be one, and materializing its text is the
// expensive part of the selection listener, so it is refused before
// `toString()` by `inSameParagraph` in `views/writing/dom.ts`.

export interface SelectionSurfacesOptions {
  engine: EditorEngine;
  viewRef: RefObject<WritingViewHandle | null>;
  /** The view's identity: a new one re-binds the listeners to its surface. */
  viewKey: string;
  findOpen: boolean;
}

export function useSelectionSurfaces({
  engine,
  viewRef,
  viewKey,
  findOpen,
}: SelectionSurfacesOptions) {
  const { t } = useTranslation();
  // What the bubble points at, as a rect rather than a Range (`toRect`).
  const [selected, setSelected] = useState<{
    rect: Rect;
    text: string;
  } | null>(null);
  // The prose context menu's anchor, the pointer's window coordinates, or
  // null when closed. Held beside `selected` because the two surfaces coexist
  // over a selection: right-click on selected text keeps both open, and
  // choosing from either closes both.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [selectionHighlightText, setSelectionHighlightText] = useState<
    string | null
  >(null);
  const [selectionExactText, setSelectionExactText] = useState<string | null>(
    null,
  );
  const [showRepetitions, setShowRepetitions] = useState(true);

  // ── Selection highlighting ─────────────────────────────────────────────────
  // Selecting text highlights all its occurrences, case-insensitively.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const onSelectionChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          setSelectionHighlightText(null);
          setSelected(null);
          return;
        }
        const range = sel.getRangeAt(0);
        if (!inSameParagraph(range.startContainer, range.endContainer)) {
          setSelectionHighlightText(null);
          setSelectionExactText(null);
          // Across paragraphs the bubble offers everything it does within one.
          // Its text is the engine's, joined by one break per
          // paragraph boundary, as find reads a break, rather than the DOM's,
          // which spells a boundary as it renders it.
          const placement = selectedPlacement(engine);
          const spanning = placement
            ? textOf(engine.doc.map(paragraphText), placement)
            : sel.toString();
          const box = range.getBoundingClientRect();
          setSelected(
            inSameDocument(range.startContainer, range.endContainer) &&
              box.width > 0 &&
              spanning.trim() !== ""
              ? { rect: toRect(box), text: spanning }
              : null,
          );
          return;
        }
        const text = sel.toString();

        // The bubble rides the same listener and debounce; a second one would
        // answer the same event 150ms apart and disagree about the selection
        // for that long.
        //
        // The paragraph check above keeps "every one" correct: a selection
        // across two paragraphs gets the bubble without it, because find
        // never matches across a paragraph break.
        const box = range.getBoundingClientRect();
        setSelected(
          box.width > 0 && text.trim() !== ""
            ? { rect: toRect(box), text }
            : null,
        );
        // Repetitions are highlighted only for a single-word selection.
        const word = extractWord(text);
        if (word) {
          setSelectionHighlightText(word);
          setSelectionExactText(text);
          setShowRepetitions(true);
        } else {
          setSelectionHighlightText(null);
          setSelectionExactText(null);
        }
      }, 150); // Debounced so a drag-select does not flicker.
    };

    // The bubble goes on the keystroke, not after it: a writer retyping a
    // selected word has answered the bubble's question, and a surface over the
    // text being replaced is in the way. Capture, so it lands before the
    // editor's handlers and before anything can stop propagation.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key.length === 1) setSelected(null);
    };

    const onScroll = () => setSelected(null);

    // The surface the bubble positions against is the view's, looked up
    // through the handle and re-bound when the view swaps, since the
    // typewriter toggle remounts the surface element.
    const scroller = viewRef.current?.surface() ?? null;

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown, true);
    scroller?.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown, true);
      scroller?.removeEventListener("scroll", onScroll);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
    // The view identity decides which element to listen on; the effect must
    // run again when it changes, or a swapped surface keeps a dead listener.
    // The engine is read for a selection across paragraphs.
  }, [viewKey, engine, viewRef]);

  // Opening the find clears selection highlights. This is the open edge, with
  // no query yet for `selectionFor` to gate on; the query case is the gate's,
  // in the same commit the query lands. The register survives
  // the gate's release: closing the find lets a live selection's repetitions
  // repaint, since the preview follows the writer's latest act and the
  // suppression follows the query.
  useEffect(() => {
    if (findOpen) {
      setSelectionHighlightText(null);
      setSelectionExactText(null);
    }
  }, [findOpen]);

  // The view's signal means one thing: the editor lost focus. An arrival
  // survives it, because clicking anything in the chrome blurs the editor,
  // and the panel's own rows would dismiss what they had just shown. The
  // arrival ends when the writer opens another file, empties the find field,
  // moves the query, or leaves the find by its back control or Escape: acts,
  // not side effects.
  const handleClearHighlights = useCallback(() => {
    setShowRepetitions(false);
  }, []);

  // ── The prose context menu ─────────────────────────────────────────────────
  // Right-click on the prose suppresses the browser menu and shows the
  // clipboard verbs at the pointer, beside the selection bubble when one is
  // up (`menuAt`).

  const dismissClipboardSurfaces = useCallback(() => {
    setSelected(null);
    setContextMenu(null);
  }, []);

  /**
   * What made the last press, read by the context menu, which cannot ask.
   *
   * A `contextmenu` event does not say which pointer produced it, and on a
   * phone a long press in text produces it. `pointerdown` always arrives
   * first and does say, so the shell records it in capture on the way down.
   */
  const lastPointer = useRef<string>("mouse");
  const notePointer = useCallback((e: React.PointerEvent) => {
    lastPointer.current = e.pointerType;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[contenteditable]")) return;

    // A long press belongs to the platform. The native callout is the only
    // touch route to Cut, Copy, Paste and Select All: there is no toolbar for
    // them, and every shortcut needs a modifier a soft keyboard cannot
    // produce. The app's menu is built for a mouse and labels keys the device
    // does not have.
    //
    // Keyed on the pointer, like the tree's drag: a touch laptop keeps the
    // app's menu under its mouse and gets the callout under its finger.
    if (lastPointer.current === "touch" || lastPointer.current === "pen")
      return;

    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const hasSelection = coversText(engine.selection);

  const runCut = useCallback(() => {
    const payload = engine.cut();
    if (payload) void writeClipboard(payload);
    dismissClipboardSurfaces();
  }, [engine, dismissClipboardSurfaces]);

  const runCopy = useCallback(() => {
    const payload = engine.copy();
    if (payload) void writeClipboard(payload);
    dismissClipboardSurfaces();
  }, [engine, dismissClipboardSurfaces]);

  const runPaste = useCallback(
    (plain: boolean) => {
      // A menu-triggered paste has no `ClipboardEvent`, so it reads the OS
      // clipboard through the async API. The keyboard paste stays synchronous
      // in the core.
      void (async () => {
        const { html, plain: text } = await readClipboard();
        if (plain) engine.pastePlain(text);
        else engine.paste(html, text);
      })();
      dismissClipboardSurfaces();
    },
    [engine, dismissClipboardSurfaces],
  );

  const runSelectAll = useCallback(() => {
    engine.selectAll();
    const editor = viewRef.current
      ?.surface()
      ?.querySelector<HTMLElement>("[contenteditable]");
    if (editor) {
      // Select all runs engine to DOM (`shortcutDispatch.ts`).
      restoreDomSelection(editor, engine.selection);
      editor.focus();
    }
    dismissClipboardSurfaces();
  }, [engine, dismissClipboardSurfaces, viewRef]);

  const runSearchWeb = useCallback(() => {
    // The selection as plain text, searched in a fresh tab. `copy()` also
    // builds html, which a search discards.
    const payload = engine.copy();
    if (!payload || payload.plain.trim() === "") return;
    window.open(searchWebUrl(payload.plain), "_blank", "noopener,noreferrer");
    dismissClipboardSurfaces();
  }, [engine, dismissClipboardSurfaces]);

  // The selection bars read the view's surface lazily, after mount, through a
  // stable function so their `selectionchange` listener never re-binds.
  const getSurface = useCallback(
    () => viewRef.current?.surface() ?? null,
    [viewRef],
  );

  const contextMenuItems = [
    {
      id: "cut",
      label: t("toolbar.cut"),
      shortcut: formatShortcut("cut"),
      // Cut and the pastes mutate, so they are disabled while the comparing
      // mode owns the document; the engine's gate refuses them anyway. Copy
      // and select-all are reads and stay live.
      disabled: !hasSelection || engine.isInDiff,
      onSelect: runCut,
    },
    {
      id: "copy",
      label: t("toolbar.copy"),
      shortcut: formatShortcut("copy"),
      disabled: !hasSelection,
      onSelect: runCopy,
    },
    {
      id: "paste",
      label: t("toolbar.paste"),
      shortcut: formatShortcut("paste"),
      disabled: engine.isInDiff,
      onSelect: () => runPaste(false),
    },
    {
      id: "pastePlain",
      label: t("toolbar.pastePlain"),
      shortcut: formatShortcut("pastePlain"),
      disabled: engine.isInDiff,
      onSelect: () => runPaste(true),
    },
    {
      id: "selectAll",
      label: t("toolbar.selectAll"),
      shortcut: formatShortcut("selectAll"),
      separator: true,
      onSelect: runSelectAll,
    },
    {
      id: "searchWeb",
      label: t("toolbar.searchWeb"),
      disabled: !hasSelection,
      onSelect: runSearchWeb,
    },
  ];

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    selected,
    setSelected,
    contextMenu,
    closeContextMenu,
    selectionHighlightText,
    selectionExactText,
    showRepetitions,
    handleClearHighlights,
    dismissClipboardSurfaces,
    notePointer,
    handleContextMenu,
    getSurface,
    contextMenuItems,
  };
}

/**
 * A DOMRect as a plain object. A DOMRect from a live Range answers about
 * wherever that Range is when it is read, and this one is held across renders,
 * so copying the six numbers makes it a measurement.
 */
function toRect(box: DOMRect): Rect {
  return {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
    width: box.width,
    height: box.height,
  };
}
