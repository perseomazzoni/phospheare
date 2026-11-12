// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { EditorEngine } from "./views/engine";

// What the editor shell draws from the engine. The engine is a mutable object
// that never changes identity, so React cannot see a keystroke land in it.
// Redrawing the whole workspace on every engine notification, two or more per
// keystroke, puts the page behind the typing on a slow machine.
//
// Everything the shell's own render reads from the engine is here, and the
// shell redraws only when this answer changes. Everything that follows the
// text or the caret (the prose, the save gutter, the margin, the bar's undo
// and redo, the revision rail, the diff's accept buttons) subscribes to the
// engine on its own.
//
// A new read of the engine in the shell's render belongs in this string, or
// the shell draws it stale until something else redraws it.

/** Everything the shell's render reads from the engine, as one comparable
 *  value: equal strings mean the shell would draw the same thing. */
export function shellFacts(engine: EditorEngine): string {
  const { anchor, focus } = engine.selection;
  const collapsed =
    anchor.para === focus.para && anchor.offset === focus.offset;
  return [
    collapsed ? "caret" : "range",
    engine.hasChanges ? "dirty" : "clean",
    engine.isInDiff ? "diff" : "-",
    engine.inSnapshotDiff ? "snapshot" : "-",
    engine.diffDirection,
    engine.diffGranularity,
    engine.diffHunks.length,
    engine.acceptsThisComparison,
  ].join("|");
}
