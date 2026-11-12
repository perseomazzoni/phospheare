// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";

// The bar's overflow response: before the bar scrolls horizontally, the save
// chip drops its word ("Saved · 14:32", "Unsaved", the failed-save reason) and
// collapses to its coloured dot. The bar's position is one clamped `translate`
// in `editor.css`, so `tight` is the only mode to measure for.
//
// `tight` collapses the moment the bar overflows with its label showing, and
// returns only when restoring cannot overflow again. The hysteresis band is
// the label's real width, cached while visible; a guess at the longest word
// any locale ships either flickers at the edge or holds the dot too long.
//
// With the Dock open the save's word is seen only in the room between the
// panel and the Dock, and the chip folds when wider than that room. Where the
// leaves lie in a row and the Dock covers the measure, the bar has a row of
// its own over the Dock, and its cap is that row.
//
// The chip is measured only in a settled state. `saved`, its widest face,
// lasts `SAVED_SETTLE_MS`; folding for it would fold and unfold the chip and
// slide the centred bar twice per save. While `saving` or `saved` holds,
// `tight` keeps its value, and the change of state re-measures, since a
// folded chip keeps its width from `saved` to `clean`.
//
// `tight` leaves the autosave checkbox, a sibling in `.ed-save-wrap`, alone:
// collapsing the label must not take away its hover or fold-driven reveal.

export function useSaveTight(barRef: React.RefObject<HTMLDivElement | null>): {
  tight: boolean;
} {
  const [tight, setTight] = useState(false);
  const tightRef = useRef(false);
  const labelW = useRef(0);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const measure = () => {
      const state = bar.querySelector(".ed-save")?.getAttribute("data-state");
      if (state === "saving" || state === "saved") return;
      const label = bar.querySelector<HTMLElement>(".ed-save-label");
      // Cache the label's width while it is visible; collapsed it reports
      // zero, and the hysteresis needs what restoring it would cost.
      if (label && !tightRef.current && label.offsetWidth > 0) {
        labelW.current = label.offsetWidth;
      }
      // Collapse when the bar's own box overflows, the moment the scrollbar
      // would appear. Restoring needs the room the bar may grow to, not its
      // box: the box grows with its content, so with the label gone it reports
      // the shrunken content, not the cap. On a desk the cap is the
      // `.bar-stack` `max-width` in `editor.css`; where the stack declares
      // none (the phone, which spans the row, and a test, which loads no
      // stylesheet) it is the row's content box.
      const stack = bar.closest(".bar-stack");
      const cap = stack ? parseFloat(getComputedStyle(stack).maxWidth) : NaN;
      const row = bar.closest(".bar-row");
      const available = Number.isFinite(cap)
        ? cap
        : row
          ? row.clientWidth -
            parseFloat(getComputedStyle(row).paddingLeft || "0") -
            parseFloat(getComputedStyle(row).paddingRight || "0")
          : bar.clientWidth;
      const between = roomBetween(bar);
      const width = bar.scrollWidth - foldGrowth(bar);
      if (!tightRef.current && (width > bar.clientWidth || width > between)) {
        tightRef.current = true;
        setTight(true);
      } else if (
        tightRef.current &&
        width + labelW.current <= Math.min(available, between)
      ) {
        tightRef.current = false;
        setTight(false);
      }
    };

    // The bar's box is capped at the window, so content outgrowing the cap
    // does not resize it. The segments' boxes do change as folds, find and the
    // autosave reveal expand and collapse, so observing them re-measures at
    // the end of each width transition.
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    ro?.observe(bar);
    for (const child of bar.children) ro?.observe(child);
    window.addEventListener("resize", measure);
    // The Dock and the panel open, close and resize without resizing the bar,
    // so the shell's own moves re-measure: its attributes, the page's leaves,
    // and the end of each slide of the shell, the panel or the Dock. A drag
    // of the Dock or the panel writes `--dock-w` / `--panel-w` into the
    // shell's `style`, so `style` is watched; without it a chip folded by a
    // wide Dock stays folded after the Dock narrows.
    const shell = bar.closest<HTMLElement>(".editor-shell");
    const mo =
      shell && typeof MutationObserver !== "undefined"
        ? new MutationObserver(measure)
        : null;
    if (shell)
      mo?.observe(shell, {
        attributes: true,
        attributeFilter: [
          "data-dock",
          "data-dock-over",
          "data-rail",
          "data-resizing-dock",
          "data-resizing-panel",
          "style",
        ],
      });
    mo?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-leaves"],
    });
    // The chip's state, which a folded chip can change without changing its
    // width.
    const states =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(measure)
        : null;
    states?.observe(bar, {
      attributes: true,
      attributeFilter: ["data-state"],
      subtree: true,
    });
    const slid = (e: Event) => {
      if (
        e.target === shell ||
        (e.target instanceof Element && e.target.matches(".doc-tree, .ed-dock"))
      )
        measure();
    };
    shell?.addEventListener("transitionend", slid);
    measure();

    return () => {
      ro?.disconnect();
      mo?.disconnect();
      states?.disconnect();
      shell?.removeEventListener("transitionend", slid);
      window.removeEventListener("resize", measure);
    };
  }, [barRef]);

  return { tight };
}

/**
 * How much wider than at rest the bar's open folds make it. The chip is
 * measured against the resting bar: a fold opens under the pointer, and a
 * chip that folded as it grew would shift every control to its right out from
 * under that pointer. A fold rests as wide as its face, so its growth is its
 * box less its face, never below zero.
 */
function foldGrowth(bar: HTMLElement): number {
  let growth = 0;
  for (const fold of bar.querySelectorAll<HTMLElement>(".ed-fold")) {
    const face = fold.querySelector<HTMLElement>(".ed-fold-face");
    if (face) growth += Math.max(0, fold.offsetWidth - face.offsetWidth);
  }
  return growth;
}

/** The sheet's gap on each side of the room between the panel and the Dock. */
const GAP = 8;

/**
 * The room between the panel and the open Dock, where the bar's ends are
 * seen at rest; unbounded with the Dock shut, over a row of the bar's own,
 * or with no shell to measure.
 */
function roomBetween(bar: HTMLElement): number {
  const shell = bar.closest<HTMLElement>(".editor-shell");
  if (shell?.dataset.dock !== "1") return Infinity;
  if (
    document.documentElement.dataset.leaves === "row" &&
    shell.dataset.dockOver === "1" &&
    shell.dataset.narrow !== "1" &&
    shell.dataset.phone !== "1"
  )
    return Infinity;
  const panel = shell.querySelector(".doc-tree");
  const dock = shell.querySelector(".ed-dock");
  if (!panel || !dock) return Infinity;
  const room =
    dock.getBoundingClientRect().left -
    panel.getBoundingClientRect().right -
    2 * GAP;
  return room > 0 ? room : Infinity;
}
