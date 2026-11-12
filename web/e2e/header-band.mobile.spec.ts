// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The header band grows with the tap floor. Every control has a 44px floor
// under `(pointer: coarse)`, and a 44px button in a 40px header bleeds
// 2px past the hairline at either end. The band is one
// constant derived from the floor, `--header-h: calc(var(--tap) + 4px)`, so
// the two cannot drift apart; the first test pins that, the second measures
// the result where a titlebar is drawn.
//
// Only `ipad-mini` (768) and `phone-landscape` (852) draw one: they are coarse
// and wide, so they take the desk branch and keep the titlebar the phone plane
// drops.

import { expect, test } from "@playwright/test";

test("the band is derived from the tap floor, not written beside it", async ({
  page,
}) => {
  await page.goto("/app/editor/demo");

  const { band, tap, coarse } = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    // Measured, not read: `getPropertyValue` returns the custom property
    // unresolved, as the string "calc(44px + 4px)", which proves the
    // arithmetic was written, never that it resolves.
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:-999px;height:var(--header-h)";
    document.body.append(probe);
    const band = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      band,
      tap: cs.getPropertyValue("--tap").trim(),
      coarse: matchMedia("(pointer: coarse)").matches,
    };
  });

  // Every profile in this project is a touch device; one that is not would
  // measure the desk's 40 and pass without proving anything.
  expect(coarse).toBe(true);
  expect(tap).toBe("44px");
  expect(band).toBe(48);
});

test("nothing in the titlebar bleeds past its hairline", async ({ page }) => {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();

  const measured = await page.evaluate(() => {
    const bar = document.querySelector(".titlebar");
    const b = bar?.getBoundingClientRect();
    // The phone plane keeps the element and collapses it to nothing, so
    // whether a titlebar is drawn is a question about its height, not the DOM.
    if (!b || b.height === 0) return null;
    return {
      height: Math.round(b.height),
      overflow: Array.from(
        document.querySelectorAll<HTMLElement>(".titlebar button"),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        // How far the control escapes the band, at whichever end is worse.
        return Math.round(Math.max(b.top - r.top, r.bottom - b.bottom));
      }),
    };
  });

  // The phone plane draws no titlebar: its chrome is off the top edge.
  test.skip(measured === null, "no titlebar on the phone plane");

  expect(measured!.height).toBe(48);
  expect(measured!.overflow.length).toBeGreaterThan(0);
  // Two of clearance either side, so every one of these is negative.
  for (const escaped of measured!.overflow) expect(escaped).toBe(-2);
});
