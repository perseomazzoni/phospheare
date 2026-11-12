// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import { FRAME_GEOMETRY } from "../theme/editor";

// ── Narrow ───────────────────────────────────────────────────────────────────
//
// One state, not several media queries. Below `NARROW_AT` the panel, measure
// and dock do not all fit, and everything that gives way there gives way
// together: the dock lies over the prose as a sheet, the save chip drops its
// label and the surface gets its right padding back. Separate media queries
// drift apart.
//
// The panel's fold on a narrow window is the writer's own state
// (`useWorkspaceLayout`), not part of this one. The rail is a different view,
// not the wide one squeezed, so React has to know which is drawn.

// ── The narrow width ─────────────────────────────────────────────────────────
//
// The numbers are the frame's (`FRAME_GEOMETRY`), the tokens `editor.css` is
// written with; `editorCss.test.ts` fails when they disagree.
export const PANEL_LEFT = FRAME_GEOMETRY.panelLeft; // --panel-left

/**
 * The structure panel's width when the writer has never set one: the
 * `--panel-w` token's value.
 *
 * `NARROW_AT` is computed against it, not the writer's width, because it asks
 * whether the shipped layout fits. A writer who drags the panel wider spends
 * their own surface without moving the plane where three columns stop
 * fitting.
 */
export const PANEL_W = FRAME_GEOMETRY.panelW; // --panel-w

/**
 * The panel's width when it is folded: the rail (`PanelRail`), which sits
 * far below the drag's floor rather than being its bottom.
 */
export const RAIL_PANEL_W = FRAME_GEOMETRY.railPanelW;

/**
 * How far the panel's edge can be dragged.
 *
 * The floor is not the rail's 52px; it is the width below which the tree's
 * indented names start wrapping. The ceiling is a product constant, wide
 * enough for the widest thing the panel holds.
 *
 * There is no window-aware ceiling. `.editor` sets `max-width`, not `width`,
 * so a measure with less room reflows rather than overflowing, and a writer
 * who narrows their own measure is one drag from undoing it.
 */
export const MIN_PANEL_W = 200;
export const MAX_PANEL_W = 600;

export function clampPanelWidth(width: number): number {
  // `Math.min` and `Math.max` propagate NaN in either order, so without this
  // check `--panel-w: NaNpx` is emitted and the panel collapses with nothing
  // failing. The parser (`asPixelWidth`) already refuses a non-finite width at
  // the file; this line holds the clamp on its own.
  //
  // Infinity is not caught: Home and End pass -Infinity and Infinity so the
  // clamp saturates them to the floor and the cap.
  if (Number.isNaN(width)) return PANEL_W;
  return Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, width));
}

/**
 * The narrowest window, in pixels, that still fits the panel and the measure
 * side by side: 1016.
 */
export const NARROW_AT = FRAME_GEOMETRY.narrowAt;

// Strictly narrower than the fitting width: at exactly 1016 the columns fit,
// so 1016 is wide. `max-width: 1015.98px` spells "less than" in a media query,
// and .02 is the smallest step that survives fractional device pixels.
const NARROW_QUERY = `(max-width: ${NARROW_AT - 0.02}px)`;

/**
 * Whether the window is too narrow for three columns.
 *
 * Below this the surface stops reserving room for the panel. `.doc-tree` is
 * `position: fixed`, an overlay, so a reserve in the surface's `padding-left`
 * only counts a column with no room; at 375px it leaves the prose 58px wide
 * and breaks words mid-character.
 */
export function useNarrow(): boolean {
  return usePlane(NARROW_QUERY);
}

// ── The phone plane ──────────────────────────────────────────────────────────
//
// The second of the SPA's two plane numbers. It is not derived from a layout:
// it must equal the width where the shell folds its own chrome to icon-only
// (`.app-find` in `webapp.css`), or a band of widths is a phone to the editor
// and a desktop to the CSS.
//
// Distinct from `narrow`, not a degree of it. Narrow means the three columns
// stopped fitting, so one lies over the others. Phone means there is one
// column and the chrome has nowhere to stand beside it, so it goes to the
// bottom edge. A 760px tablet is narrow and is not a phone.
export const PHONE_AT = 720;

const PHONE_QUERY = `(max-width: ${PHONE_AT}px)`;

/** Whether the window is a phone plane: one column, chrome at the bottom. */
export function usePhone(): boolean {
  return usePlane(PHONE_QUERY);
}

// ── The dock's window widths ─────────────────────────────────────────────────
//
// The rail's gutter is 18, not 24, and must match
// `.editor-shell[data-rail], [data-peek]` in `editor.css`;
// `editorCss.test.ts` fails when they disagree. The dock's reach and fit
// are `dockRoom`'s, against the frame's geometry.
export const RAIL_GUTTER = FRAME_GEOMETRY.railGutter;

/**
 * The live window width, for `dockRoom`, which depends on the writer's panel
 * width as well as the window, so no media query can answer it.
 */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  useEffect(() => {
    const onChange = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
  }, []);
  return width;
}

/**
 * One media query, as React state. Answers `false` where `matchMedia` is
 * missing, so a server render gets the wide layout.
 */
function usePlane(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const onChange = () => setOn(mq.matches);
    // Re-read on mount: the width can change between the first render and the
    // effect, and a listener only reports what happens next.
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return on;
}

function matches(query: string): boolean {
  return typeof matchMedia === "function" && matchMedia(query).matches;
}
