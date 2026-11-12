// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Whether a finger can reach each control and an eye can read the prose on a
// phone: no surface scrolls sideways, the default folded rail leaves a
// readable column, every control and text field clears its floor, and the
// structural-change toast's Undo stays reachable.

import { expect, test } from "@playwright/test";
import { stableBox } from "./probe";
import { signIn } from "./session";
import {
  MIN_INPUT_FONT,
  MIN_TAP,
  horizontalOverflow,
  openDemoEditor,
  openStructurePanel,
  paletteCommand,
  proseWidth,
  smallInputFonts,
  smallTapTargets,
} from "./probe-mobile";

test.describe("the page fits its device", () => {
  test("the landing page never scrolls sideways", async ({ page }) => {
    await page.goto("/");
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("the editor never scrolls sideways", async ({ page }) => {
    await openDemoEditor(page);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  // A narrow window starts with the rail folded, and the 52px rail leaves a
  // readable column: about 260px at 375 and 302 at 412.
  test("the editor's default state leaves a readable column", async ({
    page,
  }) => {
    await openDemoEditor(page);
    expect(await proseWidth(page)).toBeGreaterThanOrEqual(250);
  });
});

test.describe("touch reach", () => {
  // The tap floor is one `(pointer: coarse)` rule per stylesheet.
  // This sweep is its only guard on the surfaces it walks, the
  // landing page and the editor at rest. Blocks that render only behind the
  // find face or the writing-preferences card (the search rows, the find's
  // open back control, the prefs selects) are not walked, so the claim
  // covers these rooms, not the whole product.
  test("every interactive control is at least 44px", async ({ page }) => {
    await page.goto("/");
    expect(await smallTapTargets(page, MIN_TAP)).toEqual([]);
    await openDemoEditor(page);
    expect(await smallTapTargets(page, MIN_TAP)).toEqual([]);
  });

  // The signed-in Library is the one route that renders `.app-find`, the
  // phone's only pointer route to the command palette, so the sweep visits it
  // too. The Library is behind the writer gate, so the row signs
  // in as a local writer first.
  test("the signed-in Library has no small tap targets either", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/app");
    await expect(page.locator(".app-top")).toBeVisible();
    // The bar draws before the room under it; a sweep run in between finds
    // nothing to measure and passes on an empty page.
    await expect(page.locator(".welcome")).toBeVisible();
    expect(await smallTapTargets(page, MIN_TAP)).toEqual([]);
  });

  // iOS Safari zooms the page on focus below 16px and offers no way back but
  // a pinch, so this is a platform rule. The contenteditable
  // prose is in the sweep too.
  test("no text field triggers the iOS focus zoom", async ({ page }) => {
    await openDemoEditor(page);
    expect(await smallInputFonts(page, MIN_INPUT_FONT)).toEqual([]);

    // The find's replace field and the structure panel's find, each in the
    // room that shows it. Both carry a small desk size that only a touch rule
    // of their own lifts to the floor.
    await page.getByRole("button", { name: "Palette" }).click();
    await paletteCommand(page, "Search").click();
    await expect(page.locator(".find-row input")).toBeVisible();
    expect(await smallInputFonts(page, MIN_INPUT_FONT)).toEqual([]);
    await page.keyboard.press("Escape");
    await openStructurePanel(page);
    await expect(page.locator(".dt-find .ui-bar-find-input")).toBeVisible();
    expect(await smallInputFonts(page, MIN_INPUT_FONT)).toEqual([]);
  });

  // The structure panel's find rests as a circle that clips the field inside
  // it, so the circle, not the field, is what a fingertip can hit. The circle
  // sizes off the panel's 24px control box, and on touch its row raises that
  // box to the tap floor.
  test("the structure panel's find is big enough to hit", async ({ page }) => {
    await openDemoEditor(page);
    await openStructurePanel(page);
    const find = await stableBox(page, ".dt-find");
    // One device pixel of slack, as `smallTapTargets` allows.
    const slack = await page.evaluate(() => 1 / (window.devicePixelRatio || 1));
    expect(find.width).toBeGreaterThanOrEqual(MIN_TAP - slack);
    expect(find.height).toBeGreaterThanOrEqual(MIN_TAP - slack);
  });

  // The open panel's rows: a row's fold and its summary button sit over the
  // label's whole-row reach, so each needs a box of its own at the floor.
  test("every control in the open structure panel is at least 44px", async ({
    page,
  }) => {
    await openDemoEditor(page);
    await openStructurePanel(page);
    await expect(
      page.locator(".doc-tree button.dt-chevron").first(),
    ).toBeVisible();
    expect(await smallTapTargets(page, MIN_TAP, ".doc-tree")).toEqual([]);
  });

  // A nested Part has no number, so its title follows the fold directly. The
  // fold's box still reaches the floor, but stops where the title starts and
  // stays inside its own row.
  test("a nested Part's fold leaves its title to the title", async ({
    page,
  }) => {
    await openDemoEditor(page);
    await openStructurePanel(page);
    // An empty Part takes either kind, so a Part goes inside a new one.
    await page.getByRole("button", { name: "Add a Part" }).first().click();
    await page.keyboard.type("The outer Part");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Expand “The outer Part”" }).click();
    await page
      .locator(
        '.dt-branch:has(> .dt-row .dt-label[title="The outer Part"]) .dt-add-row button[aria-label="Add a Part"]',
      )
      .click();
    await page.keyboard.type("The inner Part");
    await page.keyboard.press("Enter");
    const row = page.locator(".dt-row", {
      has: page.locator(".dt-label", { hasText: "The inner Part" }),
    });
    await expect(row.locator("button.dt-chevron")).toBeVisible();
    await expect(row.locator(".dt-idx")).toHaveCount(0);

    const at = `.dt-row[data-row="${await row.getAttribute("data-row")}"]`;
    const fold = await stableBox(page, `${at} button.dt-chevron`);
    const title = await stableBox(page, `${at} .dt-label`);
    const own = await stableBox(page, at);
    const slack = await page.evaluate(() => 1 / (window.devicePixelRatio || 1));
    expect(fold.width).toBeGreaterThanOrEqual(MIN_TAP - slack);
    expect(fold.height).toBeGreaterThanOrEqual(MIN_TAP - slack);
    expect(fold.x + fold.width).toBeLessThanOrEqual(title.x + 0.5);
    expect(fold.x).toBeGreaterThanOrEqual(own.x - 0.5);
    expect(await smallTapTargets(page, MIN_TAP, ".doc-tree")).toEqual([]);
  });

  // `.doc-tree` is `position: fixed`, so it occupies none of the room the
  // surface's `padding-left` reserves. On the phone plane the reserve is the
  // page margin and the panel lies over the prose as the dock does; wider,
  // the surface keeps the panel's reserve. Either way, opening the panel
  // leaves the prose readable.
  test("opening the structure panel leaves the prose readable", async ({
    page,
  }) => {
    await openDemoEditor(page);
    // The panel is open before the prose is measured, or a panel folded to
    // its rail leaves the prose roomy whatever the reserve does. The guard is
    // inside the helper, because which control opens the panel is a plane
    // decision.
    await openStructurePanel(page);
    expect(
      await page
        .locator(".doc-tree")
        .evaluate((el) => (el as HTMLElement).offsetWidth),
    ).toBeGreaterThan(200);
    // About 45 characters at the prose size is the narrowest usable measure.
    // The panel is a 248px overlay, so behind it is the whole page less its
    // margins.
    expect(await proseWidth(page)).toBeGreaterThan(250);
  });
});

test.describe("the undo toast", () => {
  /** A structural change, made the way a phone writer would have to make it. */
  async function makeStructuralChange(page: import("@playwright/test").Page) {
    await openDemoEditor(page);
    await openStructurePanel(page);
    // The root's own add label.
    await page.getByRole("button", { name: "Add a Part" }).first().click();
    await page.keyboard.type("Probe chapter");
    await page.keyboard.press("Enter");
    await expect(page.locator(".dt-toast")).toBeVisible();
  }

  // The toast sits fixed at bottom centre, above the dock, in one place for
  // every structural change (`editor.css`). On a phone with the structure
  // panel open, neither the panel nor the dock covers its Undo, and any new
  // bottom-edge furniture must keep it so.
  test("nothing covers the Undo, even with the structure panel open", async ({
    page,
  }) => {
    await makeStructuralChange(page);
    const covered = await page.evaluate(() => {
      const btn = document.querySelector<HTMLElement>(".dt-toast-undo");
      if (!btn) return "no undo button";
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit && (hit === btn || btn.contains(hit))
        ? null
        : `covered by ${hit?.tagName.toLowerCase()}.${(hit as HTMLElement | null)?.className}`;
    });
    expect(covered).toBeNull();
  });

  // The Undo is the only compensating control for a structural change already
  // written to disk, so it clears the tap floor. It is its own
  // test because the toast is not on screen during the sweep above.
  test("the Undo is big enough to hit", async ({ page }) => {
    await makeStructuralChange(page);
    const box = await page.locator(".dt-toast-undo").boundingBox();
    expect(box).not.toBeNull();
    // One device pixel of slack, as `smallTapTargets` allows: on a
    // fractional ratio a 44px control measures a hair under 44.
    const slack = await page.evaluate(() => 1 / (window.devicePixelRatio || 1));
    expect(box!.width).toBeGreaterThanOrEqual(MIN_TAP - slack);
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TAP - slack);
  });
});
