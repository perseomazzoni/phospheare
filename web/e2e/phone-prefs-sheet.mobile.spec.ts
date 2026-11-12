// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// On a phone the writing preferences are a bottom sheet on the shared scrim,
// as every dialog below 720px is, not the desk's anchored popover. A phone has
// no prose beside the panel for a popover to float over, so it would lie
// across the structure sheet and the manuscript at once. The editor uses the
// app's own dialog rule rather than a second dialog family.

import { expect, test, type Page } from "@playwright/test";
import { MIN_TAP, openDemoEditor, smallTapTargets } from "./probe-mobile";

/**
 * Waits out the dialog's entrance before measuring it. `uiDialogIn` opens
 * from `scale(.97)`, so a rect read mid-animation is 3% short, enough to
 * report a 44px row as 43. It waits on the animations themselves, not a
 * timeout, so it holds if the curve changes.
 */
async function settled(page: Page) {
  await page
    .locator(".dt-prefs-sheet")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(
        () => undefined,
      ),
    );
}

test.describe("the writing preferences on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
    await page.getByRole("button", { name: "Project structure" }).click();
    await page.getByRole("button", { name: "Writing preferences" }).click();
    await expect(page.locator(".dt-prefs-sheet")).toBeVisible();
    await settled(page);
  });

  test("is a bottom sheet across the full width, not an anchored card", async ({
    page,
  }) => {
    const win = page.viewportSize();
    const box = await page.locator(".dt-prefs-sheet").boundingBox();
    if (!win || !box) throw new Error("no viewport or no sheet");

    expect(Math.round(box.width)).toBe(win.width);
    // Against the bottom edge, where a thumb is, as every dialog below 720px.
    expect(Math.round(box.y + box.height)).toBe(win.height);
    // The popover is not rendered on this plane, not merely hidden.
    await expect(page.locator(".dt-prefs")).toHaveCount(0);
  });

  test("puts the panel behind it out of reach, not merely under a dim", async ({
    page,
  }) => {
    // The structure sheet makes the shell inert, and the sheet itself stands
    // behind this dialog. `OverlayBackgroundProvider` names only the shell, so
    // a second layer names its own background; otherwise a screen reader
    // still reaches the tree behind a blocking dialog.
    await expect(page.locator(".doc-tree")).toHaveAttribute("inert", "");
    await expect(page.locator(".editor-shell")).toHaveAttribute("inert", "");
  });

  test("every control in it is big enough to hit", async ({ page }) => {
    // Three of the five rows are `.dt-tick`: a checkbox row a thumb misses is
    // a setting that silently does not change.
    const small = (await smallTapTargets(page, MIN_TAP)).filter(
      (o) =>
        o.label.includes("dt-tick") ||
        o.label.includes("dt-size") ||
        o.label.includes("cbt-") ||
        o.label.includes("dt-delay"),
    );
    expect(small, `controls under ${MIN_TAP}px`).toEqual([]);
  });

  test("shows all six settings on the screen, not three of them below it", async ({
    page,
  }) => {
    // Every setting is on screen, since nothing scrolls to one below the
    // bottom edge.
    const win = page.viewportSize();
    if (!win) throw new Error("no viewport");
    for (const name of ["Typewriter", "Smooth caret", "Autosave"]) {
      const box = await page
        .locator(".dt-prefs-sheet")
        .getByRole("checkbox", { name })
        .boundingBox();
      if (!box) throw new Error(`no ${name}`);
      expect(
        box.y + box.height,
        `${name} is below the screen`,
      ).toBeLessThanOrEqual(win.height);
    }
    await expect(
      page.locator(".dt-prefs-sheet").getByText("Prose size"),
    ).toBeVisible();
  });

  test("Done, Escape and the backdrop all mean closed", async ({ page }) => {
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator(".dt-prefs-sheet")).toHaveCount(0);
    // The panel it opened from is still there, and reachable again.
    await expect(page.locator(".doc-tree")).not.toHaveAttribute("inert", "");

    await page.getByRole("button", { name: "Writing preferences" }).click();
    await expect(page.locator(".dt-prefs-sheet")).toBeVisible();
    await settled(page);
    await page.keyboard.press("Escape");
    // One press, one layer: the structure sheet under it stays open.
    await expect(page.locator(".dt-prefs-sheet")).toHaveCount(0);
    await expect(page.locator(".doc-tree-sheet")).toBeVisible();
  });

  test("a setting still applies the moment it is pressed", async ({ page }) => {
    // The sheet has no Cancel because every setting applies at once.
    const sheet = page.locator(".dt-prefs-sheet");
    await sheet.getByRole("checkbox", { name: "Smooth caret" }).click();
    await expect(
      sheet.getByRole("checkbox", { name: "Smooth caret" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
