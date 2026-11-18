// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Proves the landing page fits a phone in both languages. `.landing` is the
// page's scroller and clips sideways, as `html` and `body` do, so a page
// wider than the screen never scrolls and `scrollWidth` stays at the screen
// width: only the boxes themselves show the cut. A box inside a scroller or a
// clip below `.landing` is that element's business.

import { expect, test } from "@playwright/test";

for (const lang of ["en", "it"] as const) {
  test.describe(lang, () => {
    test.use({ locale: lang === "it" ? "it-IT" : "en-GB" });

    test("no landing box runs past the right edge of the screen", async ({
      page,
    }) => {
      await page.goto("/");
      await page.locator(".landing-hero").waitFor();
      const escaped = await page.evaluate(() => {
        const edge = document.documentElement.clientWidth + 1;
        const clipped = (el: Element): boolean => {
          for (
            let up = el.parentElement;
            up && up !== document.body && !up.classList.contains("landing");
            up = up.parentElement
          ) {
            if (getComputedStyle(up).overflowX !== "visible") return true;
          }
          return false;
        };
        const out: string[] = [];
        for (const el of document.querySelectorAll("body *")) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.right <= edge || clipped(el)) continue;
          out.push(`${el.tagName.toLowerCase()}.${el.className || "-"}`);
        }
        return out;
      });
      expect(escaped, "boxes wider than the screen").toEqual([]);
    });
  });
}
