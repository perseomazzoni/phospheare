// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SaveState } from "../../saveMark";

// What the bar's save chip says about the open Section. Of the save states,
// only two are things the writer can act on. The transient ones, saving and
// the confirmation after, are held by the shell rather than derived, because
// `engine.hasChanges` goes false the instant the write lands and there would
// be nothing left to confirm.

/** The states the shell holds; the rest are derived when the chip is drawn. */
export type HeldSave = Extract<
  SaveState,
  "clean" | "dirty" | "saving" | "saved" | "failed"
>;

/**
 * The held state after the engine says the buffer changed.
 *
 * A new edit overrules whatever the last write was saying. A buffer that
 * matches the file again, usually after an undo or redo walk back onto the
 * saved state, reads clean. `saving` and `saved` are transient confirmations
 * that outlive the change: `markSaved` notifies with `hasChanges` already
 * false, and would otherwise replace the tick the writer is reading. `failed`
 * clears, because the saved text advances only on a successful write, so a
 * buffer with no changes matches the last bytes written.
 */
export function afterEdit(now: HeldSave, hasChanges: boolean): HeldSave {
  if (hasChanges) return now === "saving" ? now : "dirty";
  return now === "saving" || now === "saved" ? now : "clean";
}

/** The tick is a confirmation, and one that stays becomes a status: it passes. */
export function afterSettle(now: HeldSave): HeldSave {
  return now === "saved" ? "clean" : now;
}

export interface FaceFacts {
  /** A Section is open. */
  open: boolean;
  /** A comparison is up, and every save waits for it. */
  inDiff: boolean;
  held: HeldSave;
  /** The open Section still owes the remote a write. */
  queued: boolean;
}

/**
 * The state the chip draws. `cached` sits only between `saved` and the rest:
 * a write not landed locally is still `dirty`, and one that failed is still
 * `failed`. It marks a local write that succeeded while the file is still
 * queued for the remote: "Saved" would be true of the disk or the working
 * copy and false of where the writer keeps the book.
 */
export function faceState({
  open,
  inDiff,
  held,
  queued,
}: FaceFacts): SaveState {
  if (!open) return "absent";
  if (inDiff) return "comparing";
  return held === "saved" && queued ? "cached" : held;
}
