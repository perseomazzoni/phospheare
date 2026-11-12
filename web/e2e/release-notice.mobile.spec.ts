// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The new-release card on a touch screen: in the bottom trailing corner,
// 16px in from both edges, inside the window, and its close at the tap floor.
// The feed is answered here, on the page's own origin, as in
// `release-notice.spec.ts`.

import { expect, test } from "@playwright/test";
import { signIn } from "./session";

test("the new-release card sits in the bottom corner, within reach", async ({
  page,
}) => {
  await page.route("**/__release/latest", (route) =>
    route.fulfill({ json: { tag_name: "v99.0.0" } }),
  );
  await signIn(page);
  await page.goto("/app");

  const notice = page.locator(".status-notice.release-notice");
  await expect(notice).toBeVisible();
  const seen = await notice.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const close = el
      .querySelector<HTMLElement>(".status-notice-dismiss")!
      .getBoundingClientRect();
    return {
      right: Math.round(window.innerWidth - r.right),
      bottom: Math.round(window.innerHeight - r.bottom),
      left: Math.round(r.left),
      close: Math.round(Math.min(close.width, close.height)),
      tap: parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--tap"),
      ),
    };
  });
  expect(seen.right).toBe(16);
  expect(seen.bottom).toBe(16);
  expect(seen.left).toBeGreaterThanOrEqual(16);
  expect(seen.close).toBeGreaterThanOrEqual(seen.tap);
});
