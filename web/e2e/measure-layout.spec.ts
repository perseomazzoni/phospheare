// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Where the prose stands on the wide plane, across every combination of
// window width, panel open or folded, dock open or closed, and comments shown
// or put away. Three reasons meet in one CSS `--dock-shift`: the open dock,
// a card column for the margin's comments, and centring the prose with that
// column as one block. A change for one case can move another.
//
// The rows check what the writer must always have, read off the page as
// drawn, and never recompute the shift: no two of the panel, the prose, the
// dock and the margin's comments overlap except where the CSS lets the dock
// run over the prose, every control among them answers a press at its
// centre, and each keeps its clearance. A few combinations also carry their
// positions as literal numbers, taken from the page once and checked by
// hand, so a change that keeps every invariant but moves the prose still
// fails.
//
// The demo book needs no account; its margin lives in memory.

import { expect, test, type Page } from "@playwright/test";
import { commentOn, pressCommentControl } from "./comments";
import { settleTransitions } from "./probe";

// ── Clearances ───────────────────────────────────────────────────────────────

/**
 * Between the panel's edge and the prose: `--panel-gutter`. The measure never
 * passes under the panel, and where the room runs short it stands flush
 * after the gutter rather than closer.
 */
const PANEL_GUTTER = 40;
/**
 * Between a card and the prose, and between a card and the margin's far
 * edge: `INSET` in `comments/presentation/Margin.tsx`, a card's inset on
 * both sides.
 */
const CARD_INSET = 24;
/**
 * Kept clear at the margin's far edge besides the inset: `SCROLLBAR` in
 * `Margin.tsx`, the room the margin leaves for the surface's scrollbar.
 */
const SCROLLBAR = 16;
/** Rounding between layout and `getBoundingClientRect`. */
const PX = 1;

// ── What the page draws ──────────────────────────────────────────────────────

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Control {
  name: string;
  box: Box;
  /** Whether `elementFromPoint` at the centre lands on the control. */
  hit: boolean;
}

interface Drawn {
  vw: number;
  vh: number;
  panel: Box;
  prose: Box;
  /** The open dock, or `null` while it is closed. */
  dock: Box | null;
  /** The shell's `data-dock-over`: the CSS let the dock run over the prose. */
  dockOver: boolean;
  surface: Box;
  cards: Box[];
  markers: Box[];
  controls: Control[];
  mode: string | null;
}

function measure(page: Page): Promise<Drawn> {
  return page.evaluate(() => {
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const one = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) throw new Error(`${selector} is not on the page`);
      return el;
    };
    const control = (name: string, el: Element) => {
      const box = boxOf(el);
      const hit = document.elementFromPoint(
        (box.left + box.right) / 2,
        (box.top + box.bottom) / 2,
      );
      return { name, box, hit: !!hit && el.contains(hit) };
    };

    const shell = one(".editor-shell");
    const dockOpen = shell.getAttribute("data-dock") === "1";
    const cards = [...document.querySelectorAll(".cm-card")];
    const markers = [...document.querySelectorAll(".cm-marker")];
    const controls = [
      control("the panel's fold handle", one(".dt-collapse")),
      ...(dockOpen ? [control("the dock's close", one(".dock-close"))] : []),
      ...cards.map((el, i) => control(`comment card ${i + 1}`, el)),
      ...markers.map((el, i) => control(`comment marker ${i + 1}`, el)),
    ];
    // The prose's first line, where a writer clicks to start typing.
    const first = boxOf(one(".editor p"));
    const atProse = document.elementFromPoint(
      first.left + 8,
      (first.top + first.bottom) / 2,
    );
    controls.push({
      name: "the prose's first line",
      box: { ...first, right: first.left + 16 },
      hit: !!atProse && one(".editor").contains(atProse),
    });

    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      panel: boxOf(one(".doc-tree")),
      prose: boxOf(one(".editor")),
      dock: dockOpen ? boxOf(one(".ed-dock")) : null,
      dockOver: shell.getAttribute("data-dock-over") === "1",
      surface: boxOf(one(".editor-surface")),
      cards: cards.map(boxOf),
      markers: markers.map(boxOf),
      controls,
      mode:
        document.querySelector(".cm-layer")?.getAttribute("data-mode") ?? null,
    };
  });
}

/** Whether two boxes share any area, rounding forgiven. */
function overlap(a: Box, b: Box): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > PX &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > PX
  );
}

/** The rules every combination keeps, comments shown or put away. */
function expectInvariants(d: Drawn, label: string) {
  // The measure never passes under the panel: the gutter stands between.
  expect(d.prose.left, `${label}: prose against the panel`).toBeGreaterThan(
    d.panel.right + PANEL_GUTTER - PX,
  );

  if (d.dock) {
    if (d.dockOver) {
      // The dock may run over the prose's tail only when the measure has
      // nowhere further left to go: flush after the panel's gutter.
      expect(
        Math.abs(d.prose.left - d.panel.right - PANEL_GUTTER),
        `${label}: the dock covers prose that could have moved left`,
      ).toBeLessThan(PX);
    } else {
      expect(
        overlap(d.prose, d.dock),
        `${label}: the dock covers the prose without saying so`,
      ).toBe(false);
    }
  }

  // The margin's far edge: the dock's left side, or the surface's own edge.
  const edge = d.dock
    ? Math.min(d.dock.left, d.surface.right)
    : d.surface.right;
  for (const card of d.cards) {
    expect(
      card.left - d.prose.right,
      `${label}: card against the prose`,
    ).toBeGreaterThan(CARD_INSET - PX);
    expect(card.right, `${label}: card against the margin's edge`).toBeLessThan(
      edge - CARD_INSET - SCROLLBAR + PX,
    );
    expect(overlap(card, d.panel), `${label}: card under the panel`).toBe(
      false,
    );
  }
  for (const marker of d.markers) {
    expect(overlap(marker, d.panel), `${label}: marker under the panel`).toBe(
      false,
    );
    if (d.dock)
      expect(overlap(marker, d.dock), `${label}: marker under the dock`).toBe(
        false,
      );
  }

  for (const c of d.controls) {
    expect(
      c.box.left >= -PX &&
        c.box.right <= d.vw + PX &&
        c.box.top >= -PX &&
        c.box.bottom <= d.vh + PX,
      `${label}: ${c.name} is outside the window`,
    ).toBe(true);
    expect(c.hit, `${label}: ${c.name} is covered`).toBe(true);
  }
}

// ── Positions taken by hand ──────────────────────────────────────────────────

interface Pinned {
  /** The prose's left edge with the comments shown, then put away. */
  shown: number;
  hidden: number;
  /** The first card's left edge, when the comments stand as cards. */
  card?: number;
}

/**
 * Read off the page at a window 900 high, demo book, one comment on "Tiny
 * sparks". Each was checked against the layout's description in `editor.css`
 * (the `--dock-shift` block):
 * - 1900, panel open, dock closed: a 680 measure centred in the room after
 *   the panel (8 + 248 + 40 to 1860) would start at 738; the prose and the
 *   card column (24 + 300) centred as one block start 162 further left, at
 *   576, and the card stands its inset past the prose's 1256.
 * - 1440, panel folded, dock open: the card column and the dock (340 + 8)
 *   leave no room to centre, so the prose goes flush after the folded panel
 *   (8 + 52 + 40 = 100), and the card, 24 past it, ends 40 before the dock.
 *   Put away, the prose centres between the panel's edge (60) and the dock's
 *   (1092): its middle at 576, its left at 236.
 * - 1200, panel open, dock open: too narrow for cards; the prose is flush
 *   after the panel (8 + 248 + 40 = 296) and the dock runs over its tail.
 */
const PINNED: Record<string, Pinned> = {
  "1900 open closed": { shown: 576, hidden: 738, card: 1280 },
  "1440 folded open": { shown: 100, hidden: 236, card: 804 },
  "1200 open open": { shown: 296, hidden: 296 },
};

/**
 * The margin's form in each combination, read off the page: cards wherever
 * the room after the measure, the dock's cover and the scrollbar keeps
 * `MARGIN_MIN_W` (220), markers elsewhere.
 */
const MODES: Record<string, "cards" | "markers"> = {
  "1900 open closed": "cards",
  "1900 open open": "cards",
  "1900 folded closed": "cards",
  "1900 folded open": "cards",
  "1440 open closed": "cards",
  "1440 open open": "markers",
  "1440 folded closed": "cards",
  "1440 folded open": "cards",
  "1200 open closed": "markers",
  "1200 open open": "markers",
  "1200 folded closed": "cards",
  "1200 folded open": "markers",
};

async function open(page: Page, width: number, panel: "open" | "folded") {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  if (panel === "folded") await page.locator(".dt-collapse").click();
  await commentOn(page, "Tiny sparks", "Does this earn its place?");
}

/**
 * Waits until the dock and the panel have stopped moving and the margin has
 * measured them. The margin measures again on each `transitionend`, a frame
 * later, and shows its markers while the dock slides in, so a read before
 * then sees a passing state.
 */
async function settle(page: Page) {
  await settleTransitions(page);
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

for (const width of [1900, 1440, 1200])
  for (const panel of ["open", "folded"] as const)
    for (const dock of [false, true])
      test(`at ${width}px, the panel ${panel}, the dock ${dock ? "open" : "closed"}: the measure keeps its rule`, async ({
        page,
      }) => {
        const key = `${width} ${panel} ${dock ? "open" : "closed"}`;
        await open(page, width, panel);
        if (dock)
          await page
            .locator(".bar-stack")
            .getByRole("button", { name: "Snapshots" })
            .click();
        await settle(page);

        // Comments shown.
        const shown = await measure(page);
        expect(shown.mode).toBe(MODES[key]);
        expect(shown.cards.length + shown.markers.length).toBeGreaterThan(0);
        expectInvariants(shown, "comments shown");

        // Comments put away.
        await pressCommentControl(page, "Comments");
        await expect(page.locator(".cm-layer")).toHaveCount(0);
        await settle(page);
        const hidden = await measure(page);
        expectInvariants(hidden, "comments put away");

        // Dots ask for no room: the same place either way.
        if (shown.mode === "markers")
          expect(Math.abs(hidden.prose.left - shown.prose.left)).toBeLessThan(
            PX,
          );

        const pinned = PINNED[key];
        if (pinned) {
          expect(shown.prose.left).toBeCloseTo(pinned.shown, 0);
          expect(hidden.prose.left).toBeCloseTo(pinned.hidden, 0);
          if (pinned.card !== undefined)
            expect(shown.cards[0]?.left).toBeCloseTo(pinned.card, 0);
        }
      });
