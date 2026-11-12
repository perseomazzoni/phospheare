// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The on-screen keyboard, driven synthetically. Playwright emulates no soft
// keyboard on either engine, but the app reads `visualViewport`, an ordinary
// object on `window`; a real keyboard changes its `height` and `offsetTop`
// and fires the events this file fires. This proves the chain, hook to `--kb`
// on the root to the bar, the panel, the surface's foot and the toast, and
// not the device: whether iOS's own animation makes the bar jitter is for a
// device to answer.
//
// The keyboard does not resize the page, since both engines keep the layout
// viewport at full height, so a bar at `bottom: 0` sits under the keys and is
// unreachable while the writer types.

import { expect, test } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";
import { settleTransitions, stableBox } from "./probe";

/** The band the keyboard leaves, and the events the browser fires with it. */
async function raiseKeyboard(
  page: import("@playwright/test").Page,
  height: number,
) {
  await page.evaluate((h) => {
    const vv = window.visualViewport;
    if (!vv) throw new Error("no visualViewport in this browser");
    Object.defineProperty(vv, "height", { configurable: true, value: h });
    vv.dispatchEvent(new Event("resize"));
  }, height);
  // The hook coalesces through one frame; two rAFs clears it with room.
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done(null))),
      ),
  );
  // The hook settling is not the chrome arriving: `--kb` feeds rules the bar
  // and the panel transition on, so a `boundingBox` read now catches them on
  // the way up.
  //
  // `CSSTransition` only: `getAnimations()` also returns looping
  // `CSSAnimation`s whose `finished` never resolves, and awaiting those hangs.
  await settleTransitions(page);
}

const kb = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--kb").trim(),
  );

// Not limited to the phone plane: an iPad at 1024px is a desk by width and
// still gets a soft keyboard, so this describe runs on every profile.
test.describe("the writing surface's foot", () => {
  const foot = (page: import("@playwright/test").Page) =>
    page
      .locator(".editor-surface")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));

  test("grows by whatever the keyboard covers, on every plane", async ({
    page,
  }) => {
    await openDemoEditor(page);
    const height = page.viewportSize()?.height ?? 0;
    const before = await foot(page);
    await raiseKeyboard(page, height - 336);
    // Without the keyboard's share the last paragraph of a Section cannot be
    // scrolled above the keys: reachable by caret but not by eye.
    expect((await foot(page)) - before).toBeCloseTo(336, 0);
  });
});

test.describe("the keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
  });

  test("is zero until there is one", async ({ page }) => {
    // The token is published unconditionally, so every rule that reads it has
    // a value on a desk too. A `var(--kb)` with no declaration falls back
    // silently.
    expect(await kb(page)).toBe("0px");
  });

  test("lifts the bar out from under it", async ({ page }) => {
    // Stable reads: settling the running transitions cannot cover one that
    // starts afterwards, and this assertion subtracts two boxes, so either
    // read being early moves the answer.
    const before = await stableBox(page, ".ui-bar");
    const height = page.viewportSize()?.height ?? 0;
    await raiseKeyboard(page, height - 336);

    // Polled, not read once: the hook coalesces its own write, so two frames
    // after the resize the token can still read "0px". An inset that never
    // arrives still fails.
    await expect.poll(() => kb(page)).toBe("336px");
    const after = await stableBox(page, ".ui-bar");
    // High enough to clear the keys entirely, not merely higher.
    expect(after.y + after.height).toBeLessThanOrEqual(height - 336);
    expect(before.y - after.y).toBeCloseTo(336, 0);
  });

  test("takes the structure panel with it", async ({ page }) => {
    const height = page.viewportSize()?.height ?? 0;
    await page.getByRole("button", { name: "Project structure" }).click();
    const before = await stableBox(page, ".doc-tree");
    await raiseKeyboard(page, height - 336);
    const after = await stableBox(page, ".doc-tree");
    // The panel is a modal sheet here and its scrim is `inset: 0`, so
    // without the inset its foot, holding the find field that raised the
    // keys, runs under them.
    expect(before.height - after.height).toBeCloseTo(336, 0);
  });

  test("puts it back down", async ({ page }) => {
    const height = page.viewportSize()?.height ?? 0;
    const before = await stableBox(page, ".ui-bar");
    await raiseKeyboard(page, height - 336);
    await raiseKeyboard(page, height);
    await expect.poll(() => kb(page)).toBe("0px");
    // The bar transitions back down, so this read is settled like the one on
    // the way up.
    const after = await stableBox(page, ".ui-bar");
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  test("is not fooled by a URL bar", async ({ page }) => {
    // `visualViewport` also moves when the address bar collapses, and the bar
    // must not hop for that.
    const height = page.viewportSize()?.height ?? 0;
    await raiseKeyboard(page, height - 90);
    expect(await kb(page)).toBe("0px");
  });
});
