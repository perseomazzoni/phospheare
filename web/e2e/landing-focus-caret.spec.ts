// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The landing's focus demo draws its caret where its character stands. The
// caret is measured from the laid-out text, and a web font that lands after
// the first measure moves the text without resizing the column, so the font
// files are held back here until the demo has drawn its caret once.

import { expect, test, type Page } from "@playwright/test";
import { START_MS } from "./start";

/** The drawn caret and the character it marks, each from the prose's box. */
function caretAndCharacter(page: Page) {
  return page.evaluate(() => {
    const caret = document.querySelector<HTMLElement>(".landing-focus-caret");
    const prose = caret?.parentElement;
    // The demo opens with the caret in the second paragraph, at offset 40.
    const text = prose?.children[1]?.firstChild;
    if (!caret || !prose || !(text instanceof Text)) return null;
    const range = document.createRange();
    range.setStart(text, Math.min(40, text.length));
    const box = range.getClientRects()[0];
    const frame = prose.getBoundingClientRect();
    const drawn = caret.getBoundingClientRect();
    return {
      caret: { left: drawn.left - frame.left, top: drawn.top - frame.top },
      character: { left: box.left - frame.left, top: box.top - frame.top },
    };
  });
}

test("the focus demo's caret stands on its character after the fonts land", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let release: () => void = () => {};
  const held = new Promise<void>((done) => (release = done));
  await page.route("**/fonts/**", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.locator(".landing-focus-caret")).toBeAttached({
    timeout: START_MS,
  });
  release();
  await page.evaluate(() => document.fonts.ready);

  await expect
    .poll(async () => {
      const drawn = await caretAndCharacter(page);
      if (!drawn) return Infinity;
      return Math.max(
        Math.abs(drawn.caret.left - drawn.character.left),
        Math.abs(drawn.caret.top - drawn.character.top),
      );
    })
    .toBeLessThan(0.5);
});
