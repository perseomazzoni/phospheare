// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The scroll glide: an animated scroll of the page to a new position. One
// animator serves every caller, because separate rAF loops would fight each
// other over the same `scrollTop`.
//
// The glide is a single flight, module-wide, on the one-editor-at-a-time
// assumption the blink timer and the station make. A new call cancels the
// in-flight one and re-aims from where the page is. Reduced motion gets the
// end state in one frame.

/**
 * The page's arrival time; must match `--t-char-fade` (300ms), the fade-in's
 * own budget, so text scrolling and text appearing share a rhythm.
 */
export const SCROLL_GLIDE_MS = 300;

/**
 * A cubic ease-out standing in for the fade-in's curve,
 * `cubic-bezier(0.16, 1, 0.3, 1)`. Never above 1, so the page never
 * overshoots the station.
 */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Whether the writer asked the operating system for less motion, read at the
 * moment of each scripted move.
 */
export function motionIsStill(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

let rafId = 0;

/**
 * Animate the surface to `targetTop`, or snap there under reduced motion.
 * Returns whether an animation started; the station sizes its quiet window
 * from it.
 *
 * The browser clamps `scrollTop` to its own range, so the helper does not,
 * and the start is read live, so an interruption retargets rather than
 * jumps.
 */
export function glideScrollTo(
  surface: HTMLElement,
  targetTop: number,
  duration: number = SCROLL_GLIDE_MS,
): boolean {
  if (motionIsStill() || duration <= 0) {
    surface.scrollTop = targetTop;
    return false;
  }

  const start = surface.scrollTop;
  const delta = targetTop - start;
  if (delta === 0) return false;

  if (rafId) cancelAnimationFrame(rafId);
  const t0 = performance.now();

  const frame = (now: number): void => {
    const p = Math.min((now - t0) / duration, 1);
    if (p >= 1) {
      // Settle on the exact target, not `start + delta * 1`: the two can
      // differ in the last ulp, and a page that lands a hair short would
      // report itself off-station for the rest of the session.
      surface.scrollTop = targetTop;
      rafId = 0;
      return;
    }
    surface.scrollTop = start + delta * easeOut(p);
    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);
  return true;
}

/**
 * Whether a glide is in flight. A test cannot infer this by polling
 * `scrollTop`: Chromium rounds it to integers and the ease-out's tail moves
 * sub-pixel per frame, so two equal reads can still be short of the end.
 */
export function scrollGlideActive(): boolean {
  return rafId !== 0;
}

// Published for the real-browser specs in development only, outside the
// station probe because specs without a probe need it too. A function rather
// than a value, so the answer is the caller's instant.
//
// `typeof window` as well as the DEV branch: the registry's test imports this
// module in the node environment, where a bare `window` fails the suite.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __gliding?: () => boolean }).__gliding =
    scrollGlideActive;
}

/** Stop an in-flight glide, on the view's unmount. */
export function cancelScrollGlide(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}
