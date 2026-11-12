// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The structure panel is a treegrid (the `ARIA` Authoring Practices): rows that
// own only cells, one tab stop, and arrow keys between and along the rows.
// The keys' rules are unit-tested (`treegrid.test.ts`, and the panel's own
// rows in jsdom); this spec pins what jsdom cannot, the roles as a browser
// builds them and the keys as a browser delivers them, in each state that
// adds rows of its own: adding, moving and ticking.

import { expect, test, type Page } from "@playwright/test";
import en from "../src/locales/en.json" with { type: "json" };

async function openDemo(page: Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await page.locator(".editor").first().waitFor();
  await page.getByRole("treegrid", { name: en.tree.contents }).waitFor();
}

/**
 * What breaks the grid's ownership: a row outside the grid, a cell outside
 * a row, or anything other than a cell straight inside a row. A control
 * counts by its native role as well as by an explicit one.
 */
const audit = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector('[role="treegrid"]');
    if (!grid) return ["no treegrid"];
    const problems: string[] = [];
    const ownerRole = (el: Element) =>
      el.parentElement?.closest("[role]")?.getAttribute("role") ?? null;
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
    for (const el of grid.querySelectorAll("[role], button, input, a[href]")) {
      const role = el.getAttribute("role");
      const up = ownerRole(el);
      if (role === "row" && up !== "treegrid")
        problems.push(`row ${name(el)} in ${up}`);
      else if (role === "gridcell" && up !== "row")
        problems.push(`cell ${name(el)} in ${up}`);
      else if (role !== "row" && role !== "gridcell" && up !== "gridcell")
        problems.push(`${role ?? el.tagName} ${name(el)} in ${up}`);
    }
    for (const role of ["tree", "treeitem", "group"])
      if (grid.querySelector(`[role="${role}"]`))
        problems.push(`a ${role} inside the grid`);
    return problems;
  });

/** The grid's elements Tab stops on. */
const stops = (page: Page) =>
  page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '[role="treegrid"] :is(button, input, [tabindex])',
        ),
      ].filter((el) => el.tabIndex >= 0).length,
  );

const focusedRow = (page: Page) =>
  page.evaluate(
    () =>
      (document.activeElement as HTMLElement | null)?.getAttribute(
        "data-row",
      ) ?? null,
  );

test("its rows own only cells, at rest and while adding, moving and ticking", async ({
  page,
}) => {
  await openDemo(page);
  const grid = page.getByRole("treegrid", { name: en.tree.contents });
  expect(await audit(page)).toEqual([]);
  expect(await stops(page)).toBe(1);

  // Adding: the name field is a row of its own.
  await grid.locator(".dt-add").first().click();
  await expect(grid.locator(".dt-name-row")).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(grid.locator(".dt-name-row")).toHaveCount(0);

  // Moving: the landings are rows too.
  const current = grid.locator("[aria-current]");
  await current.hover();
  await current.locator(".dt-more").click();
  await page.getByRole("menuitem", { name: en.tree.move }).click();
  await expect(grid.locator(".dt-landing").first()).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(grid.locator(".dt-landing")).toHaveCount(0);

  // Ticking: the grid says it can hold several, and each row says whether
  // it is one of them.
  await current.hover();
  await current.locator(".dt-more").click();
  await page.getByRole("menuitem", { name: en.tree.select }).click();
  await expect(grid).toHaveAttribute("aria-multiselectable", "true");
  await expect(current).toHaveAttribute("aria-selected", "true");
  expect(await audit(page)).toEqual([]);
});

test("Tab enters on the open Section and leaves on the next press", async ({
  page,
}) => {
  await openDemo(page);
  const grid = page.getByRole("treegrid", { name: en.tree.contents });
  const current = await grid.locator("[aria-current]").getAttribute("data-row");
  expect(current).not.toBeNull();

  // From the prose, backwards until the panel: whichever side of the prose
  // the panel stands, one direction reaches it.
  await page.locator(".editor").first().click();
  const inGrid = () =>
    page.evaluate(
      () =>
        document
          .querySelector('[role="treegrid"]')
          ?.contains(document.activeElement) ?? false,
    );
  let presses = 0;
  while (!(await inGrid()) && presses < 60) {
    await page.keyboard.press("Shift+Tab");
    presses += 1;
  }
  expect(await focusedRow(page)).toBe(current);
  // The theme's ring, which is the one thing the grid adds to the look.
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement as Element).outlineStyle,
  );
  expect(outline).not.toBe("none");

  await page.keyboard.press("Shift+Tab");
  expect(await inGrid()).toBe(false);
});

test("the arrows walk the rows and fold a Part", async ({ page }) => {
  await openDemo(page);
  const grid = page.getByRole("treegrid", { name: en.tree.contents });
  const rows = grid.locator("[data-row]");
  const first = await rows.first().getAttribute("data-row");
  const second = await rows.nth(1).getAttribute("data-row");

  await grid.locator("[aria-current]").focus();
  await page.keyboard.press("Home");
  expect(await focusedRow(page)).toBe(first);
  await page.keyboard.press("ArrowDown");
  expect(await focusedRow(page)).toBe(second);
  await page.keyboard.press("ArrowUp");
  expect(await focusedRow(page)).toBe(first);

  // A Part folds with Left and opens with Right, keeping focus on its row.
  const part = grid.locator(".dt-part").first();
  await part.focus();
  const open = await part.getAttribute("aria-expanded");
  await page.keyboard.press(open === "true" ? "ArrowLeft" : "ArrowRight");
  await expect(part).toHaveAttribute(
    "aria-expanded",
    open === "true" ? "false" : "true",
  );
  await expect(part).toBeFocused();
});
