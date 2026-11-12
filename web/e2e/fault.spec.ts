// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";

// Pins what a writer sees when the app fails, in a real browser and, under
// `E2E_BUILD=1`, under the shipped CSP with Trusted Types: the
// editor's chunk gone after a deploy reloads the tab once and then says a
// newer version is ready, and an unknown address says so. Neither page shows
// the router's own error page, a message or a stack.

/** Every script file the page asks for while `visit` runs. */
async function scriptsDuring(page: Page, visit: () => Promise<unknown>) {
  const seen = new Set<string>();
  const listen = (request: { resourceType(): string; url(): string }) => {
    if (request.resourceType() === "script") seen.add(request.url());
  };
  page.on("request", listen);
  await visit();
  await page.waitForLoadState("networkidle");
  page.off("request", listen);
  return seen;
}

async function cspViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (text: string) =>
    violations.push(text),
  );
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (
        window as unknown as { reportViolation(text: string): void }
      ).reportViolation(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  return violations;
}

async function expectNoInternals(page: Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/Unexpected Application Error/);
  expect(text).not.toMatch(/dynamically imported module|module script/i);
  expect(text).not.toMatch(/^\s*at \S+ \(/m);
}

test("a deploy that removed the editor's chunk reloads once, then says a newer version is ready", async ({
  browser,
}) => {
  // The editor's files: the scripts the demo asks for beyond the home page's.
  const probe = await browser.newPage();
  const home = await scriptsDuring(probe, () => probe.goto("/"));
  const demo = await scriptsDuring(probe, () => probe.goto("/app/editor/demo"));
  await probe.close();
  const editor = [...demo].filter((url) => !home.has(url));
  expect(editor.length).toBeGreaterThan(0);

  const page = await browser.newPage();
  const violations = await cspViolations(page);
  await page.route(
    (url) => editor.includes(url.href),
    (route) => route.abort("failed"),
  );
  let loads = 0;
  page.on("load", () => (loads += 1));

  await page.goto("/app/editor/demo");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A newer version is ready",
  );
  expect(loads).toBe(2);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await expectNoInternals(page);
  expect(violations).toEqual([]);
  await page.close();
});

test("an unknown address says the page was not found", async ({ page }) => {
  const violations = await cspViolations(page);
  await page.goto("/no/such/page");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Page not found",
  );
  await expect(page).toHaveURL(/\/no\/such\/page$/);
  await expect(
    page.getByRole("link", { name: "Back to the homepage" }),
  ).toHaveAttribute("href", "/");
  await expectNoInternals(page);
  expect(violations).toEqual([]);
});
