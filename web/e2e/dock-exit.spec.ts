// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The close inside the dock ────────────────────────────────────────────────
//
// The dock's head is its tabs and then a close, last in the line: four tabs,
// the demo's included, whose Assistant answers from the demo model.
// At the panel's narrowest the tabs at design size do not
// fit, flexbox pushes the overflow onto the last item, and `.ed-dock`'s
// `overflow: hidden` clips it; an ancestor's clip also removes hit-testing,
// so a clipped close leaves no way out of the dock.
//
// Two halves are pinned, because either alone can pass while the defect is
// present: the close is inside the panel and reachable at every width the
// writer can drag to, and the tabs that give up the room stay legible. jsdom
// measures every rect as zero and does not hit-test, so this runs in a real
// browser.

import { expect, test, type Page } from "@playwright/test";
import { dockTabs, stableBox, TAB_AIR } from "./probe";
import {
  openSignedInProject,
  skipWithoutLocalFolders,
} from "./signedInProject";
import en from "../src/locales/en.json" with { type: "json" };
import it from "../src/locales/it.json" with { type: "json" };

/**
 * The demo book, a section open, and the dock open on it, reached by the
 * words of the language the page is in.
 */
async function openDock(page: Page, words: typeof en = en) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: words.desk.continue }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  // Any face opens the dock at the same width.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: words.toolbar.snapshot })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
}

/**
 * Drags the dock's grip to the far edge of the window, past its floor, so the
 * test never restates the constant it checks.
 */
async function shrinkToFloor(page: Page) {
  const win = page.viewportSize();
  if (!win) throw new Error("no viewport");
  const grip = await stableBox(page, ".dock-resize");
  const y = grip.y + grip.height / 2;
  await page.mouse.move(grip.x + grip.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(win.width - 2, y, { steps: 12 });
  await page.mouse.up();
}

/**
 * Asserts the fitted track's legibility: every word keeps air on both
 * sides, the same air as its neighbours, and the thumb lands on the chosen
 * cell.
 */
function expectLegible(
  air: { label: string; left: number; right: number; glyph: boolean }[],
  thumbOff: { x: number; width: number },
) {
  for (const tab of air) {
    expect(tab.left, `${tab.label} left`).toBeGreaterThanOrEqual(TAB_AIR);
    expect(tab.right, `${tab.label} right`).toBeGreaterThanOrEqual(TAB_AIR);
  }
  // The spark tab is ink-centred in `base.css`: one pixel of its padding moves
  // from leading to trailing, so its box air reads 1px short on the left and
  // 1px over on the right. Equal air is compared with that pixel handed back,
  // as arithmetic rather than a looser tolerance. The demo's tabs carry no
  // glyph.
  const sides = air.flatMap((tab) =>
    tab.glyph ? [tab.left + 1, tab.right - 1] : [tab.left, tab.right],
  );
  expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(1);

  // The thumb is measured onto the chosen cell, so it is checked where it
  // lands, not what it is told.
  expect(Math.abs(thumbOff.x)).toBeLessThan(0.5);
  expect(Math.abs(thumbOff.width)).toBeLessThan(0.5);
}

test.describe("the dock's close, at the narrowest the dock goes", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDock(page);
    await shrinkToFloor(page);
  });

  test("stays inside the panel, whole, and hittable", async ({ page }) => {
    const dock = await stableBox(page, ".ed-dock");
    const close = await stableBox(page, ".dock-close");

    expect(
      close.x,
      "the close starts left of the panel",
    ).toBeGreaterThanOrEqual(dock.x);
    expect(
      Math.round(close.x + close.width),
      "the close ends past the panel's right edge",
    ).toBeLessThanOrEqual(Math.round(dock.x + dock.width));

    // Full width too: a squeezed close can fit inside the panel and still be
    // wrong.
    expect(Math.round(close.width)).toBe(19);

    // A clip removes hit-testing, which is the half a writer feels.
    const reaches = await page.locator(".dock-close").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return !!at && el.contains(at);
    });
    expect(reaches, "the close is not the thing under its own centre").toBe(
      true,
    );
  });

  test("and the tabs that gave the room up are still legible", async ({
    page,
  }) => {
    // The tabs are what compresses. They are fitted: legible means
    // every word has air on both sides, the same air as its neighbours.
    //
    // The demo's head is the four-tab head, the widest.
    const { air, thumbOff } = await dockTabs(page);
    expect(air.map((tab) => tab.label)).toEqual([
      "Enlighten!",
      "Reference",
      "Notes",
      "Snapshot",
    ]);
    expectLegible(air, thumbOff);
  });

  test("closes the dock when it is pressed", async ({ page }) => {
    await page.locator(".dock-close").click();
    await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "0");
  });
});

// ── The widest head ──────────────────────────────────────────────────────────
//
// Four tabs and a close is the head the floor is sized against, pinned here
// on a signed-in project as well as on the demo. Like every signed-in row it
// skips on engines without the File System Access API a local project needs.
test.describe("the four-tab head, at the narrowest the dock goes", () => {
  test("keeps every tab legible and the close inside the panel", async ({
    page,
    browserName,
  }) => {
    skipWithoutLocalFolders(browserName);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openSignedInProject(page);
    await page
      .locator(".bar-stack")
      .getByRole("button", { name: "Enlighten!" })
      .click();
    await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");
    await shrinkToFloor(page);

    const { air, thumbOff } = await dockTabs(page);
    expect(air.map((tab) => tab.label)).toEqual([
      "Enlighten!",
      "Reference",
      "Notes",
      "Snapshot",
    ]);
    expectLegible(air, thumbOff);

    // The close is still whole and inside the panel at the widest head.
    const dock = await stableBox(page, ".ed-dock");
    const close = await stableBox(page, ".dock-close");
    expect(close.x).toBeGreaterThanOrEqual(dock.x);
    expect(Math.round(close.x + close.width)).toBeLessThanOrEqual(
      Math.round(dock.x + dock.width),
    );
    expect(Math.round(close.width)).toBe(19);
  });
});

// ── The widest head, in Italian ──────────────────────────────────────────────
//
// The floor is sized for the four names together, in every language the app
// speaks, and Italian's differ in width from English's. The names are read
// from the locale file, so a reword is measured as it ships.
test.describe("the four-tab head in Italian, at the narrowest the dock goes", () => {
  test.use({ locale: "it-IT" });

  test("keeps every tab legible and the close inside the panel", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDock(page, it);
    await shrinkToFloor(page);

    const { air, thumbOff } = await dockTabs(page);
    expect(air.map((tab) => tab.label)).toEqual([
      it.dock.ask,
      it.dock.reference,
      it.dock.notes,
      it.dock.snapshot,
    ]);
    expectLegible(air, thumbOff);

    const dock = await stableBox(page, ".ed-dock");
    const close = await stableBox(page, ".dock-close");
    expect(close.x).toBeGreaterThanOrEqual(dock.x);
    expect(Math.round(close.x + close.width)).toBeLessThanOrEqual(
      Math.round(dock.x + dock.width),
    );
    expect(Math.round(close.width)).toBe(19);
  });
});
