// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Proves the mobile profiles present as phones. A profile that emulates only a
// viewport is a narrow desktop window: it still has a mouse, still matches
// `(hover: any-hover)`, and still reveals every hover-gated control a phone
// cannot reach. When this file fails, no other `*.mobile.spec.ts` result
// means anything.

import { expect, test } from "@playwright/test";
import { isCoarsePointer, openDemoEditor } from "./probe-mobile";

test("the device profile presents as touch, not as a small desktop", async ({
  page,
}) => {
  await page.goto("/");
  expect(await isCoarsePointer(page)).toBe(true);
});

test("the viewport is the profile's, and the page fits it", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.locator("#root > *").first().waitFor();
  const measured = await page.evaluate(() => ({
    inner: window.innerWidth,
    // The body, not the document: `html` and `body` hide their overflow,
    // so the document never scrolls and a page wider than the screen is cut
    // off instead.
    content: document.body.scrollWidth,
    dpr: window.devicePixelRatio,
    onTouchStart: "ontouchstart" in window,
    // WebKit reports 0 here even with touch emulated, while Chromium reports
    // 1, so detecting touch by `maxTouchPoints` calls every iOS profile a
    // desktop.
    maxTouchPoints: navigator.maxTouchPoints,
  }));
  // Printed so a failure elsewhere shows which profile produced it. Touch is
  // asserted by the row above.
  console.log(
    `[${testInfo.project.name}] inner=${measured.inner} dpr=${measured.dpr} ` +
      `ontouchstart=${measured.onTouchStart} maxTouchPoints=${measured.maxTouchPoints}`,
  );
  expect(measured.inner).toBe(testInfo.project.use.viewport?.width);
  expect(
    measured.content,
    "the page is wider than the screen",
  ).toBeLessThanOrEqual(measured.inner);
});

test("the editor is reachable at this size at all", async ({ page }) => {
  // The demo route is the only way into the editor without an account. When
  // it cannot open on a phone, every editor row on this profile is
  // unreachable rather than wrong.
  await openDemoEditor(page);
  await expect(page.locator(".editor")).toBeVisible();
});
