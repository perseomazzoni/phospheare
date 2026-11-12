// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Radiant is chosen like any theme: its tile in Settings, then its variant.
// Both variants put their palette on the page, the desk and the four inks
// outside the contract with it, and the choice survives a reload, so the
// writer's stored preferences accept both ids.
//
// Settings is behind a writer session, so the row signs in as a local writer
// first.

import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

test.use({ colorScheme: "light", locale: "en-GB" });

/** A custom property as the root computes it. */
const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

test("Radiant is chosen from Settings, in either variant", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "How it looks" }).click();
  await page.getByRole("button", { name: "Radiant", exact: true }).click();
  // The variant is chosen too, whichever one the tile starts on.
  await page.getByRole("button", { name: "once dark" }).click();

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "radiant-light");
  expect(await rootVar(page, "--paper")).toBe("#FFFFFF");
  expect(await rootVar(page, "--canvas")).toBe("#F5F6F7");
  expect(await rootVar(page, "--ink")).toBe("#1D2126");
  expect(await rootVar(page, "--focus-ring")).toBe("2px solid #0E6E73");

  await page.getByRole("button", { name: "still dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "radiant-dark");
  expect(await rootVar(page, "--paper")).toBe("#0E1013");
  expect(await rootVar(page, "--canvas")).toBe("#08090B");
  expect(await rootVar(page, "--prose-ink")).toBe("#D9DDE3");

  // After a reload the stored choice is read back from the writer's
  // preferences.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "radiant-dark", {
    timeout: 20_000,
  });
});
