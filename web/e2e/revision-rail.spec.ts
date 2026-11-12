// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The revision rail's preview contract. The rail is a margin hairline whose
// geometry jsdom cannot measure, and its wheel ownership lives in
// capture-phase listeners that jsdom cannot prove against the editor's own
// handlers. On the demo, with a two-step walk typed: Mod+Shift+H opens the
// rail; the wheel steps the preview one step per notch without scrolling the
// paper or touching the buffer, while the marker travels and the chip's
// Revert appears; the chip applies the walked state as one undoable edit;
// Esc, Cancel and typing close without changes; and the state attribute the
// CSS dims from is accurate.
//
// The merged view always contains both sides of the diff, so the buffer is
// compared byte for byte, never by substring. The notch is a line-mode event
// dispatched in-page, as a physical wheel sends it. Assertions are on DOM
// state and the timeline's text, never mid-animation pixels.

import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.locator(".editor p").first().click();
});

/** One physical wheel notch, dispatched in-page as line-mode (up is older). */
async function notch(page: Page, deltaY: number) {
  await page.evaluate((dy) => {
    const surface = document.querySelector(".editor-surface") as HTMLElement;
    surface.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: dy,
        deltaMode: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, deltaY);
}

/** The editor's full text, which the preview must not disturb. `textContent`,
 * not `innerText`: the merged view drops deleted tokens and reflows blocks,
 * and `innerText` follows that rendering. The buffer is proven by comparing
 * the view at Now, the plain doc, before the rail opens and after it
 * closes. */
const text = (page: Page) =>
  page.locator(".editor").evaluate((el) => el.textContent ?? "");

/**
 * Makes two edits that are two history steps, which every walk here needs.
 *
 * The merge rule (`shouldMerge` in `session.ts`) is positional: same
 * paragraph, `offset + 1`. It is not time-based; a caret move breaks it only
 * by changing the offset, which `End` in an empty paragraph does not.
 * The two steps are made in two paragraphs:
 * `key.para !== beforeCursor.para` is the merge break that does not depend
 * on the fixture's text.
 */
async function twoSteps(page: Page) {
  await page.keyboard.type("storm");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type("!");
}

test("the setup really is two steps — the premise every walk below rests on", async ({
  page,
}) => {
  // With one folded step the walks below click a disabled button and time
  // out, which reads like a hung editor. The premise fails here
  // first, in seconds.
  await twoSteps(page);
  await page.keyboard.press("Control+Shift+H");
  const older = page.getByRole("button", { name: "Step to an older revision" });
  await expect(older).toBeEnabled();
  await older.click();
  // Still enabled: there is a second step under the first.
  await expect(older).toBeEnabled();
  await older.click();
  await expect(older).toBeDisabled();
  await page.keyboard.press("Escape");
});

test("Mod+Shift+H opens the rail; Esc closes it without changes", async ({
  page,
}) => {
  await twoSteps(page);
  const before = await text(page);
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-timeline",
    "1",
  );
  await expect(page.locator(".rev-rail-head")).toBeVisible();
  // The history walk owns the screen: no command bar, and no caret while the
  // walk is up.
  await expect(page.locator(".ui-bar")).toHaveCount(0);
  await expect(page.locator(".fake-cursor")).toBeHidden();

  await notch(page, -3); // one step older: the preview walks, the buffer does not
  await expect(page.locator(".rev-chip-revert")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".editor-shell")).not.toHaveAttribute(
    "data-timeline",
  );
  await expect(page.locator(".rev-rail")).toHaveCount(0);
  // Nothing is reverted: the preview never touches the buffer.
  expect(await text(page)).toBe(before);
  // The bar returns with the editing surface.
  await expect(page.locator(".ui-bar")).toHaveCount(1);
});

test("touching the paper closes the rail without changes", async ({ page }) => {
  await twoSteps(page);
  const before = await text(page);
  await page.keyboard.press("Control+Shift+H");
  await notch(page, -3);

  await page.locator(".editor").click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".editor-shell")).not.toHaveAttribute(
    "data-timeline",
  );
  await expect(page.locator(".rev-rail")).toHaveCount(0);
  expect(await text(page)).toBe(before);
});

test("the wheel walks the preview, never the page and never the buffer", async ({
  page,
}) => {
  await twoSteps(page);
  const before = await text(page);
  await page.keyboard.press("Control+Shift+H");

  const surface = page.locator(".editor-surface");
  const head = page.locator(".rev-rail-head");
  const atNow = await head.evaluate((el) => el.style.top);
  await expect(page.locator(".rev-chip-revert")).toBeHidden();

  const scrollBefore = await surface.evaluate((el) => el.scrollTop);
  await notch(page, -3);
  await notch(page, -3);
  // Two notches, two steps back: the marker travels and the paper stays.
  await expect
    .poll(async () => (await head.evaluate((el) => el.style.top)) !== atNow)
    .toBe(true);
  await expect(page.locator(".rev-chip-revert")).toBeVisible();
  const scrollAfter = await surface.evaluate((el) => el.scrollTop);
  expect(scrollAfter).toBe(scrollBefore);
  // Off Now the marker is hollow.
  await expect(head).toHaveClass(/rev-rail-head-walking/);

  await notch(page, 3);
  await notch(page, 3);
  // Back at Now: the marker fills and the chip's Revert leaves with the walk.
  await expect(head).not.toHaveClass(/rev-rail-head-walking/);
  await expect(page.locator(".rev-chip-revert")).toBeHidden();
  // At Now the merged view is the plain doc; the walk changed nothing.
  expect(await text(page)).toBe(before);

  // Closing after the round trip leaves the buffer byte-identical.
  await page.keyboard.press("Escape");
  expect(await text(page)).toBe(before);
});

test("Revert to here applies the walked state as one undoable step", async ({
  page,
}) => {
  // The two steps `twoSteps` makes, inlined so `before` is read between them:
  // it is the state the walk must land on.
  await page.keyboard.type("storm");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  const before = await text(page);
  await page.keyboard.type("!");
  await page.keyboard.press("Control+Shift+H");
  await notch(page, -3); // preview the state before the "!"

  await page.getByRole("button", { name: "Revert to here" }).click();
  await expect(page.locator(".editor-shell")).not.toHaveAttribute(
    "data-timeline",
  );
  await expect(page.locator(".rev-rail")).toHaveCount(0);
  // The walked state is the file, byte-identical to before the "!".
  expect(await text(page)).toBe(before);

  // One undoable step: Ctrl+Z walks the whole restore back to the tip.
  await page.keyboard.press("Control+z");
  await expect(page.locator(".editor")).toContainText("!");
});

test("Cancel closes without changes", async ({ page }) => {
  await twoSteps(page);
  const before = await text(page);
  await page.keyboard.press("Control+Shift+H");
  await notch(page, -3);

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".editor-shell")).not.toHaveAttribute(
    "data-timeline",
  );
  await expect(page.locator(".rev-rail")).toHaveCount(0);
  expect(await text(page)).toBe(before);
});

test("the chip's step buttons walk the preview, and the bounds show", async ({
  page,
}) => {
  // A writer who cannot wheel steps the walk with the chip's ↑ and ↓
  // buttons, one click per step on the wheel's preview seam. Nothing is
  // toward Now at Now and nothing older at the root, and the buffer never
  // moves under the buttons.
  await twoSteps(page);
  const before = await text(page);
  await page.keyboard.press("Control+Shift+H");

  const older = page.getByRole("button", {
    name: "Step to an older revision",
  });
  const towardNow = page.getByRole("button", { name: "Step toward Now" });

  // At Now the down button is disabled.
  await expect(towardNow).toBeDisabled();
  await expect(older).toBeEnabled();

  // The step pair does not move when Revert joins: the chip reserves the
  // Revert slot, so its width never changes and it never re-centres. The
  // buttons' horizontal position is identical to the pixel; the vertical axis
  // is left to the foot's own mount measure.
  const xOf = async (locator: ReturnType<typeof page.getByRole>) =>
    (await locator.boundingBox())?.x ?? -1;
  const olderX = await xOf(older);
  const towardX = await xOf(towardNow);
  expect(olderX).toBeGreaterThanOrEqual(0);
  expect(towardX).toBeGreaterThanOrEqual(0);

  await older.click();
  await expect(page.locator(".rev-chip-revert")).toBeVisible();
  await expect.poll(() => xOf(older)).toBe(olderX);
  await expect.poll(() => xOf(towardNow)).toBe(towardX);

  await older.click();
  // At the root the up button is disabled.
  await expect(older).toBeDisabled();

  await towardNow.click();
  await towardNow.click();
  await expect(page.locator(".rev-chip-revert")).toBeHidden();
  await expect(towardNow).toBeDisabled();
  // Back at Now the merged view is the plain doc; the buttons changed nothing.
  expect(await text(page)).toBe(before);

  await page.keyboard.press("Escape");
  expect(await text(page)).toBe(before);
});

test("typing is the plain exit: it closes the rail and lands at Now, no parked future", async ({
  page,
}) => {
  await twoSteps(page);
  await page.keyboard.press("Control+Shift+H");
  await notch(page, -3); // walk one step back

  await page.keyboard.type("x"); // typing closes the rail and lands at Now
  await expect(page.locator(".editor-shell")).not.toHaveAttribute(
    "data-timeline",
  );
  await expect(page.locator(".rev-rail")).toHaveCount(0);

  // The walk never moves the head, so nothing is parked: reopening shows a
  // plain timeline with no fork tick.
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".rev-rail-fork")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("a formatting-only step paints its mark in the walk", async ({ page }) => {
  // The step changes only the paragraph's block face, body to H1, with no
  // word changed. The face is part of the block identity, so the walk marks
  // the whole paragraph, a replace painted in the addition's green, and the
  // preview is never a silent face swap.
  await page.keyboard.type("storm");
  await page.keyboard.press("Control+Alt+1"); // setTitle: the paragraph becomes an H1
  await page.keyboard.press("Control+Shift+H");
  await notch(page, -3); // one step back: the H1 face is gone
  await expect(page.locator(".editor mark.df-inserted").first()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the chip is visible and the marker reaches the rail's end", async ({
  page,
}) => {
  // The rail ends in open air over the chrome, the chip rests inside the
  // surface, and the at-Now marker sits on the rail's end. Playwright's
  // `toBeVisible` does not check the viewport, so the real boxes are
  // asserted.
  await page.keyboard.type("storm");
  await page.keyboard.press("Control+Shift+H");

  const surface = await page.locator(".editor-surface").boundingBox();
  expect(surface).not.toBeNull();

  // At Now the disc rests on the rail's end, so the walk spans the whole
  // rail. The head travels on the motion scale, so the poll waits for it.
  await expect
    .poll(async () => {
      const rail = await page.locator(".rev-rail").boundingBox();
      const head = await page.locator(".rev-rail-head").boundingBox();
      return rail && head
        ? Math.abs(head.y + head.height - (rail.y + rail.height))
        : Infinity;
    })
    .toBeLessThan(2);

  // The head poll settles the motion; an unpolled read before it would race
  // the mount measure's second render, so every geometry assertion follows
  // it.
  const rail = await page.locator(".rev-rail").boundingBox();
  const chip = page.locator(".rev-chip");
  const chipBox = await chip.boundingBox();
  const footBox = await page.locator(".rev-foot").boundingBox();
  expect(rail).not.toBeNull();
  expect(chipBox).not.toBeNull();
  expect(footBox).not.toBeNull();
  // The chip is fully inside the surface's span, never below the fold.
  expect(chipBox!.y).toBeGreaterThanOrEqual(surface!.y);
  expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(
    surface!.y + surface!.height,
  );
  // Inside the viewport too.
  expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  // The rail ends `RAIL_GAP` (7px) above the foot column, and the chip's
  // bottom rests `RAIL_GAP` above the rail's span, which ends
  // `--rail-inset-bottom` above the surface's bottom edge. The
  // visibility assertions alone would let both drift toward zero, so they are
  // pinned as real boxes within a pixel.
  const insetBottom = await page
    .locator(".editor-surface")
    .evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue("--rail-inset-bottom")),
    );
  expect(rail!.y + rail!.height).toBeLessThan(chipBox!.y);
  expect(rail!.y + rail!.height).toBeCloseTo(footBox!.y - 7, 0);
  expect(chipBox!.y + chipBox!.height).toBeCloseTo(
    surface!.y + surface!.height - insetBottom - 7,
    0,
  );

  // Off Now, Revert joins and the marker travels, and the chip stays inside
  // the surface at a walked depth too.
  await notch(page, -3);
  await expect(page.locator(".rev-chip-revert")).toBeVisible();
  const walkedChipBox = await chip.boundingBox();
  expect(walkedChipBox).not.toBeNull();
  expect(walkedChipBox!.y).toBeGreaterThanOrEqual(surface!.y);
  expect(walkedChipBox!.y + walkedChipBox!.height).toBeLessThanOrEqual(
    surface!.y + surface!.height,
  );
  await page.keyboard.press("Escape");
});

test("the walked step's datetime appears beside the ball, and leaves at Now", async ({
  page,
}) => {
  // Off Now the rail shows the walked point's datetime beside the head
  // marker; at Now the foot's "Now" label stands. The stamp comes from the
  // journal, and a journal entry without one shows nothing.
  await twoSteps(page);
  await page.keyboard.press("Control+Shift+H");
  await expect(page.locator(".rev-rail-time")).toHaveCount(0);

  await notch(page, -3);
  const stamp = page.locator(".rev-rail-time");
  await expect(stamp).toBeVisible();
  // The shape is `Wed, 12 Aug 2026` over `14:32:12`. Playwright's text
  // matcher does not normalize the inner newline, so `\s` carries the line
  // break between the date and the time; the two-line layout is CSS.
  await expect(stamp).toHaveText(
    /^\w{3}, \d{1,2} \w{3} \d{4}\s\d{2}:\d{2}:\d{2}$/,
  );

  await notch(page, 3);
  await expect(page.locator(".rev-rail-time")).toHaveCount(0);
  await page.keyboard.press("Escape");
});
