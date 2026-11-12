// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Focus order: the arithmetic behind a focus trap, apart from the DOM that
// applies it. Wrapping is easy to get wrong (off by one at the ends, or an
// infinite loop when the trap is empty), and as arithmetic it is tested in
// Node rather than in a browser.

/**
 * What can take focus. `:not([disabled])` rather than `:disabled`, because
 * the attribute is what a detached or not-yet-painted element carries.
 * `[tabindex]:not([tabindex="-1"])` catches containers given a tab stop; -1
 * is excluded, since it means "focusable by script, not by Tab".
 */
export const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * The index Tab should land on next.
 *
 * `current` is where focus is now, or -1 when it is outside the trap, as on
 * the first Tab after opening or after a click on something the browser would
 * not focus. From outside, Tab enters at the start and Shift+Tab at the end,
 * so the trap is reachable from either direction.
 *
 * Returns -1 for an empty trap: there is nowhere to go, and the caller leaves
 * focus where it is.
 */
export function nextFocusIndex(
  count: number,
  current: number,
  back: boolean,
): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return back ? count - 1 : 0;
  return back ? (current - 1 + count) % count : (current + 1) % count;
}
