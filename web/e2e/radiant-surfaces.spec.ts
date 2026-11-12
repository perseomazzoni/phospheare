// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { openFirstLight, openVisionProject } from "./visionProject";
import { stableBox } from "./probe";

// Radiant past the specimen's frame: the Library is the desk with its projects
// as sheets, the history's rail keeps to the sheet's face, Henosis widens the
// sheet to the window's edges, the writer's face is the ember, the bar's type
// tools are set as type, and the comments' passages are the spark's tints.

test.use({ timezoneId: "UTC", locale: "en-US" });

const DESK = { light: "rgb(245, 246, 247)", dark: "rgb(8, 9, 11)" } as const;
const SHEET = { light: "rgb(255, 255, 255)", dark: "rgb(14, 16, 19)" } as const;

async function openSection(page: Page, variant: "light" | "dark") {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, {
    variant,
    text: "section",
    family: "radiant",
  });
  await openFirstLight(page);
}

for (const variant of ["light", "dark"] as const) {
  test(`the Library is the desk and its projects sheets (${variant})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1198, height: 723 });
    await openVisionProject(page, {
      variant,
      text: "section",
      family: "radiant",
      stayInLibrary: true,
    });
    await expect(page.locator(".app")).toHaveCSS(
      "background-color",
      DESK[variant],
    );
    // On the night the card's ground is lit at its head, down to the paper.
    const card = page.locator(".project").first();
    const ground = await card.evaluate((el) => getComputedStyle(el).background);
    expect(ground).toContain(SHEET[variant]);
    await expect(card).toHaveCSS("border-top-left-radius", "12px");
  });

  test(`the writer's face is the ember (${variant})`, async ({ page }) => {
    await openSection(page, variant);
    const face = page.locator(".ed-account .app-avatar-initial");
    // The face is laid over the colour drawn from the name.
    await expect(face).toHaveCSS(
      "background-image",
      "linear-gradient(rgb(143, 90, 20), rgb(143, 90, 20)), none",
    );
    await expect(face).toHaveCSS("color", "rgb(255, 255, 255)");
  });
}

test("the history's rail keeps to the sheet's face", async ({ page }) => {
  await openSection(page, "light");
  await page.getByRole("button", { name: "History" }).click();
  const rail = page.locator(".rev-rail-path");
  await expect(rail).toBeVisible();
  const box = await rail.boundingBox();
  // The sheet stands on the chrome's horizon, 4 under the 40 title bar; the
  // rail starts 10 into it.
  expect(box?.y).toBe(54);
  // The foot, its Now and its chip, stands clear of the panel's edge once
  // the measure has slid back from beside the put-away notes.
  const panel = await page.locator(".doc-tree").boundingBox();
  await stableBox(page, ".editor");
  await expect
    .poll(async () => (await page.locator(".rev-foot").boundingBox())!.x)
    .toBeGreaterThanOrEqual(panel!.x + panel!.width);
  const foot = await page.locator(".rev-foot").boundingBox();
  expect(foot!.y + foot!.height).toBeLessThanOrEqual(723 - 8);
});

test("Henosis widens the sheet to the window's edges", async ({ page }) => {
  await openSection(page, "light");
  // The attribute the Henosis hook writes, set directly with the motion off:
  // the sheet's rule is what is measured, not the hook's timing.
  const sheet = await page.evaluate(() => {
    document.documentElement.style.setProperty("--t-slow", "0s");
    const shell = document.querySelector(".editor-shell") as HTMLElement;
    shell.setAttribute("data-henosis", "full");
    const cs = getComputedStyle(shell, "::before");
    return { top: cs.top, left: cs.left, right: cs.right, bottom: cs.bottom };
  });
  expect(sheet).toEqual({
    top: "8px",
    left: "8px",
    right: "8px",
    bottom: "8px",
  });
});

test("the bar's tools are the app's icons", async ({ page }) => {
  await openSection(page, "light");
  const bold = page.getByRole("button", { name: "Bold" });
  await expect(bold.locator("svg")).toHaveAttribute("viewBox", "0 0 24 24");
});

test("a comment's passage is the spark's tint", async ({ page }) => {
  await openSection(page, "light");
  const marks = await page.evaluate(() => {
    // The sheets keep their rules inside `@layer` blocks, so the walk goes
    // into every grouping rule.
    const rule = (name: string) => {
      let found = "";
      const walk = (rules: CSSRuleList) => {
        for (const r of rules) {
          if (
            r instanceof CSSStyleRule &&
            r.selectorText === `::highlight(${name})`
          )
            found = r.style.backgroundColor;
          if (r instanceof CSSGroupingRule) walk(r.cssRules);
        }
      };
      for (const sheet of document.styleSheets) walk(sheet.cssRules);
      return found;
    };
    const root = getComputedStyle(document.documentElement);
    const token = (name: string) => root.getPropertyValue(name).trim();
    return {
      comment: rule("comment"),
      active: rule("comment-active"),
      passage: token("--mark-comment"),
      open: token("--mark-comment-active"),
      selection: token("--mark-selection"),
    };
  });
  // The last rule for each name is the theme's, and paints the role.
  expect(marks.comment).toBe("var(--mark-comment)");
  expect(marks.active).toBe("var(--mark-comment-active)");
  // The open comment's passage is the selection's tint, any other half of it.
  expect(marks.open).toBe(marks.selection);
  expect(marks.passage).toContain(`${marks.selection} 50%`);
});
