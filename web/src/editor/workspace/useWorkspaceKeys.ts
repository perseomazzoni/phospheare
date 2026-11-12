// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect } from "react";
import type { EditorEngine } from "../views/engine";
import { matchesShortcut } from "../views/shortcuts";

export interface WorkspaceKeysOptions {
  engine: EditorEngine;
  runSave: () => Promise<boolean>;
  toggleSnapshot: () => void;
  toggleFind: () => void;
  openSheet: () => void;
  openPalette: (mode: "field") => void;
}

export function useWorkspaceKeys({
  engine,
  runSave,
  toggleSnapshot,
  toggleFind,
  openSheet,
  openPalette,
}: WorkspaceKeysOptions): void {
  // Every binding in the table reaches the engine from here, so a control the
  // bar folds behind a hover is still one keystroke away (`shortcuts.ts`).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut("save", e)) {
        e.preventDefault();
        void runSave();
        return;
      }
      if (matchesShortcut("snapshot", e)) {
        e.preventDefault();
        toggleSnapshot();
        return;
      }
      if (matchesShortcut("find", e)) {
        e.preventDefault();
        toggleFind();
        return;
      }

      if (matchesShortcut("setTitle", e)) {
        e.preventDefault();
        engine.setBlockType("h1");
        return;
      }
      if (matchesShortcut("setSubtitle", e)) {
        e.preventDefault();
        engine.setBlockType("h2");
        return;
      }
      if (matchesShortcut("setBody", e)) {
        e.preventDefault();
        engine.setBlockType("paragraph");
        return;
      }

      if (matchesShortcut("alignLeft", e)) {
        e.preventDefault();
        engine.align("left");
        return;
      }
      if (matchesShortcut("alignCenter", e)) {
        e.preventDefault();
        engine.align("center");
        return;
      }
      if (matchesShortcut("alignRight", e)) {
        e.preventDefault();
        engine.align("right");
        return;
      }
      if (matchesShortcut("alignJustify", e)) {
        e.preventDefault();
        engine.align("justify");
        return;
      }

      // The sheet and the palette, through which the rest of the table is
      // discoverable.
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !isTyping(e)) {
        e.preventDefault();
        openSheet();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        openSheet();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !e.repeat
      ) {
        e.preventDefault();
        // Mod+K is a typing gesture: the writer's hands are already on the
        // keys and the next thing they do is type, so the field is live.
        openPalette("field");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine, runSave, toggleSnapshot, toggleFind, openSheet, openPalette]);
}

/**
 * Whether a key lands in a text field or the prose, where `?` is typed rather
 * than opening the sheet.
 */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  // jsdom does not implement `isContentEditable`, so the attribute is asked
  // instead. The prose surface is the editor's only editable region.
  return el.closest("[contenteditable]") !== null;
}
