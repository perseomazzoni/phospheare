// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The structure panel's treegrid, in the document ─────────────────────────
//
// Owns focus inside the grid. Every row and every control in it is out of
// the tab order but one, the grid's single tab stop, so Tab enters the panel
// once and the next Tab leaves it. The stop follows focus, and a Section
// opened while focus is elsewhere. When the element holding it goes (a row
// folded away, a field committed, a landing gone with its move), it falls
// back to the current row, then to the first. A text field keeps its own
// place in the tab order while it is being typed in.
//
// The keys are `treegrid.ts`'s; this hook reads the rows the document shows
// and carries out the step. The three controls a key presses carry
// `data-grid`: `toggle` (the chevron), `open` (the title) and `menu` (the
// actions).
//
// The hook writes `tabindex` imperatively, and no row or control in the grid
// sets it in its markup, so React never writes it back.

import { useEffect, useRef, type RefObject } from "react";
import { step, type GridRow, type Spot, type Step } from "./treegrid";

const ROW = '[role="row"]';
const CONTROL = "button, input, select, textarea, a[href]";
const FIELD = "input, textarea, select, [contenteditable]";
/** A folded Part's children: in the document, but not on screen. */
export const FOLDED = ".dt-children:not(.open)";

/** The rows on screen, in reading order. */
function visibleRows(grid: HTMLElement): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>(ROW)].filter(
    (row) => !row.closest(FOLDED),
  );
}

/** A row's own controls, in reading order. */
function controlsOf(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>(CONTROL)].filter(
    (el) =>
      el.closest(ROW) === row &&
      !el.closest('[aria-hidden="true"]') &&
      !(el as HTMLButtonElement).disabled,
  );
}

/** A node's row takes focus itself; a row of controls alone does not. */
const focusable = (row: HTMLElement) => row.hasAttribute("data-row");

/** The Part row a row sits inside, by index in `rows`, or null. */
function parentOf(row: HTMLElement, rows: HTMLElement[]): number | null {
  const parent = row
    .closest(".dt-children")
    ?.parentElement?.querySelector<HTMLElement>(`:scope > ${ROW}`);
  if (!parent) return null;
  const index = rows.indexOf(parent);
  return index < 0 ? null : index;
}

function model(rows: HTMLElement[], controls: HTMLElement[][]): GridRow[] {
  return rows.map((row, i) => {
    const expanded = row.getAttribute("aria-expanded");
    return {
      focusable: focusable(row),
      expanded: expanded === null ? undefined : expanded === "true",
      parent: parentOf(row, rows),
      controls: controls[i].length,
    };
  });
}

/** Where focus lands for a stop nobody chose: the current row, else the first. */
function fallback(rows: HTMLElement[]): HTMLElement | null {
  const current = rows.find((row) => row.hasAttribute("aria-current"));
  if (current) return current;
  for (const row of rows) {
    if (focusable(row)) return row;
    const first = controlsOf(row)[0];
    if (first) return first;
  }
  return null;
}

/** Hands keyboard focus inside `grid` to the treegrid's rules. */
export function useTreegrid(grid: RefObject<HTMLElement | null>): void {
  const attached = useRef<{ el: HTMLElement; detach: () => void } | null>(null);

  // The grid mounts once the structure has loaded and goes when the panel
  // turns to another face, so the hook follows the element across renders.
  useEffect(() => {
    const el = grid.current;
    if (attached.current?.el === el) return;
    attached.current?.detach();
    attached.current = el ? { el, detach: attach(el) } : null;
  });

  useEffect(
    () => () => {
      attached.current?.detach();
      attached.current = null;
    },
    [],
  );
}

/** Wires one grid element; returns its undoing. */
function attach(grid: HTMLElement): () => void {
  let stop: HTMLElement | null = null;
  let current: HTMLElement | null = null;

  const place = (el: HTMLElement) => {
    if (stop && stop !== el && !stop.matches(FIELD)) stop.tabIndex = -1;
    if (!el.matches(FIELD)) el.tabIndex = 0;
    stop = el;
  };

  // The attribute, not the property: a row without one already reads -1,
  // and would not take focus.
  const out = (el: HTMLElement) => {
    if (el !== stop && el.getAttribute("tabindex") !== "-1") el.tabIndex = -1;
  };

  // Everything out of the tab order but the stop, and a stop that is still
  // on screen.
  const sync = () => {
    for (const row of grid.querySelectorAll<HTMLElement>(ROW)) {
      if (focusable(row)) out(row);
      for (const control of controlsOf(row))
        if (!control.matches(FIELD)) out(control);
    }
    const rows = visibleRows(grid);
    // A Section opened from elsewhere (the Desk, a search, the editor's own
    // links) takes the stop with it, so Tab arrives where the writer is.
    const now = rows.find((r) => r.hasAttribute("aria-current")) ?? null;
    if (now !== current) {
      current = now;
      if (now && !grid.contains(document.activeElement)) place(now);
    }
    const row = stop?.closest<HTMLElement>(ROW);
    if (!stop || !stop.isConnected || !row || !rows.includes(row)) {
      const next = fallback(rows);
      if (next) place(next);
      else stop = null;
    }
  };

  const onFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>(ROW);
    if (!row || !grid.contains(row)) return;
    if (target === row || controlsOf(row).includes(target)) place(target);
  };

  // `Shift+F10` and the context-menu key also raise the browser's own menu,
  // as a `contextmenu` event after the key, sent where focus is by then: in
  // the row's menu, outside the grid. The row's menu answers instead. A
  // pointer press ends the wait, so a right-click keeps the browser's menu.
  let menuKey = false;
  const onContextMenu = (e: MouseEvent) => {
    if (!menuKey) return;
    menuKey = false;
    e.preventDefault();
  };
  const onPointerDown = () => {
    menuKey = false;
  };

  const act = (s: Step, rows: HTMLElement[], controls: HTMLElement[][]) => {
    if (s.kind === "focus") {
      const to: Spot = s.to;
      const el =
        to.control === null ? rows[to.row] : controls[to.row][to.control];
      el.focus();
      return true;
    }
    const name =
      s.kind === "toggle" ? "toggle" : s.kind === "activate" ? "open" : "menu";
    const control = rows[s.row].querySelector<HTMLElement>(
      `[data-grid="${name}"]`,
    );
    if (!control) return false;
    if (s.kind === "menu") menuKey = true;
    control.click();
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    // Typing belongs to the field.
    if (target.closest(FIELD)) return;
    const row = target.closest<HTMLElement>(ROW);
    if (!row) return;
    const rows = visibleRows(grid);
    const at = rows.indexOf(row);
    if (at < 0) return;
    const controls = rows.map(controlsOf);
    const control = target === row ? null : controls[at].indexOf(target);
    if (control === -1) return;
    const s = step(
      model(rows, controls),
      { row: at, control },
      e.key,
      e.shiftKey,
    );
    if (s && act(s, rows, controls)) e.preventDefault();
  };

  const observer = new MutationObserver(sync);
  observer.observe(grid, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "aria-expanded", "aria-current"],
  });
  grid.addEventListener("focusin", onFocusIn);
  grid.addEventListener("keydown", onKeyDown);
  window.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  sync();

  return () => {
    observer.disconnect();
    grid.removeEventListener("focusin", onFocusIn);
    grid.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
  };
}
