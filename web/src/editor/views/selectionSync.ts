// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// While a composition is in flight the DOM caret sits in the IME's working
// text, so feeding its offset in would shift the cursor silently
// (`insertText` slices an out-of-range offset into bounds), and the next
// ordinary keystroke would land in the wrong place. The composition's own
// range comes from `getTargetRanges()` instead.

import type { EditorEngine } from "./engine";
import { saveDomSelection } from "./writing/dom";

export interface InputFlags {
  /** A composition is in flight: the DOM is ahead of the model. */
  composing: { current: boolean };
  /** The core is mutating the DOM itself; selection echoes are not input. */
  rendering: { current: boolean };
}

/**
 * Hand the DOM's selection to the engine, unless a composition owns it. The
 * `rendering` window is held across the call so the core does not mistake
 * the engine's own `selection` notification for a caret move.
 */
export function syncSelectionFromDom(
  el: HTMLElement,
  engine: EditorEngine,
  flags: InputFlags,
): void {
  if (flags.composing.current) return;
  const sel = saveDomSelection(el);
  if (!sel) return;
  flags.rendering.current = true;
  engine.updateSelection(sel);
  flags.rendering.current = false;
}
