// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The station: the fixed line of the view where the typewriter keeps the
// caret. Typewriter scrolling holds the writing line at the vertical middle
// of the scroller (`.editor-surface`), never the window. The middle is fixed
// at 0.5, not a setting.
//
// Apart from the dock's glide, the module reads layout only through the
// rects and timestamps it is handed, so it can be tested without a layout
// engine.

import { glideScrollTo } from "./scrollGlide";

/** A caret's viewport rect, reduced to what docking needs. */
export interface CaretPos {
  y: number;
  h: number;
}

/** A scroller's viewport rect, reduced to what docking needs. */
export interface StationBox {
  top: number;
  height: number;
}

/**
 * The chrome floating over the surface. The station sits at the centre of
 * the visible page, offset from the surface's midpoint by half the
 * difference between what is hidden above and below; on the phone plane the
 * offset is negative and the station rises.
 */
export interface StationChrome {
  /** Pixels of surface hidden behind chrome along the top edge. */
  top: number;
  /** Pixels hidden along the bottom edge. */
  bottom: number;
}

/** Titlebar 40 + command bar 46, all of it above the prose. */
export const DESKTOP_CHROME: StationChrome = { top: 86, bottom: 0 };

/**
 * The phone plane: nothing above, the command bar below. 68 is the bar's
 * height (`--bar-act` 44, plus 5px of padding and a 1px border on each edge)
 * plus the 12 the row holds it off the bottom edge.
 *
 * A mouse-driven narrow window gets the 34px bar, so this is 5px off there;
 * `chromeFromSpans` measures when there is a surface. The safe-area inset is
 * not counted: nothing is drawn in that strip.
 */
export const PHONE_CHROME: StationChrome = { top: 0, bottom: 68 };

/** A vertical span: all the chrome arithmetic wants of a rect. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * The chrome the page is using, measured from the boxes it is drawn in,
 * because its size varies by profile and the constants above cannot follow.
 *
 * Each piece counts against its nearest edge, the rule `stationProbe.ts`'s
 * `visibleCentre` also applies; the two are not wired together, so check
 * both when touching either. An edge takes the furthest extent rather than
 * the sum, because the pieces are drawn flush. A piece with no height (an
 * unmounted bar) is skipped.
 */
export function chromeFromSpans(
  surface: Span,
  viewportBottom: number,
  pieces: readonly (Span | null | undefined)[],
): StationChrome {
  // The surface can reach past the bottom of the window; what is below the
  // fold is not hidden by chrome, it is simply not on screen yet.
  const floor = Math.min(surface.bottom, viewportBottom);
  // The same clamp decides which edge a piece is nearest: a surface taller
  // than the window would otherwise put its midpoint below the fold and count
  // every piece as being in the top half.
  const middle = surface.top + (floor - surface.top) / 2;
  let top = 0;
  let bottom = 0;
  for (const piece of pieces) {
    if (!piece || piece.bottom <= piece.top) continue;
    if ((piece.top + piece.bottom) / 2 < middle) {
      top = Math.max(top, piece.bottom - surface.top);
    } else {
      bottom = Math.max(bottom, floor - piece.top);
    }
  }
  return {
    top: Math.max(0, Math.round(top)),
    bottom: Math.max(0, Math.round(bottom)),
  };
}

/**
 * The same chrome with the on-screen keyboard added to its bottom edge. The
 * keyboard does not resize the page (both engines keep the layout viewport
 * at full height), so nothing else in the geometry notices it.
 */
export function withKeyboard(
  chrome: StationChrome,
  keyboard: number,
): StationChrome {
  return keyboard > 0
    ? { ...chrome, bottom: chrome.bottom + keyboard }
    : chrome;
}

/**
 * Half the difference between the chrome above and the chrome below: the
 * distance the station sits from the box's own midpoint.
 */
export function stationOffset(chrome: StationChrome): number {
  return (chrome.top - chrome.bottom) / 2;
}

/**
 * The desktop plane's station offset, exported because `station.test.ts`
 * pins it; production code reaches the same number through `stationOffset`.
 */
export const STATION_CHROME_HALF = stationOffset(DESKTOP_CHROME);

export function stationY(
  box: StationBox,
  chrome: StationChrome = DESKTOP_CHROME,
): number {
  return box.top + box.height * 0.5 + stationOffset(chrome);
}

/**
 * Signed distance from the caret's centre to the station. Not its top, which
 * is the font box and sits above the glyphs under `--leading: 1.92`.
 */
export function dockDelta(
  pos: CaretPos,
  box: StationBox,
  chrome: StationChrome = DESKTOP_CHROME,
): number {
  const centre = pos.y + pos.h / 2;
  return centre - stationY(box, chrome);
}

/** Sub-pixel deltas are already docked; chasing them would just jitter. */
const DOCK_EPSILON = 1;

export function isAtStation(delta: number): boolean {
  return Math.abs(delta) < DOCK_EPSILON;
}

/**
 * The paper feed: half the scroller's height on each side, so the first and
 * last lines can reach the station. Sized from the scroller's own height,
 * never `vh`, because the editor does not own the whole window.
 */
export function feedDepths(scrollerHeight: number): {
  top: number;
  bottom: number;
} {
  const depth = scrollerHeight * 0.5;
  return { top: depth, bottom: depth };
}

const QUIET_INSTANT_MS = 90;
// The quiet window must outlast the glide it belongs to: every frame of the
// animation fires a scroll event, and one that lands after the window closed
// would read as the writer reaching for the wheel mid-dock. A frame's slack
// past the glide's 300ms (`SCROLL_GLIDE_MS`).
const QUIET_GLIDE_MS = 340;

/**
 * Distinguishes a scroll the station caused from one the writer caused, by
 * deadline.
 *
 * `extend` is a max, never an assignment: back-to-back docks must never
 * shorten an in-flight quiet window, or the tail of the station's last scroll
 * reads as the writer reaching for the wheel.
 */
export class QuietWindow {
  private until = 0;

  extend(now: number, ms: number = QUIET_INSTANT_MS): void {
    this.until = Math.max(this.until, now + ms);
  }

  isQuiet(now: number): boolean {
    return now < this.until;
  }
}

export type StationState = "docked" | "released" | "offStation";

/**
 * The three states (docked, released, off-station) and the transitions
 * between them. One instance for the mounted editor, the module-level
 * `station` below, on the one-editor-at-a-time assumption `caret.ts`'s
 * `measuringCaret` also makes.
 */
export class StationMachine {
  state: StationState = "docked";
  /**
   * The chrome on this editor's plane. State rather than an argument because
   * the docking caller, `typewriterScroller.ts`, cannot see a React hook;
   * `EditorCore` sets it.
   */
  chrome: StationChrome = DESKTOP_CHROME;
  private quiet = new QuietWindow();

  /**
   * Move the scroller so the caret's centre sits at the station. The move is
   * a glide (`scrollGlide.ts`), and the quiet window is extended to cover it.
   * Reduced motion snaps it instead.
   *
   * Returns whether it scrolled: the writing line changing is what triggers
   * the type guide's strike pulse.
   */
  dock(
    container: HTMLElement,
    pos: CaretPos,
    now = performance.now(),
  ): boolean {
    const box = container.getBoundingClientRect();
    const delta = dockDelta(pos, box, this.chrome);
    const moved = !isAtStation(delta);
    if (moved) {
      const animated = glideScrollTo(container, container.scrollTop + delta);
      this.quiet.extend(now, animated ? QUIET_GLIDE_MS : QUIET_INSTANT_MS);
    }
    this.state = "docked";
    return moved;
  }

  /** A non-collapsed selection: nothing is written, so nothing is held. */
  release(): void {
    this.state = "released";
  }

  /**
   * A plain `scroll` event on the surface, fired by both the writer's
   * scrollbar drag and the station's own `dock`. Only the quiet window tells
   * them apart.
   */
  noteScroll(now = performance.now()): void {
    if (this.state === "released") return;
    if (this.quiet.isQuiet(now)) return;
    this.state = "offStation";
  }

  /**
   * Wheel or touch input: unambiguous, since `container.scrollTo` never fires
   * these. No quiet window is needed: the writer's hand is on the device.
   */
  noteWheel(): void {
    if (this.state === "released") return;
    this.state = "offStation";
  }
}

export const station = new StationMachine();
