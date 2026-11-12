// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The release as it ships ──────────────────────────────────────────────────
//
// Runs only against a server already up (`PLAYWRIGHT_BASE_URL`):
// `once-dark-studio-desktop` serving the production build
// (`once-dark-studio-desktop --spa-dir web/dist --no-browser`).
// The rest of the suite needs the test hooks a production build strips, so
// it runs against the dev server or the E2E build.
//
// The spec covers what a visitor meets first, the landing page and the demo
// editor, and asserts that neither logs an error or breaks the content
// security policy. The desktop's own tests check the headers it sends.

import { expect, test, type Page } from "@playwright/test";

test.skip(
  !process.env.PLAYWRIGHT_BASE_URL,
  "runs against a deployed build only",
);

/** Every error the page logs, throws or reports as a CSP violation. */
async function collectProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP ${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  return problems;
}

test("a missing file is a 404, never the app", async ({ request }) => {
  expect((await request.get("/assets/missing-0000.js")).status()).toBe(404);
});

test("the landing page and the demo editor load without an error", async ({
  page,
}) => {
  const problems = await collectProblems(page);

  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();

  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();

  expect(problems).toEqual([]);
});
