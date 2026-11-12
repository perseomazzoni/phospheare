// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The panel's collapse handle sits on the panel's right edge, half in and half
// out: a control that moves a boundary sits on the boundary, and the header
// need not be drawn in the rail for it.
//
// The panel's right edge is at 264 (`--panel-left` 16 + `--panel-w` 248) and
// the writing surface's padding starts the prose at 288, leaving a 24px
// gutter to straddle. These rows pin that arithmetic: a handle two pixels
// wider on either side would sit on the writer's first character.

import { expect, test, type Page } from "@playwright/test";
import { stableBox } from "./probe";

async function openSection(page: Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
}

/**
 * A CSS colour as `getComputedStyle` reports it. `--accent` is authored as hex
 * and a computed `background` reads back as `rgb(...)`, so the colour is
 * painted onto a throwaway element and read back through the browser's own
 * conversion rather than parsed in the test.
 */
async function toRgb(page: Page, color: string): Promise<string> {
  return await page.evaluate((value) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = value;
    document.body.append(probe);
    const out = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return out;
  }, color);
}

/** The panel's right edge, and where the prose is allowed to begin. */
async function edges(page: Page) {
  const panel = await page.locator(".doc-tree").boundingBox();
  const pad = await page
    .locator(".editor-surface")
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  if (!panel) throw new Error("no panel");
  return { border: panel.x + panel.width, prose: pad };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSection(page);
});

test("straddles the panel's edge, and clears the prose", async ({ page }) => {
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "0");
  const { border, prose } = await edges(page);
  const handle = await page.locator(".dt-collapse").boundingBox();
  if (!handle) throw new Error("no handle");

  // Centred on the border to within half a device pixel: it is placed with
  // `translateX(-50%)` off the custom properties the panel's width comes
  // from, so this asks whether the two agree.
  expect(Math.abs(handle.x + handle.width / 2 - border)).toBeLessThan(0.5);
  // Half of it is outside the panel, in the gutter, and none of it is over
  // where a character can be drawn.
  expect(handle.x + handle.width).toBeLessThan(prose);

  // It rides the top of that border, not its midpoint, which on a 736px edge
  // is far from everything else the writer uses. It sits inside the panel's
  // top corner, level with the header on the wide panel and at the head of
  // the rail.
  const panel = await page.locator(".doc-tree").boundingBox();
  if (!panel) throw new Error("no panel");
  expect(handle.y).toBeGreaterThanOrEqual(panel.y);
  expect(handle.y + handle.height).toBeLessThan(panel.y + 100);
});

test("rides the edge into the rail and back", async ({ page }) => {
  const wide = await page.locator(".dt-collapse").boundingBox();
  await page.getByRole("button", { name: "Narrow the panel" }).click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  // The width transition finishes before the edge is measured.
  await page
    .locator(".doc-tree")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(
        () => undefined,
      ),
    );

  const { border } = await edges(page);
  const rail = await page.locator(".dt-collapse").boundingBox();
  if (!wide || !rail) throw new Error("no handle");
  expect(Math.abs(rail.x + rail.width / 2 - border)).toBeLessThan(0.5);
  // It moved: the rail's edge is at 68, the wide one's at 264.
  expect(rail.x).toBeLessThan(wide.x - 150);

  // It is still the way back out, named for what it now does.
  await page.getByRole("button", { name: "Widen the panel" }).click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "0");
});

test("peeks at the writer's width, with the chevron on the peek's edge", async ({
  page,
}) => {
  // The peek is the panel folded and drawn wide under the hand: as wide as
  // the writer left it open, and still carrying the fold's chevron, turned
  // as on the rail, since a press pins it open.
  await page.getByRole("button", { name: "Narrow the panel" }).click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  const rail = await stableBox(page, ".doc-tree");
  await page.mouse.move(rail.x + rail.width / 2, 400);
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-peek", "1");

  const panel = await stableBox(page, ".doc-tree");
  const open = await page
    .locator(".editor-shell")
    .evaluate((el) => parseFloat(el.style.getPropertyValue("--panel-open-w")));
  expect(panel.width).toBe(open);
  const handle = await stableBox(page, ".dt-collapse");
  expect(
    Math.abs(handle.x + handle.width / 2 - (panel.x + panel.width)),
  ).toBeLessThan(0.5);
  // A quarter turn back: the matrix of `rotate(-90deg)` begins `0, -1`.
  const [a, b] = await page
    .locator(".dt-collapse")
    .evaluate((el) =>
      new DOMMatrix(getComputedStyle(el).transform).toFloat64Array(),
    );
  expect(a).toBeCloseTo(0, 6);
  expect(b).toBeCloseTo(-1, 6);
});

test("frees the whole header in the rail", async ({ page }) => {
  // Everything else in the head is hidden at 52px, so with the handle on the
  // edge the rail starts at its first Part.
  await page.getByRole("button", { name: "Narrow the panel" }).click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  await expect(page.locator(".dt-root")).toBeHidden();
  // The handle is not in the head to be hidden with it.
  await expect(page.locator(".dt-root .dt-collapse")).toHaveCount(0);
});

test("is quiet at rest and accented at the moment of use", async ({ page }) => {
  // A handle lit at rest is a permanent bright dot at the edge of the prose
  // while the writer works, against the editor's posture: the bar recedes,
  // folds collapse.
  const handle = page.locator(".dt-collapse");
  const glyph = page.locator(".dt-collapse svg");
  const phos = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim(),
  );

  const seat = (el: HTMLElement) => getComputedStyle(el).backgroundColor;
  const resting = await handle.evaluate(seat);
  expect(
    await glyph.evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
  ).toBeLessThan(1);

  await handle.hover();
  await expect
    .poll(async () =>
      glyph.evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
    )
    .toBe(1);

  // The seat fills with the accent rather than only recolouring its border: a
  // border change is a hint, a filled seat an answer. Compared against
  // `--accent` resolved from the theme, so any colour that merely differs from
  // the resting one does not pass.
  const lit = await handle.evaluate(seat);
  expect(lit).not.toBe(resting);
  expect(await toRgb(page, phos)).toBe(lit);
});

test("the handle lines up with the head's first row, not merely near the top", async ({
  page,
}) => {
  // A handle between two rows reads as a control that missed. It cannot be a
  // child of the row it lines up with, because the panel clips, so the offset
  // is a constant and this row makes drift in either rule fail. The row it
  // aims at is the spine; the project's name is in the titlebar's crumb.
  const handle = await page.locator(".dt-collapse").boundingBox();
  const title = await page.locator(".dt-spine").boundingBox();
  if (!handle || !title) throw new Error("no handle or no spine");
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(Math.abs(centre(handle) - centre(title))).toBeLessThan(1.5);
});

test("a second row's menu closes the first", async ({ page }) => {
  // `.dt-actions` stops the press so the row's drag gesture never starts under
  // the overflow button, so the open menu's dismissal listens in the capture
  // phase, where no descendant can swallow the press.
  //
  // `:visible`, because the demo opens with its Parts folded and `.dt-row`
  // also matches rows inside a collapsed Part, which no pointer can reach.
  //
  // The lower row first: the menu hangs below its trigger, so opening the top
  // row first would press through the menu rather than past it.
  const rows = page.locator(".dt-row:visible");
  await expect(rows.first()).toHaveText(/\S/);
  const dots = (row: ReturnType<typeof rows.first>) =>
    row.getByRole("button", { name: /^Actions for/ });

  await rows.last().hover();
  await dots(rows.last()).click();
  await expect(page.locator(".ui-menu")).toHaveCount(1);

  await rows.first().hover();
  await dots(rows.first()).click();
  await expect(page.locator(".ui-menu")).toHaveCount(1);
  // The menu that survives is the one just pressed.
  const label = (await dots(rows.first()).getAttribute("aria-label")) ?? "";
  await expect(page.locator(".ui-menu")).toHaveAttribute("aria-label", label);
});
