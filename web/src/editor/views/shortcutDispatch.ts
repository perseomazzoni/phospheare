// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { EditorEngine } from "./engine";
import { SHORTCUTS, matchesShortcut, type ShortcutId } from "./shortcuts";
import { saveDomSelection, restoreDomSelection } from "./writing/dom";

/** The ids whose binding inserts a typographic character, not a format. */
const SPECIAL_CHAR_IDS: ShortcutId[] = (
  Object.keys(SHORTCUTS) as ShortcutId[]
).filter((id) => SHORTCUTS[id].action);

/**
 * Route a keydown on the editor to the engine. Returns true when a shortcut
 * fired.
 */
export function dispatchShortcutKey(
  el: HTMLElement,
  engine: EditorEngine,
  e: KeyboardEvent,
): boolean {
  const mod = e.metaKey || e.ctrlKey || e.altKey;

  if (!mod) return false;

  // The selection is synced from the DOM first, because these fire on
  // `keydown`, before `beforeinput` would have told the engine where the
  // caret moved.
  if (matchesShortcut("bold", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.toggleBold();
    return true;
  }
  if (matchesShortcut("italic", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.toggleItalic();
    return true;
  }
  if (matchesShortcut("monospaceInline", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.toggleMonospace();
    return true;
  }
  if (matchesShortcut("setNormalText", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.setNormalText();
    return true;
  }
  if (matchesShortcut("toggleCase", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.toggleCase();
    return true;
  }
  if (matchesShortcut("undo", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.undo();
    return true;
  }
  if (matchesShortcut("redo", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.redo();
    return true;
  }
  if (matchesShortcut("pageBreak", e)) {
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.insertPageBreak();
    return true;
  }
  if (matchesShortcut("selectAll", e)) {
    e.preventDefault();
    engine.selectAll();
    // Engine to DOM, the reverse of every other shortcut here: the native
    // select-all would grab the whole page.
    restoreDomSelection(el, engine.selection);
    return true;
  }

  // Checked after the formatting shortcuts so a format binding wins.
  const match = SPECIAL_CHAR_IDS.find((id) => matchesShortcut(id, e));
  if (match) {
    // Unreachable; the guard is for the type-checker.
    const action = SHORTCUTS[match].action;
    if (action === undefined) return false;
    e.preventDefault();
    syncSelectionBeforeOp(el, engine);
    engine.type(action);
    return true;
  }

  return false;
}

function syncSelectionBeforeOp(el: HTMLElement, engine: EditorEngine): void {
  const sel = saveDomSelection(el);
  if (sel) engine.updateSelection(sel);
}
