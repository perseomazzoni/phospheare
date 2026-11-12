// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// One drag session and one removal list, shared by this folder's drag hooks:
// listen for the move and for the three ways a drag can stop. The caller
// calls `stop` on unmount, so a face that unmounts mid-drag (an orientation
// change flips the plane with the writer's finger still down) leaves no
// listener on `window` whose stray `pointerup` would commit a width or a
// split to whatever project is open by then.
//
// The helper hands back `stop` and nothing else. It holds no callback that
// could commit: the commit lives in the caller's own end, so a teardown that
// only detaches cannot persist a drag that never finished. Do not give
// `stop` a second job.

export interface DragSession {
  /** Detach the four listeners. Idempotent: a second call is a no-op. */
  stop: () => void;
}

/**
 * Listen for one drag's moves and for its three endings.
 *
 * `blur` is in the set because a pointer released outside the window never
 * fires `pointerup`, and it is the browser's own word for "the pointer went
 * away". `pointercancel` is the platform taking the gesture back: a system
 * gesture, a touch turned into a scroll.
 *
 * `onEnd` runs once, after the listeners are already off, so a handler that
 * throws still leaves nothing attached.
 */
export function startDragSession(
  onMove: (event: PointerEvent) => void,
  onEnd: () => void,
): DragSession {
  let live = true;

  function end() {
    stop();
    onEnd();
  }

  function stop() {
    if (!live) return;
    live = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", end);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", end);

  return { stop };
}
