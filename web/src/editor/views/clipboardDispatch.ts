// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The browser's `copy`, `cut` and `paste` events on the editor. The selection
// is serialized from the engine's model, never the DOM, so the DOM-only
// decorations never leak. These events own the clipboard verbs, because the
// browser fires them for the keyboard and for every menu.

import type { EditorEngine } from "./engine";
import { saveDomSelection } from "./writing/dom";

export interface ClipboardDispatchOptions {
  /** Paste as plain text (Ctrl+Shift+V), ignoring the `text/html` flavor. */
  plain: boolean;
}

function syncSelection(el: HTMLElement, engine: EditorEngine): void {
  const sel = saveDomSelection(el);
  if (sel) engine.updateSelection(sel);
}

function writePayload(
  e: ClipboardEvent,
  payload: { plain: string; html: string },
): void {
  const dt = e.clipboardData;
  if (!dt) return;
  dt.setData("text/plain", payload.plain);
  dt.setData("text/html", payload.html);
}

export function dispatchCopy(
  el: HTMLElement,
  engine: EditorEngine,
  e: ClipboardEvent,
): void {
  syncSelection(el, engine);
  const payload = engine.copy();
  if (!payload) return;
  e.preventDefault();
  writePayload(e, payload);
}

/** Cut: the selection to the clipboard and out of the document, in one step. */
export function dispatchCut(
  el: HTMLElement,
  engine: EditorEngine,
  e: ClipboardEvent,
): void {
  syncSelection(el, engine);
  const payload = engine.cut();
  if (!payload) return;
  e.preventDefault();
  writePayload(e, payload);
}

export function dispatchPaste(
  el: HTMLElement,
  engine: EditorEngine,
  e: ClipboardEvent,
  options: ClipboardDispatchOptions,
): void {
  syncSelection(el, engine);
  e.preventDefault();
  const dt = e.clipboardData;
  if (!dt) return;
  const html = dt.getData("text/html");
  const plain = dt.getData("text/plain");
  if (options.plain) engine.pastePlain(plain);
  else engine.paste(html, plain);
}
