// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { settleTransitions, stableBox } from "./probe";
import {
  openDockFace,
  openFirstLight,
  openVisionProject,
} from "./visionProject";

// Vision's command bar: a line of tools on the page's paper, centred on the
// paper (`barCentre` "paper"), with no edge and no shade at rest. A chosen
// tool is set in ink over a gold rule, the others in the second ink. The bar
// takes a leaf's paint (its edge inked, a gold rule inside it and a flat
// shade beside it) only while it lies over the text: while the Dock covers
// the text, when it keeps a row of its own (`leaves` "row") and centres on
// the text, or while the folded panel peeks. It holds still while the hand
// is in it. Matte's bar takes no leaf.

test.use({ timezoneId: "UTC", locale: "en-GB" });

type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}

const centre = (b: Box) => b.x + b.width / 2;

const tool = (page: Page, name: string) =>
  page.locator(".bar-stack").getByRole("button", { name, exact: true });

/** A shell length in pixels, resolved through a probe, since a token may be
 * a calc(). */
const px = (page: Page, name: string) =>
  page.locator(".editor-shell").evaluate((el, n) => {
    const probe = document.createElement("i");
    probe.style.marginTop = `var(${n})`;
    el.append(probe);
    const value = parseFloat(getComputedStyle(probe).marginTop);
    probe.remove();
    return value;
  }, name);

/** A colour token as the browser computes it. */
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

/** The bar's edge and shade. */
const paint = (page: Page) =>
  page.locator(".bar-stack .ui-bar").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { edge: cs.borderTopColor, shade: cs.boxShadow };
  });

/** The leaf's paint, as the bar wears it. */
async function leaf(page: Page) {
  const [paper, gilt, shade, ink] = await Promise.all([
    token(page, "--paper"),
    token(page, "--vision-gilt"),
    token(page, "--vision-shade"),
    token(page, "--ink"),
  ]);
  return {
    edge: ink,
    shade: `${paper} 0px 0px 0px 3px inset, ${gilt} 0px 0px 0px 4px inset, ${shade} 5px 5px 0px 0px`,
  };
}

const BARE = { edge: "rgba(0, 0, 0, 0)", shade: "none" };

/** Moves the hand off the bar and waits for the bar to come to rest, its
 * folds closed. */
async function rest(page: Page) {
  await page.mouse.move(600, 600);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-fold-engaged",
    "0",
  );
  await expect(page.locator(".bar-stack")).not.toHaveAttribute(
    "data-pinned",
    "1",
  );
  await expect(page.locator('.bar-stack .ed-fold[data-open="1"]')).toHaveCount(
    0,
  );
  await settleTransitions(page);
}

async function open(
  page: Page,
  {
    variant = "light",
    height = 691,
  }: { variant?: "light" | "dark"; height?: number } = {},
) {
  await page.setViewportSize({ width: 1198, height });
  await openVisionProject(page, { variant, text: "section" });
  await openFirstLight(page);
  // The save's tick stands a moment after the save, then the chip narrows.
  await expect(page.locator(".ed-save")).toHaveAttribute("data-state", "clean");
  await rest(page);
}

test("the bar is a line of tools centred on the paper", async ({ page }) => {
  await open(page);
  const bar = await stableBox(page, ".bar-stack .ui-bar");
  // Centred from the panel's reserve to the window's edge, the sheet's gaps
  // cancelling.
  const reserve =
    (await px(page, "--panel-left")) + (await px(page, "--panel-w"));
  expect(centre(bar)).toBeCloseTo((reserve + 1198) / 2, 0);
  expect(bar.y).toBe(
    (await px(page, "--header-h")) + (await px(page, "--bar-seat")),
  );
  // Its tools, the kit's pad and its hairlines come to `--bar-h`, the band
  // the face's top is reckoned from, so the cut meets the bar's foot.
  expect(bar.height).toBe(await px(page, "--bar-h"));
  expect(await paint(page)).toEqual(BARE);
  // The app's icons.
  await expect(
    page.locator('.bar-stack button[aria-label="Bold"] > svg'),
  ).toHaveAttribute("viewBox", "0 0 24 24");
});

for (const variant of ["light", "dark"] as const)
  test(`a chosen tool is set in ink over a gold rule (${variant})`, async ({
    page,
  }) => {
    await open(page, { variant });
    const [ink, ink2, gilt] = await Promise.all([
      token(page, "--ink"),
      token(page, "--ink-2"),
      token(page, "--vision-gilt"),
    ]);
    const rule = `${gilt} 0px -1px 0px 0px inset`;
    // A track's choice: its thumb carries the rule, its word the ink.
    const normal = tool(page, "Normal text");
    await expect(normal).toHaveAttribute("aria-pressed", "true");
    expect(
      await page
        .locator(".bar-stack .ed-track-inline .ui-bar-track-thumb")
        .evaluate((el) => getComputedStyle(el).boxShadow),
    ).toBe(rule);
    expect(await normal.evaluate((el) => getComputedStyle(el).color)).toBe(ink);
    // A pressed toggle carries the rule itself.
    const comments = tool(page, "Comments");
    await expect(comments).toHaveAttribute("aria-pressed", "true");
    expect(
      await comments.evaluate((el) => [
        getComputedStyle(el).boxShadow,
        getComputedStyle(el).color,
      ]),
    ).toEqual([rule, ink]);
    // The rest stand in the second ink, with no rule.
    expect(
      await tool(page, "Bold").evaluate((el) => [
        getComputedStyle(el).boxShadow,
        getComputedStyle(el).color,
      ]),
    ).toEqual(["none", ink2]);
  });

test("the bar holds still while the hand is in it", async ({ page }) => {
  await open(page);
  const before = await stableBox(page, ".bar-stack .ui-bar");
  const folded = await stableBox(page, ".bar-stack .ed-fold-block");
  // Into the block fold: it opens rightwards and nothing moves under the hand.
  // The open row covers the face, so the hand is moved, not aimed at it.
  await page.mouse.move(
    folded.x + folded.width / 2,
    folded.y + folded.height / 2,
  );
  await expect(page.locator(".bar-stack")).toHaveAttribute("data-pinned", "1");
  await expect
    .poll(async () => (await box(page, ".bar-stack .ed-fold-block")).width)
    .toBeGreaterThan(folded.width);
  await stableBox(page, ".bar-stack .ed-fold-block");
  expect((await box(page, ".bar-stack .ui-bar")).x).toBeCloseTo(before.x, 1);
  // Away, the folds close and the bar comes home to its centre.
  await rest(page);
  await expect
    .poll(async () => (await box(page, ".bar-stack .ui-bar")).x)
    .toBeCloseTo(before.x, 1);
  // From the keys the same: the fold opens once the engagement has pinned
  // the bar where it stood.
  await page
    .locator(".bar-stack .ed-fold-block .ed-fold-row button")
    .first()
    .focus();
  await expect(page.locator(".bar-stack")).toHaveAttribute("data-pinned", "1");
  await expect
    .poll(async () => (await box(page, ".bar-stack .ed-fold-block")).width)
    .toBeGreaterThan(folded.width);
  await stableBox(page, ".bar-stack .ed-fold-block");
  expect((await box(page, ".bar-stack .ui-bar")).x).toBeCloseTo(before.x, 1);
});

test("every fold the pointer opens is drawn round its whole row", async ({
  page,
}) => {
  // The pointer opens a fold without focusing it, so the open form is keyed
  // off the latched `data-open`, which keeps a fold open after the pointer
  // leaves it. Each fold's box holds its row of cells, the face hidden.
  await open(page);
  for (const name of ["block", "align", "comments"]) {
    const selector = `.bar-stack .ed-fold-${name}`;
    const folded = await stableBox(page, selector);
    await page.mouse.move(
      folded.x + folded.width / 2,
      folded.y + folded.height / 2,
    );
    await expect(page.locator(selector)).toHaveAttribute("data-open", "1");
    await stableBox(page, selector);
    await settleTransitions(page);
    const drawn = await page.locator(selector).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const row = el.querySelector(".ed-fold-row")!;
      return {
        focused: el.contains(document.activeElement),
        width: box.width,
        row: row.getBoundingClientRect().width,
        cells: Math.max(
          ...[...row.querySelectorAll("button")].map(
            (b) => b.getBoundingClientRect().right,
          ),
        ),
        right: box.right,
        shown: [
          getComputedStyle(el.querySelector(".ed-fold-face")!).opacity,
          getComputedStyle(row).opacity,
        ],
      };
    });
    expect(drawn.focused, name).toBe(false);
    expect(drawn.width, name).toBeGreaterThan(folded.width);
    expect(drawn.width, name).toBeGreaterThanOrEqual(drawn.row);
    expect(drawn.cells, name).toBeLessThanOrEqual(drawn.right);
    expect(drawn.shown, name).toEqual(["0", "1"]);
  }
});

test("over a Dock that covers the text the bar is a leaf on its own row", async ({
  page,
}) => {
  await open(page, { height: 723 });
  await openDockFace(page, "ask");
  await rest(page);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "1",
  );
  // It centres on the text, the paper's centre lying under the Dock.
  const text = await stableBox(page, ".editor");
  await expect
    .poll(async () => centre(await stableBox(page, ".bar-stack .ui-bar")))
    .toBeCloseTo(centre(text), 0);
  await expect.poll(() => paint(page)).toEqual(await leaf(page));
  // The Dock steps down under the bar's row, and the bar keeps clear of the
  // panel.
  const bar = await box(page, ".bar-stack .ui-bar");
  const dock = await stableBox(page, ".ed-dock");
  const panel = await box(page, ".doc-tree");
  expect(dock.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(bar.x).toBeGreaterThanOrEqual(panel.x + panel.width);
});

const apart = (a: Box, b: Box) =>
  a.x + a.width <= b.x ||
  b.x + b.width <= a.x ||
  a.y + a.height <= b.y ||
  b.y + b.height <= a.y;

test("an engaged bar passes over neither the panel's head nor the Dock's", async ({
  page,
}) => {
  await open(page, { height: 723 });
  await openDockFace(page, "ask");
  await rest(page);
  const fold = await stableBox(page, ".bar-stack .ed-fold-block");
  await page.mouse.move(fold.x + fold.width / 2, fold.y + fold.height / 2);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-fold-engaged",
    "1",
  );
  await expect
    .poll(async () => (await box(page, ".bar-stack .ed-fold-block")).width)
    .toBeGreaterThan(fold.width);
  const bar = await stableBox(page, ".bar-stack .ui-bar");
  expect(apart(bar, await box(page, ".doc-tree .dt-head"))).toBe(true);
  expect(apart(bar, await box(page, ".dock-head"))).toBe(true);
});

test("the bar takes its leaf only while it lies over the text", async ({
  page,
}) => {
  // A wide window: the Dock stands beside the text, and the bar stays bare.
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  await openDockFace(page, "ask");
  await rest(page);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "0",
  );
  await expect.poll(() => paint(page)).toEqual(BARE);
  // The Dock away and the panel folded to its rail: still bare.
  await page.locator(".dock-close").click();
  await expect(page.locator(".ed-dock")).not.toHaveAttribute("data-open", "1");
  await page.getByRole("button", { name: "Narrow the panel" }).click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  await rest(page);
  await expect.poll(() => paint(page)).toEqual(BARE);
  // The folded panel peeks under the hand: the panel and the bar are leaves.
  const rail = await stableBox(page, ".doc-tree");
  await page.mouse.move(rail.x + rail.width / 2, 400);
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-peek", "1");
  await expect.poll(() => paint(page)).toEqual(await leaf(page));
  // Attached, the peek takes the inset as width too, so its edge stands
  // where the open panel's does.
  expect((await stableBox(page, ".doc-tree")).width).toBe(
    (await px(page, "--panel-open-w")) + (await px(page, "--panel-left")),
  );
  const [ink, shade] = await Promise.all([
    token(page, "--ink"),
    token(page, "--vision-shade"),
  ]);
  await expect
    .poll(() =>
      page
        .locator(".doc-tree")
        .evaluate((el) => [
          getComputedStyle(el).borderRightColor,
          getComputedStyle(el).boxShadow,
          getComputedStyle(el, "::after").opacity,
        ]),
    )
    .toEqual([ink, `${shade} 6px 0px 0px 0px`, "1"]);
  // The hand away, the peek folds and the bar is bare again.
  await page.mouse.move(1000, 600);
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-peek", "0");
  await expect.poll(() => paint(page)).toEqual(BARE);
});

test("Matte's bar takes no leaf over a Dock that covers the text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, {
    variant: "light",
    text: "section",
    family: "matte",
  });
  await openFirstLight(page);
  await openDockFace(page, "ask");
  await rest(page);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "1",
  );
  // No gold rule inside its edge.
  expect((await paint(page)).shade).not.toMatch(/0px 0px 0px 4px inset/);
  // The same band as Vision's.
  const bar = await stableBox(page, ".bar-stack .ui-bar");
  expect(bar.height).toBe(await px(page, "--bar-h"));
});
