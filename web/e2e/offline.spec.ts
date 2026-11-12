// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The offline notice: losing the connection mid-session shows a notice that
// says the app is offline, never stands in the way of the page, and leaves
// when the connection returns. What happens to the writes while offline is
// another spec's subject.
//
// It runs on `/app/editor/demo`, which needs no account and no stack, so it
// runs in CI without a token. `src/ui/DeviceNotice.test.tsx` pins the same
// clauses against the component; this pins them in a real engine with prose
// on screen.
//
// A reload while offline is out of reach: the project has no service worker,
// so the browser serves its own error page and the app never loads.

import { expect, test } from "@playwright/test";

/** What the writer sees about the connection, and whether it is in the way. */
async function readNotice(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".device-notice");
    if (!el) return { shown: false, text: "", blocks: false, covered: "" };
    const box = el.getBoundingClientRect();
    return {
      shown: true,
      text: el.innerText.trim(),
      // Whatever is under the notice is still what a click lands on.
      blocks: getComputedStyle(el).pointerEvents !== "none",
      covered:
        document
          .elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          ?.className?.toString() ?? "",
    };
  });
}

test("the notice arrives, stays out of the way, and leaves on its own", async ({
  page,
  context,
}) => {
  await page.goto("/app/editor/demo");
  // The editor is the lazy half; wait for prose rather than a timeout.
  await expect(page.locator(".editor-shell").first()).toBeVisible({
    timeout: 20_000,
  });

  expect((await readNotice(page)).shown).toBe(false);

  await context.setOffline(true);
  await expect.poll(async () => (await readNotice(page)).shown).toBe(true);

  const offline = await readNotice(page);
  expect(offline.text.length).toBeGreaterThan(0);
  expect(offline.blocks).toBe(false);
  // `elementFromPoint` at the notice's centre must reach past it; returning
  // the notice means `pointer-events: none` is lost. The class name must
  // match the selector in `readNotice`: a stale name passes silently while
  // the notice covers the page.
  expect(offline.covered).not.toContain("device-notice");

  // The page is still the writer's to use while the notice is up.
  await expect(page.locator(".editor-shell").first()).toBeVisible();

  await context.setOffline(false);
  // No dismiss control is pressed: the notice clears itself or the row fails.
  await expect.poll(async () => (await readNotice(page)).shown).toBe(false);
});

test("and it comes back for a second disconnection", async ({
  page,
  context,
}) => {
  // A one-shot notice that never returns would pass every assertion above.
  await page.goto("/app/editor/demo");
  await expect(page.locator(".editor-shell").first()).toBeVisible({
    timeout: 20_000,
  });

  for (let round = 1; round <= 2; round++) {
    await context.setOffline(true);
    await expect
      .poll(async () => (await readNotice(page)).shown, {
        message: `round ${round}: the notice should be up while offline`,
      })
      .toBe(true);
    await context.setOffline(false);
    await expect
      .poll(async () => (await readNotice(page)).shown, {
        message: `round ${round}: the notice should have cleared itself`,
      })
      .toBe(false);
  }
});
