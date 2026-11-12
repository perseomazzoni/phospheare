// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The page clears the display's cutouts: a notch, a rounded corner, the home
// indicator's swipe strip. `env(safe-area-inset-*)` reports them, and reports
// 0 unless the document declares `viewport-fit=cover`, which leaves every
// inset at its fallback, including the one keeping the phone's command bar
// off the home indicator.
//
// `env()` cannot be set: it is 0 in every browser, emulator and CI runner
// available, so a layout built directly on it can be neither broken nor proved
// here. The insets are read through `--safe-*` variables, which these tests
// set to a real iPhone's numbers. Whether the platform reports the right
// number is the browser's guarantee.

import { expect, test } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";
import { settleTransitions, stableBox } from "./probe";

/** An iPhone 14 Pro in portrait: the notch above, the indicator below. */
const NOTCH = { top: 59, right: 0, bottom: 34, left: 0 };

async function addNotch(page: import("@playwright/test").Page, inset = NOTCH) {
  await page.evaluate((i) => {
    const root = document.documentElement;
    root.style.setProperty("--safe-top", `${i.top}px`);
    root.style.setProperty("--safe-right", `${i.right}px`);
    root.style.setProperty("--safe-bottom", `${i.bottom}px`);
    root.style.setProperty("--safe-left", `${i.left}px`);
  }, inset);
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done(null))),
      ),
  );
  // Two frames settle a reflow but not a transition, and the chrome animates
  // to its new position when the inset changes, so a box read here catches
  // the bar mid-flight, always short of its target.
  //
  // `CSSTransition` only: `getAnimations()` also returns looping
  // `CSSAnimation`s (the loading dots), whose `finished` never resolves and
  // would hang this helper.
  await settleTransitions(page);
}

test.describe("the safe area", () => {
  test("is declared, or none of the rest of this means anything", async ({
    page,
  }) => {
    await page.goto("/");
    const content = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(content).toContain("viewport-fit=cover");
  });

  test("costs nothing where there is no cutout", async ({ page }) => {
    // All four insets are 0 on a laptop and on every profile here, so the
    // padding is 0 and the layout is the one every other test measures.
    await page.goto("/");
    const pad = await page
      .locator("#root")
      .evaluate((el) => getComputedStyle(el).padding);
    expect(pad).toBe("0px");
  });

  test("keeps the landing page's header out from under the clock", async ({
    page,
  }) => {
    await page.goto("/");
    const before = (await page.locator(".landing-head").boundingBox())?.y ?? -1;
    expect(before).toBeCloseTo(0, 0);

    await addNotch(page);
    const after = (await page.locator(".landing-head").boundingBox())?.y ?? -1;
    // Everything in normal flow is inside `#root`, which pays the inset once;
    // the header does not know a notch exists.
    expect(after).toBeCloseTo(NOTCH.top, 0);
  });

  test("keeps the manuscript out from under the clock", async ({ page }) => {
    await openDemoEditor(page);
    await addNotch(page);
    const surface = await page.locator(".editor-surface").boundingBox();
    if (!surface) throw new Error("no surface");
    expect(surface.y).toBeGreaterThanOrEqual(NOTCH.top);
  });

  test("keeps the phone's command bar off the home indicator", async ({
    page,
  }) => {
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
    const height = page.viewportSize()?.height ?? 0;

    // Both reads wait for the bar to stop moving. `settleTransitions` inside
    // `addNotch` awaits only transitions already started, so one kicked off
    // after it returns is still ahead of the read.
    const before = await stableBox(page, ".ui-bar");
    await addNotch(page);
    const after = await stableBox(page, ".ui-bar");

    // Six controls must not share a strip with a system swipe. The bar is
    // `position: fixed`, outside `#root`'s padding, so it pays the inset
    // itself.
    expect(after.y + after.height).toBeLessThanOrEqual(height - NOTCH.bottom);
    expect(before.y - after.y).toBeCloseTo(NOTCH.bottom, 0);
  });

  test("keeps a modal inside the cutout while the dim covers it", async ({
    page,
  }) => {
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
    await page.getByRole("button", { name: "Project structure" }).click();
    await expect(page.locator(".doc-tree-sheet")).toBeVisible();
    await addNotch(page);

    const scrim = await page.locator(".ui-scrim").boundingBox();
    const sheet = await page.locator(".doc-tree-sheet").boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    if (!scrim || !sheet) throw new Error("no scrim or no sheet");

    // The dim reaches the physical edges, since a scrim stopping short of the
    // notch draws a bright band around a darkened page, and its padding keeps
    // the panel inside the cutouts.
    expect(scrim.y).toBeCloseTo(0, 0);
    expect(scrim.height).toBeCloseTo(height, 0);
    expect(sheet.y).toBeGreaterThanOrEqual(NOTCH.top);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(height - NOTCH.bottom);
  });

  test("keeps the editor's toast above the swipe strip", async ({ page }) => {
    // A toast carries an Undo, so a toast inside the indicator's strip is a
    // button competing with a system gesture. The shelf's toast host is behind
    // an account and is pinned in `styles/safeArea.test.ts`.
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
    await page.getByRole("button", { name: "Project structure" }).click();
    await page.getByRole("button", { name: "Writing preferences" }).click();
    await page
      .getByRole("checkbox", { name: "Typewriter" })
      .dispatchEvent("click");
    const toast = page.locator(".dt-toast");
    await expect(toast).toBeVisible();

    await addNotch(page);
    const box = await toast.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    if (!box) throw new Error("no toast");
    expect(box.y + box.height).toBeLessThanOrEqual(height - NOTCH.bottom);
  });
});
