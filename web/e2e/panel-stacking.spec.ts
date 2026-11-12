// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The panels over the command bar ──────────────────────────────────────────
//
// Nothing under the command bar can be clicked, so where the structure panel
// and the dock meet the bar, the panels paint above it: the writer closes a
// panel to reach the bar, never the reverse. At rest the ladder is the chrome
// (bar and drops) at 100, the structure panel at 105, the dock at 115.
//
// While the bar is engaged (`data-fold-engaged`: the pointer inside it, one of
// its controls focused, or one of its subpanels open) the chrome lifts to
// 130, above both panels, and drops back to 100 when the engagement ends.
// A panel never buries a bar the writer is not reaching for,
// and a bar the writer is working in is never buried by a panel. The ladder
// above is the rest state; every row that opens a drop measures the lifted
// one.
//
// jsdom measures every rect as zero and does not hit-test, so both halves are
// verified in a real browser: the computed z-order, and `elementFromPoint`
// where two surfaces meet.

import { expect, test, type Page } from "@playwright/test";
import { FRAME_GEOMETRY } from "../src/theme/domain/geometry";
import { settleTransitions, stableBox } from "./probe";
import { START_MS } from "./start";

/** Opens the demo book and a section, at the current viewport width. */
async function openSection(page: Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
}

const readZ = (page: Page, sel: string) =>
  page
    .locator(sel)
    .evaluate((el) => Number(getComputedStyle(el as HTMLElement).zIndex));

/** Where two rects overlap, or null if they do not. */
function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

/** Which surface the pointer would hit at a point. */
const hit = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return { tree: false, bar: false, dock: false };
      return {
        tree: !!el.closest(".doc-tree"),
        bar: !!el.closest(".bar-stack"),
        dock: !!el.closest(".ed-dock"),
      };
    },
    [x, y] as const,
  );

test("the panels stack over the command bar: chrome 100, structure 105, dock 115", async ({
  page,
}) => {
  // The dock opens at a wide width, where its toggle is reachable, then the
  // window shrinks so both panels and the bar are in play at once.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSection(page);
  // Any face opens the dock at the same width, and the demo has no spark.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  await page.setViewportSize({ width: 700, height: 800 });
  // The bar translates as the dock folds into the sheet, and the ladder is
  // read at rest, so the wait is for the bar to stop moving, not a fixed
  // sleep.
  await stableBox(page, ".bar-stack");
  // A bar being worked in, the pointer in it or a control in it focused,
  // lifts over the panels by design, so the click is let go of first.
  await page.mouse.move(350, 400);
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-fold-engaged",
    "0",
  );

  const chrome = await readZ(page, ".chrome");
  const tree = await readZ(page, ".doc-tree");
  const dock = await readZ(page, ".ed-dock");

  // The bar is above the prose and each panel above the bar, so a caret below
  // the chrome is below the panels too.
  expect(chrome).toBeGreaterThan(1);
  expect(tree).toBeGreaterThan(chrome);
  expect(dock).toBeGreaterThan(tree);
});

/** Where the room for the measure starts: the surface's left padding, the
 * panel's reserve (edge, width and gutter) read live. */
const roomLeft = (page: Page) =>
  page
    .locator(".editor-surface")
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));

const centre = (box: { x: number; width: number }) => box.x + box.width / 2;

/** Moves the pointer off the bar and waits for the bar to come home. A click
 * on the bar leaves the pointer in it, and an engaged bar is pinned where it
 * stood when the writer reached for it, before the dock opened, with
 * the chrome lifted to 130. The pin outlives the engagement by the folds'
 * collapse, so both are awaited. The default point is over the measure's left
 * half at every width here, clear of the bar and the dock. */
async function restPointer(page: Page, x = 420, y = 600) {
  await page.mouse.move(x, y);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-fold-engaged",
    "0",
  );
  await expect(page.locator(".bar-stack")).not.toHaveAttribute(
    "data-pinned",
    "1",
  );
}

test("the measure moves into the free room only as far as the panel's gutter", async ({
  page,
}) => {
  // At 1100 the panel, the measure and the dock do not fit. The dock's shift
  // is bounded by the slack, so the measure lands flush after the panel's
  // gutter: never under the panel, which paints over prose and steals its
  // clicks, and never centred on the window with free room
  // unused to its left. The bar keeps the measure's centre.
  await page.setViewportSize({ width: 1100, height: 800 });
  await openSection(page);
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "0");
  // Any face opens the dock at the same width, and the demo has no spark.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  await restPointer(page);

  const bar = await stableBox(page, ".bar-stack");
  const editor = await stableBox(page, ".editor");
  const tree = await stableBox(page, ".doc-tree");
  expect(Math.abs(editor.x - (await roomLeft(page)))).toBeLessThanOrEqual(1);
  expect(bar.x).toBeGreaterThanOrEqual(tree.x + tree.width);
  expect(Math.abs(centre(bar) - centre(editor))).toBeLessThanOrEqual(1);
});

test("with the panel folded the measure centres in the room the rail leaves", async ({
  page,
}) => {
  // The shift reads the live `--panel-w`: a folded panel counted at its open
  // width makes a room of over 800px read as cramped and leaves the prose
  // under the dock.
  await page.setViewportSize({ width: 1300, height: 800 });
  await openSection(page);
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  await page.locator(".dt-collapse").click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  await settleTransitions(page);

  const editor = await stableBox(page, ".editor");
  const dock = await stableBox(page, ".ed-dock");
  const rail = await stableBox(page, ".doc-tree");
  // The measure centres between the rail's edge and the dock's: the room
  // starts the panel's gutter past the rail's edge. `dockRoom` caps the dock
  // and places its detent with the rail's gutter, so the room must start
  // there too.
  const left = rail.x + rail.width;
  expect((await roomLeft(page)) - left).toBe(FRAME_GEOMETRY.railGutter);
  expect(Math.abs(centre(editor) - (left + dock.x) / 2)).toBeLessThanOrEqual(1);
  expect(editor.x + editor.width).toBeLessThanOrEqual(dock.x);

  // The peek is folded too: drawn wide over the prose, it keeps the rail's
  // reserve and its gutter.
  await page.mouse.move(rail.x + rail.width / 2, 400);
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-peek", "1");
  expect((await roomLeft(page)) - left).toBe(FRAME_GEOMETRY.railGutter);
});

test("the Desk moves for the dock like the measure does", async ({ page }) => {
  // `deskIn` fills `both` on `transform`, so a dock shift on `transform` loses
  // to its last keyframe; the shift is `translate`.
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto("/app/editor/demo");
  await expect(page.locator(".desk")).toBeVisible({ timeout: START_MS });
  await page.locator(".dt-dock-button").first().click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  const desk = await stableBox(page, ".desk");
  expect(Math.abs(desk.x - (await roomLeft(page)))).toBeLessThanOrEqual(1);
});

// ── Drags ────────────────────────────────────────────────────────────────────
//
// The prose's padding has no transition, so it follows a dragged edge frame
// for frame. Whatever else reads the dragged width must follow it the same
// way: an eased measure or bar trails the pointer and splits one movement in
// two. The ease is read while the drag holds, after a reading at rest shows
// there is one to drop.

/** The longest transition on an element, in seconds. */
const ease = (page: Page, sel: string) =>
  page
    .locator(sel)
    .evaluate((el) =>
      Math.max(
        ...getComputedStyle(el).transitionDuration.split(",").map(parseFloat),
      ),
    );

/** Holds a drag on a grip, runs `during`, and lets go. */
async function holdDrag(
  page: Page,
  grip: string,
  dx: number,
  during: () => Promise<void>,
) {
  const box = await stableBox(page, grip);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 4 });
  await during();
  await page.mouse.up();
}

test("the measure, the Desk and the bar follow a panel drag without easing", async ({
  page,
}) => {
  // With the dock open, the measure's and the Desk's shift read `--panel-w`
  // through the slack bound, and the bar's target reads it directly.
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/app/editor/demo");
  await expect(page.locator(".desk")).toBeVisible({ timeout: START_MS });
  await page.locator(".dt-dock-button").first().click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  const shell = page.locator(".editor-shell");
  const grip = '.doc-tree [role="separator"]';

  expect(await ease(page, ".desk")).toBeGreaterThan(0);
  await holdDrag(page, grip, 40, async () => {
    await expect(shell).toHaveAttribute("data-resizing-panel", "1");
    expect(await ease(page, ".desk")).toBe(0);
  });

  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await restPointer(page);
  for (const sel of [".editor", ".bar-stack"])
    expect(await ease(page, sel)).toBeGreaterThan(0);
  await holdDrag(page, grip, -40, async () => {
    await expect(shell).toHaveAttribute("data-resizing-panel", "1");
    for (const sel of [".editor", ".bar-stack"])
      expect(await ease(page, sel)).toBe(0);
  });
  await expect(shell).toHaveAttribute("data-resizing-panel", "0");
  for (const sel of [".editor", ".bar-stack"])
    expect(await ease(page, sel)).toBeGreaterThan(0);
});

test("the measure and the bar follow a dock drag without easing", async ({
  page,
}) => {
  // The bar's target and its right limit read `--dock-w`, as the measure's
  // shift does.
  await page.setViewportSize({ width: 1300, height: 800 });
  await openSection(page);
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  await restPointer(page);
  const shell = page.locator(".editor-shell");
  for (const sel of [".editor", ".bar-stack"])
    expect(await ease(page, sel)).toBeGreaterThan(0);
  await holdDrag(page, ".dock-resize", -60, async () => {
    await expect(shell).toHaveAttribute("data-resizing-dock", "1");
    for (const sel of [".editor", ".bar-stack"])
      expect(await ease(page, sel)).toBe(0);
  });
  await expect(shell).toHaveAttribute("data-resizing-dock", "0");
});

// ── The engaged lift ─────────────────────────────────────────────────────────
//
// The chrome has two z-indices, and the find drop exists only at the higher
// one. At rest `.chrome` is 100 and the panel at 105 wins. While
// the bar is engaged the chrome lifts to 130, above the panel and the dock,
// because the bar and its panels lie over the dock the moment a writer
// reaches for them. Blurring the find field closes the drop and returns the
// chrome to 100 in the same beat, so the drop is never on screen with the
// chrome at rest; a drop under the tree would hide the leading edge of the
// field Ctrl+F just opened. The row pins both states, including the lift
// ending, which keeps the panels above a bar at rest.
test("the bar's find drop paints above the panel while engaged, and the panel wins again when it is not", async ({
  page,
}) => {
  // The drop must meet the panel for there to be a point to hit-test. The bar
  // centres on the measure, which starts at or after the panel's gutter,
  // so a bar narrower than the measure never reaches the panel. The
  // bar is made wider than its room instead: the panel dragged to its ceiling
  // (End on the separator, 600) at 1200 leaves a room of 520 for a bar of
  // about 596px, and the clamp slides the bar left over the panel's edge by
  // the overflow.
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSection(page);
  await page.locator('.doc-tree [role="separator"]').focus();
  await page.keyboard.press("End");
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "style",
    /--panel-w: 600px/,
  );

  const shell = page.locator(".editor-shell");
  const chrome = page.locator(".chrome");
  // At rest, before anything is reached for, with the pointer over the prose,
  // which at this panel width starts past x = 640.
  await restPointer(page, 1000, 600);
  expect(await readZ(page, ".chrome")).toBe(100);

  await page.keyboard.press("Control+f");
  await expect(page.locator('.ed-drop[data-open="1"]')).toBeVisible();
  await settleTransitions(page);

  // The field has focus, so the bar is engaged and the whole chrome plane is
  // above the panel, read from the element rather than the attribute.
  await expect(shell).toHaveAttribute("data-fold-engaged", "1");
  expect(await readZ(page, ".chrome")).toBe(130);
  expect(await readZ(page, ".chrome")).toBeGreaterThan(
    await readZ(page, ".doc-tree"),
  );

  const drop = await stableBox(page, '.ed-drop[data-open="1"]');
  const tree = await stableBox(page, ".doc-tree");
  const meet = overlap(drop, tree);
  expect(meet).not.toBeNull();

  // The pointer agrees with the z-order: where the drop reaches the panel, the
  // drop is what a finger or a mouse lands on.
  const lifted = await hit(page, meet!.x + 6, meet!.y + 8);
  expect(lifted.bar).toBe(true);
  expect(lifted.tree).toBe(false);

  // Clicking into the prose blurs the field, and the drop and the engagement
  // end together.
  await page.locator(".editor p").first().click();
  await page.mouse.move(900, 750);
  await expect(shell).toHaveAttribute("data-fold-engaged", "0");
  await expect(page.locator('.ed-drop[data-open="1"]')).toHaveCount(0);
  await expect(chrome).toHaveCSS("z-index", "100");

  // The panel wins again at the same point, which is what makes the lift
  // safe.
  const rested = await hit(page, meet!.x + 6, meet!.y + 8);
  expect(rested.tree).toBe(true);
  expect(rested.bar).toBe(false);
});

test("a bar engaged by focus stays under a peeking panel", async ({ page }) => {
  // The peek floats the folded panel at the writer's width, so at 600 its
  // edge reaches under the bar. Ctrl+F engages the bar while the pointer is
  // still in the panel; lifted, the bar would cover the peek's corner and fold
  // the peek away from the pointer. The peek's drop and the engaged lift tie
  // on specificity, so their order alone decides.
  await page.setViewportSize({ width: 1200, height: 800 });
  await openSection(page);
  await page.locator('.doc-tree [role="separator"]').focus();
  await page.keyboard.press("End");
  await page.locator(".dt-collapse").click();
  const shell = page.locator(".editor-shell");
  await expect(shell).toHaveAttribute("data-rail", "1");
  await settleTransitions(page);
  const rail = await stableBox(page, ".doc-tree");
  await page.mouse.move(rail.x + rail.width / 2, 400);
  await expect(shell).toHaveAttribute("data-peek", "1");

  await page.keyboard.press("Control+f");
  await expect(page.locator('.ed-drop[data-open="1"]')).toBeVisible();
  await settleTransitions(page);
  await expect(shell).toHaveAttribute("data-fold-engaged", "1");
  await expect(shell).toHaveAttribute("data-peek", "1");
  expect(await readZ(page, ".chrome")).toBe(100);

  const meet = overlap(
    await stableBox(page, ".bar-stack"),
    await stableBox(page, ".doc-tree"),
  );
  expect(meet).not.toBeNull();
  const h = await hit(page, meet!.x + 6, meet!.y + 8);
  expect(h.tree).toBe(true);
  expect(h.bar).toBe(false);
});

test("the dock paints above the structure panel where the sheet meets it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSection(page);
  // Any face opens the dock at the same width, and the demo has no spark.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  // The sheet and the panel must meet. At 720 and below the
  // panel is a modal sheet that outranks a dock, and above it the default
  // dock (340) never reaches the panel's right edge (264). So the overlap is
  // forced as a writer would, by widening the dock: `--dock-w` is theirs to
  // drag, and `min(var(--dock-w), 86%)` lets a wide dock reach across a
  // narrow window.
  await page.setViewportSize({ width: 760, height: 800 });
  const grip = await stableBox(page, ".dock-resize");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(120, grip.y + grip.height / 2, { steps: 12 });
  await page.mouse.up();

  const sheet = await stableBox(page, ".ed-dock");
  const tree = await stableBox(page, ".doc-tree");
  const meet = overlap(sheet, tree);
  expect(meet).not.toBeNull();

  const h = await hit(page, meet!.x + 2, meet!.y + 2);
  expect(h.dock).toBe(true);
  expect(h.tree).toBe(false);
});

test("opening the dock leaves the structure panel expanded (the folds are independent)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSection(page);
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "0");

  // The dock and the panel expand and collapse independently. Any face opens
  // the dock at the same width, and the demo has no spark.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "0");
});
