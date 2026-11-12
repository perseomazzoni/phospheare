// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The phone plane paints the ground's grain and none of its pools.
// `--ground` is two radial pools sized in pixels and positioned in percent, so
// as the window narrows each pool keeps its size while its centre walks
// toward the corner. On a desk the pools sit in their corners with untinted
// paper between them; at 375px they overlap across the middle and tint the
// whole top of the screen, a coloured shape the token's own rule forbids.
// The themes' 4.5:1 contrast margin holds either way, since it is measured
// against the gradient's maximum alpha at the off-screen pool centre.
//
// The phone rule sits on the consumers, not the token: `theme/adapters/page.ts` writes every
// theme token as an inline custom property on the root, and an inline
// declaration beats any stylesheet rule, media query or not.

import { expect, test, type Page } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";

/** What this element actually paints behind its content. */
async function ground(page: Page, selector: string): Promise<string> {
  return await page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundImage);
}

/**
 * Whether the grain is painted. It survives on every plane: an `feTurbulence`
 * data URI, texture rather than colour, that stops an 8-bit display banding a
 * flat `--paper`, so dropping the pools must not drop it.
 */
function hasGrain(image: string): boolean {
  return image.includes("feTurbulence") || image.includes("data:image/svg");
}

test.describe("the ground on the phone plane", () => {
  test("the editor paints grain and no pools", async ({ page }) => {
    await openDemoEditor(page);
    const phone =
      (await page.locator(".editor-shell").getAttribute("data-phone")) === "1";
    const image = await ground(page, ".editor-shell");

    expect(hasGrain(image), "the grain is not the part that goes").toBe(true);
    if (phone) {
      expect(image).not.toContain("radial-gradient");
    } else {
      // A touch device wider than 720 still gets the wash: 768 and 1280 are
      // on the desk's side of the one media query.
      expect(image).toContain("radial-gradient");
    }
  });

  test("the shelf and the skeleton answer the same way", async ({ page }) => {
    // `.app` is the Library and `.ed-skeleton` the wait before the editor
    // chunk lands, each with its ground in a stylesheet that is not the
    // editor's. Both are probed as classes on the live document, which
    // resolves through the real cascade, tokens and media query: one screen
    // is behind `RequireAuth` and the other is gone within a frame of the
    // chunk arriving. The skeleton's rule lives apart from `.editor-shell`'s,
    // and a mismatch shows as a colour change the moment the editor appears.
    await openDemoEditor(page);
    const phone =
      (await page.locator(".editor-shell").getAttribute("data-phone")) === "1";

    for (const className of ["app", "ed-skeleton"]) {
      const image = await page.evaluate((name) => {
        const probe = document.createElement("div");
        probe.className = name;
        document.body.append(probe);
        const out = getComputedStyle(probe).backgroundImage;
        probe.remove();
        return out;
      }, className);

      expect(hasGrain(image), `${className}: the grain went too`).toBe(true);
      expect(
        image.includes("radial-gradient"),
        `${className}: pools on the wrong plane`,
      ).toBe(!phone);
    }
  });
});
