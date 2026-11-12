// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The command bar is as wide as its controls and tracks them as they come and
// go. jsdom measures every rect as zero, so this runs where layout is real.
// The closed find and chars drops are zero-height grids that still carry
// their content width; if they size the stack, `align-items: stretch` pulls
// the bar out to the width of a hidden panel.

import { expect, test } from "@playwright/test";
import { settleTransitions, stableBox } from "./probe";
import { START_MS } from "./start";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "scroll",
    { timeout: START_MS },
  );
  // The demo opens on the Desk; the bar mounts once a section is open.
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await expect(page.locator(".ui-bar")).toBeVisible();
});

test("the bar is no wider than its buttons", async ({ page }) => {
  const bar = page.locator(".ui-bar");
  const { width, segW } = await bar.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const segW = Array.from(el.querySelectorAll(":scope > .ui-bar-seg")).reduce(
      (sum, seg) => sum + seg.getBoundingClientRect().width,
      0,
    );
    return { width: rect.width, segW };
  });
  // Padding (5px each side), borders (1px each) and the 2px gaps between
  // segments account for about 26px; anything beyond is a stretched bar.
  expect(width).toBeLessThanOrEqual(segW + 40);
});

test("adding a control grows the bar, removing it shrinks the bar", async ({
  page,
}) => {
  const bar = page.locator(".ui-bar");
  const growth = await bar.evaluate((el) => {
    const measure = () => el.getBoundingClientRect().width;
    const before = measure();
    const fake = document.createElement("button");
    fake.style.cssText = "width:34px;height:34px;flex-shrink:0;";
    el.appendChild(fake);
    const grown = measure();
    fake.remove();
    const shrunk = measure();
    return { before, grown, shrunk };
  });
  expect(growth.grown - growth.before).toBeGreaterThan(30);
  expect(growth.shrunk).toBe(growth.before);
});

test("the save stamp keeps its full ink while there is nothing to save", async ({
  page,
}) => {
  // Clean is a disabled button, but the stamp is a status the writer reads,
  // so it is not dimmed: at 0.4 it falls under 2:1 against the bar. The
  // opacity is the product down the stamp's ancestors, any of which could
  // dim it, and the tick's entrance fades in, so it is polled.
  const save = page.locator(".bar-stack .ed-save");
  await expect(save).toHaveAttribute("data-state", "clean");
  await expect(save).toBeDisabled();
  const label = save.locator(".ed-save-label");
  await expect(label).toBeVisible();
  await expect
    .poll(() =>
      label.evaluate((el) => {
        let opacity = 1;
        for (
          let node: Element | null = el;
          node && !node.matches(".bar-stack");
          node = node.parentElement
        )
          opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      }),
    )
    .toBe(1);
});

test("a bar too wide for the window scrolls rather than squeezing", async ({
  page,
}) => {
  // The open find at 760 makes the bar wider than the window. Its segments
  // keep their content's width and the bar scrolls under the wheel, so
  // every control stays whole and within reach at both ends.
  await page.setViewportSize({ width: 760, height: 800 });
  await page.locator(".editor p").first().click();
  await page.keyboard.press("Control+f");
  await expect(page.locator(".bar-stack .ui-bar-find-input")).toBeFocused();
  await settleTransitions(page);
  const bar = page.locator(".bar-stack .ui-bar");
  const seen = await bar.evaluate((el) => ({
    overflow: el.scrollWidth - el.clientWidth,
    slack: [...el.querySelectorAll(":scope > .ui-bar-seg")].map(
      (seg) => seg.getBoundingClientRect().width - seg.scrollWidth,
    ),
  }));
  expect(seen.overflow).toBeGreaterThan(0);
  for (const slack of seen.slack) expect(slack).toBeGreaterThanOrEqual(-0.5);

  /** Whether the bar's first or last control answers at its own centre. */
  const answers = (end: "first" | "last") =>
    bar.evaluate((el, end) => {
      const all = el.querySelectorAll<HTMLElement>("button, input");
      const control = end === "first" ? all[0] : all[all.length - 1];
      const r = control.getBoundingClientRect();
      const at = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return at !== null && control.contains(at);
    }, end);
  await bar.evaluate((el) => (el.scrollLeft = 0));
  expect(await answers("first")).toBe(true);
  const box = await stableBox(page, ".bar-stack .ui-bar");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(seen.overflow + 100, 0);
  await expect
    .poll(() =>
      bar.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft),
    )
    .toBeLessThanOrEqual(1);
  expect(await answers("last")).toBe(true);
});

test("the save chip drops its word before the bar scrolls", async ({
  page,
}) => {
  // At 1100 the window is wide, but the open dock leaves the bar less room
  // than its content, so the chip takes the narrow window's form: no word,
  // its glyph alone.
  await page.setViewportSize({ width: 1100, height: 800 });
  const bar = page.locator(".bar-stack .ui-bar");
  const save = bar.locator(".ed-save");
  await expect(save).toHaveAttribute("data-state", "clean");
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-narrow",
    "0",
  );
  await expect(bar).not.toHaveAttribute("data-save-tight", "1");
  await expect(save.locator(".ed-save-label")).toBeVisible();
  const full = await stableBox(page, ".bar-stack .ed-save");

  await bar.getByRole("button", { name: "Snapshots" }).click();
  await expect(page.locator(".ed-dock")).toBeVisible();
  await page.mouse.move(550, 600);
  await expect(bar).toHaveAttribute("data-save-tight", "1");
  await expect(save).toHaveAttribute("data-state", "clean");
  await expect(save.locator(".ed-save-label")).toBeHidden();
  await expect(save.locator(".ed-save-glyph")).toBeVisible();
  const tight = await stableBox(page, ".bar-stack .ed-save");
  expect(tight.width).toBeLessThan(full.width - 20);
});
