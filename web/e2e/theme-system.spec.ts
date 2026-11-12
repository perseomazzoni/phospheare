// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The theme's variant can follow the system: chosen in Settings, it repaints
// as the system's scheme changes with the page open, and the writer's
// preferences keep the choice across a reload. A theme's own tokens leave the
// page with it.
//
// Settings is behind a writer session, so each row signs in as a local writer
// first.

import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

test.use({ colorScheme: "light", locale: "en-GB" });

/** A custom property as the root's inline style holds it. */
const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (n) => document.documentElement.style.getPropertyValue(n).trim(),
    name,
  );

test("a theme follows the system's scheme as it changes", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "How it looks" }).click();
  await page.getByRole("button", { name: "Matte", exact: true }).click();
  await page.getByRole("button", { name: "as the system" }).click();

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "matte-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "matte-dark");

  // The stored choice is the following one, so a reload lands on the
  // system's scheme too.
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "matte-dark", {
    timeout: 20_000,
  });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "matte-light");

  // A fixed variant stays put whatever the system asks for.
  await page.getByRole("button", { name: "How it looks" }).click();
  await page.getByRole("button", { name: "once dark" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "matte-light");
});

test("a theme's own tokens leave the page with it", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "How it looks" }).click();
  await page.getByRole("button", { name: "Shine", exact: true }).click();
  await page.getByRole("button", { name: "still dark" }).click();

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "shine-dark");
  expect(await rootVar(page, "--shine-glow")).toBe("0.85");

  await page.getByRole("button", { name: "Matte", exact: true }).click();
  await page.getByRole("button", { name: "once dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "matte-light");
  expect(await rootVar(page, "--shine-glow")).toBe("");
});

/** Every theme the root wears from the first script on, in order. */
async function recordThemes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const applied: string[] = [];
    (window as unknown as { applied: string[] }).applied = applied;
    new MutationObserver(() => {
      const now = document.documentElement.dataset.theme;
      if (now && applied[applied.length - 1] !== now) applied.push(now);
      // The root does not exist yet when this runs; the document does.
    }).observe(document, {
      attributes: true,
      attributeFilter: ["data-theme"],
      subtree: true,
    });
  });
}

test("a reload wears the writer's theme from the first paint", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "How it looks" }).click();
  await page.getByRole("button", { name: "Shine", exact: true }).click();
  await page.getByRole("button", { name: "still dark" }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "shine-dark",
  );

  await recordThemes(page);
  const fetched = watchSheets(page);
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "shine-dark",
  );
  // Nothing but the writer's theme is worn, from the first paint on. The
  // shelf reveals only after the account's stored choice has been put on
  // the page, so the list is read once the loading overlay over a mounted
  // shelf has gone and no switch is fading. Another theme would need its
  // own sheet, and none was fetched.
  await expect(page.locator(".app-top")).toBeVisible();
  await expect(page.locator(".app-boot")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-theme-switching",
  );
  expect(fetched()).toHaveLength(1);
  expect(
    await page.evaluate(
      () => (window as unknown as { applied: string[] }).applied,
    ),
  ).toEqual(["shine-dark"]);
});

/**
 * The theme sheets the page fetches from now on. The dev server serves each
 * as `themes/<family>/theme.css`; the build inlines each into its own chunk,
 * `assets/theme-<hash>.js`, whose name does not say the family. So the
 * sheets are counted, and `data-theme` says which one is worn.
 */
function watchSheets(page: Page): () => string[] {
  const sheets = new Set<string>();
  page.on("request", (request) => {
    const sheet =
      /themes\/(\w+)\/theme\.css/.exec(request.url())?.[1] ??
      /assets\/(theme-[\w-]+)\.js/.exec(request.url())?.[1];
    if (sheet) sheets.add(sheet);
  });
  return () => [...sheets].sort();
}

test("only the worn theme's sheet is fetched, and it paints over the frame", async ({
  page,
}) => {
  await signIn(page);
  const fetched = watchSheets(page);
  await page.goto("/app");
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^matte-/);
  expect(fetched()).toHaveLength(1);

  // The theme's layer wins over the frame's: the page wears its paper.
  const ground = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--paper)";
    document.body.append(probe);
    const paper = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { body: getComputedStyle(document.body).backgroundColor, paper };
  });
  expect(ground.body).toBe(ground.paper);
  expect(ground.body).not.toBe("rgba(0, 0, 0, 0)");

  // Settings fetches the rest ahead of a choice.
  await page.goto("/app/settings");
  await expect.poll(() => fetched().length).toBe(4);
});

test("a switch fades, and drops its mark once faded", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "How it looks" }).click();
  await page.evaluate(() => {
    const marks: string[] = [];
    (window as unknown as { marks: string[] }).marks = marks;
    new MutationObserver(() =>
      marks.push(document.documentElement.dataset.themeSwitching ?? "none"),
    ).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-switching"],
    });
  });
  await page.getByRole("button", { name: "Shine", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^shine-/);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { marks: string[] }).marks),
    )
    .toEqual(["1", "none"]);

  await page.getByRole("button", { name: "Matte", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^matte-/);
});
