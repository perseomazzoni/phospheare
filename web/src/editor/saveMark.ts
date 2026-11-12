// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { appIcons } from "../ui/appIcons";
import type { IconName } from "../ui/icons";

// Where the writer's words are, drawn once. The bar's save chip and the
// structure panel's mark on the open Section answer the same question, so the
// state and its glyphs live here. "Still typing" must never share a mark with
// "did not land".

/**
 * What the editor knows about the open file's words.
 *
 * `cached` means the bytes survive a reload but not the loss of this device:
 * they are in the working copy and not yet committed to the remote.
 * Calling that "saved" is the lie that costs a manuscript. It sits only
 * between `saved` and the rest: a write that has not landed locally is still
 * `dirty`, and one that failed is still `failed`.
 */
export type SaveState =
  | "absent"
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "cached"
  | "failed"
  | "comparing";

/**
 * The glyph for a state, and the phone's whole save vocabulary.
 *
 * Four signals the writer must be able to separate at 13px with no hover:
 *
 *   `failed`  an alarm, crimson. The words did not land.
 *   `dirty`   a dot, ember. There is something to write.
 *   `cached`  the sync-pending ring, ember. Written here, on its way out.
 *             It names the kind of destination, never which backend.
 *   `saved`   a tick, phos. The words are where the writer thinks they are.
 *
 * `dirty` and `cached`, the two in-flight states, share an ink and differ in
 * shape: a fourth hue at 13px is a distinction only a calibrated screen
 * carries. `dirty` is not crimson although it means "not saved": it lasts
 * about a second during ordinary typing, and a chip that is red while a
 * writer works teaches them to ignore red.
 *
 * `clean`, `saving` and `comparing` draw nothing: the first has nothing to
 * say, the second has the dots, and the third is a read-only view with
 * nothing to save.
 */
export function saveGlyph(state: SaveState): IconName | null {
  switch (state) {
    case "failed":
      return appIcons.alarm;
    case "dirty":
      // A dot, not a save glyph: the word beside it already says Unsaved, and
      // a floppy draws the button rather than the state.
      return appIcons.pending;
    case "cached":
      return appIcons.unsent;
    case "saved":
      return appIcons.confirm;
    default:
      return null;
  }
}

/**
 * The same states as the structure panel draws them: a row that is fine draws
 * nothing. Only the open row can owe anything, since there is one buffer. A
 * permanent tick there would clutter a list the writer scans; the bar already
 * shows the tick.
 */
export function markGlyph(state: SaveState): IconName | null {
  return state === "saved" ? null : saveGlyph(state);
}
