// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Typewriter scrolling holds the writing line at the centre of the visible
// page, not of the surface: chrome floats over the surface, so the eye's
// middle is offset by half the difference between what is hidden above and
// below. The offset is measured from the chrome, never a hand-written
// constant, because any change to the bar or the titlebar makes a constant
// stale.
//
// The other station specs match only the `desktop` project, so this file is
// the typewriter's pin on coarse profiles. It reads the debug probe's dashed
// station line and dotted eye-centre line. The probe measures `.bar-stack`
// and picks the near edge itself, while the station measures `.titlebar` plus
// `.bar-row`, so agreement between the two routes is evidence.

import { expect, test, type Page } from "@playwright/test";

/** The probe's two lines, as viewport y-coordinates. */
async function probeLines(page: Page) {
  return page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".station-probe > div"),
    );
    const topOf = (el: HTMLElement) => parseFloat(el.style.top);
    // Computed, not inline: the probe writes `border-top: 1px dashed
    // var(--hair)`, and a shorthand carrying a `var()` leaves every longhand
    // empty in the `CSSOM` until substitution.
    const styleOf = (el: HTMLElement) => getComputedStyle(el).borderTopStyle;
    const dashed = rows.find((el) => styleOf(el) === "dashed");
    const dotted = rows.find((el) => styleOf(el) === "dotted");
    return {
      station: dashed ? topOf(dashed) : null,
      visibleCentre: dotted ? topOf(dotted) : null,
    };
  });
}

test("the station lands on the eye's centre, chrome and all", async ({
  page,
}) => {
  await page.goto("/app/editor/demo?debug=station");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor").first()).toBeVisible();
  // The probe paints from the measure loop, and the chrome is measured through
  // a ResizeObserver coalesced on a frame, so both must have run once.
  await page.locator(".editor p").first().click();
  await expect(page.locator(".station-probe")).toBeVisible();

  const { station, visibleCentre } = await probeLines(page);
  expect(station).not.toBeNull();
  expect(visibleCentre).not.toBeNull();

  // Within a pixel. Profiles that are both touch and wide take the desk
  // branch, so a declared chrome height rather than a measured one misses
  // there first.
  expect(Math.abs(station! - visibleCentre!)).toBeLessThanOrEqual(1);
});
