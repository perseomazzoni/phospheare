// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The build's version in Settings, and the Library's notice of a newer
// release. The dev and E2E servers answer the release feed on the page's own
// origin (`vite.config.ts`, "nothing published"), so a row that wants a
// release answers the feed itself and nothing reaches GitHub.

import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";
import pkg from "../package.json" with { type: "json" };

const FEED = "**/__release/latest";
const RELEASES = "https://github.com/perseomazzoni/phospheare/releases";

/** Answers the feed with `tag`, and counts the asks. */
async function publish(page: Page, tag: string): Promise<() => number> {
  let asks = 0;
  await page.route(FEED, (route) => {
    asks++;
    return route.fulfill({ json: { tag_name: tag } });
  });
  return () => asks;
}

test("About states the version this build runs", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "About" }).click();
  await expect(page.locator(".about-foot")).toContainText(
    `Version ${pkg.version}`,
  );
});

test("the Library offers a newer release once, until it is closed", async ({
  page,
}) => {
  const asks = await publish(page, "v99.0.0");
  await signIn(page);
  await page.goto("/app");

  const notice = page.locator(".status-notice.release-notice");
  await expect(notice).toHaveText(
    "A new version is out. 99.0.0 If you want it, build it from the new source.",
  );
  const link = notice.getByRole("link", { name: "99.0.0" });
  await expect(link).toHaveAttribute("href", `${RELEASES}/tag/v99.0.0`);
  await expect(link).toHaveAttribute("target", "_blank");

  // In the bottom trailing corner, 16px in from both edges.
  const box = await notice.boundingBox();
  const view = page.viewportSize();
  expect(box && view).toBeTruthy();
  expect(Math.round(view!.width - (box!.x + box!.width))).toBe(16);
  expect(Math.round(view!.height - (box!.y + box!.height))).toBe(16);

  // The feed is asked once a day: a second visit reads the first answer.
  await page.reload();
  await expect(notice).toBeVisible();
  expect(asks()).toBe(1);

  await notice.getByRole("button", { name: "Close" }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".app-top")).toBeVisible();
  await expect(page.locator(".welcome")).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("the Library says nothing when the build is current", async ({ page }) => {
  const asks = await publish(page, `v${pkg.version}`);
  await signIn(page);
  await page.goto("/app");
  await expect(page.locator(".welcome")).toBeVisible();
  await expect.poll(asks).toBe(1);
  await expect(page.locator(".status-notice.release-notice")).toHaveCount(0);
});
