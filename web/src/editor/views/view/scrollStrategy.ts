// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The scroller port. The one difference between a scroll view and a
// typewriter view is where the caret is held, so every view hands its
// scrolling behaviour to the core through a `Scroller`.

import { glideScrollTo } from "../writing/scrollGlide";

/** A caret's viewport rect, reduced to what docking needs. */
export interface CaretPos {
  y: number;
  h: number;
}

/**
 * The scrollTop change that brings a caret above the command bar (or the
 * surface's top when no bar is mounted) or below the surface's bottom edge
 * back into view, or `0` when it already sits in view. The limits are in
 * viewport coordinates, like `pos`; `lineHeight` parks the revealed caret one
 * line off the edge.
 *
 * Callers snap rather than glide: a glide would keep the first keystroke
 * blind and lag the caret behind the page.
 */
export function revealDelta(
  pos: CaretPos,
  barBottom: number,
  lineHeight: number,
  surfaceBottom: number,
): number {
  if (pos.y < barBottom) return pos.y - (barBottom + lineHeight);
  if (pos.y > surfaceBottom) return pos.y - (surfaceBottom - lineHeight);
  return 0;
}

/**
 * `revealDelta` measured from the surface itself: the one measurement path,
 * so every caller agrees about what "hidden" means.
 */
export function revealCaretDelta(pos: CaretPos, surface: HTMLElement): number {
  const cr = surface.getBoundingClientRect();
  const bar = surface
    .closest(".editor-shell")
    ?.querySelector(".chrome .ui-bar");
  const barBottom = bar ? bar.getBoundingClientRect().bottom : cr.top;
  const editor = surface.querySelector<HTMLElement>(".editor");
  const computed = editor
    ? Number.parseFloat(getComputedStyle(editor).lineHeight)
    : Number.NaN;
  const lineHeight =
    Number.isFinite(computed) && computed > 0 ? computed : pos.h || 1;
  return revealDelta(pos, barBottom, lineHeight, cr.bottom);
}

export interface Scroller {
  /**
   * Move the surface so the caret sits where this strategy holds it: the
   * centre for the typewriter, inside the quiet band for keep-in-band. Called
   * after a document change settles. Returns whether the writing line moved:
   * that alone pulses the type guide.
   */
  hold(pos: CaretPos, surface: HTMLElement): boolean;
  /**
   * The caret moved without the document changing: a click, an arrow key, a
   * selection collapse. `null` means there is no caret rect to hold: a
   * non-collapsed selection, which the typewriter answers by releasing the
   * station and everyone else by doing nothing.
   */
  onCaretMove(pos: CaretPos | null, surface: HTMLElement): boolean;
  /**
   * The lines moved with no writer input and no box resized: a web font
   * landed late. Holds the line only where this strategy holds it right now,
   * never one the writer has scrolled away from. Returns whether it moved.
   */
  reflow(pos: CaretPos, surface: HTMLElement): boolean;
  /** A scroll event on the surface; only the typewriter listens. */
  noteScroll(): void;
  /** The writer scrolled with the wheel or a touch drag; likewise. */
  noteWheel(): void;
  /**
   * What a wheel notch means: `'free'` lets the page run, `'ratchet'` steps
   * one visual line per notch. Asked before the native scroll can happen, so
   * the core knows whether to prevent it.
   */
  wheelPolicy(): "free" | "ratchet";
}

/**
 * The keep-in-band behaviour: hold the caret between two padding bands and
 * move only when it crosses one. Stateless, so one shared instance serves
 * every scroll view.
 */
export const keepInView: Scroller = {
  hold(pos: CaretPos, surface: HTMLElement): boolean {
    const cr = surface.getBoundingClientRect();
    const padT = 120; // clear the floating toolbar
    const padB = 80;
    const caretBottom = pos.y + pos.h;
    const caretTop = pos.y;

    if (caretBottom > cr.bottom - padB) {
      glideScrollTo(
        surface,
        surface.scrollTop + caretBottom - cr.bottom + padB,
      );
      return true;
    }
    if (caretTop < cr.top + padT) {
      glideScrollTo(surface, surface.scrollTop - (cr.top + padT - caretTop));
      return true;
    }
    return false;
  },
  // Only a caret that moved while hidden is brought back. The core skips
  // this while the pointer is down, so a drag never jumps the page.
  onCaretMove(pos: CaretPos | null, surface: HTMLElement): boolean {
    if (!pos) return false;
    const delta = revealCaretDelta(pos, surface);
    if (delta === 0) return false;
    surface.scrollTop += delta;
    return true;
  },
  // Keep-in-band holds nothing in place between moves, so a reflow owes no
  // move, and the band check would pull back a page the writer scrolled.
  reflow(): boolean {
    return false;
  },
  noteScroll(): void {},
  noteWheel(): void {},
  wheelPolicy(): "free" {
    return "free";
  },
};
