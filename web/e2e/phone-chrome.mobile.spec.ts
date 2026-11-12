// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// On the phone plane the chrome leaves the top edge. On the desk the titlebar
// and the command bar float over the top of the page and cost 86px, an eighth
// of a 667px-tall phone, so on a phone the chrome sits at the bottom edge, the
// titlebar is dropped, and the top of the window is prose.
//
// The file runs on every device profile, not only the phones, to pin the
// split: an iPad at 768 and a phone in landscape at 852 are `narrow` but not
// phones, and keep the desk's chrome. The plane's edge is where a media query
// drifts.

import { expect, test } from "@playwright/test";
import { stableBox } from "./probe";
import { openDemoEditor, paletteCommand } from "./probe-mobile";

/**
 * The five named slots, in the order the thumb reads them. The sixth is the
 * save chip, pinned by class rather than name: its accessible name is its
 * state ("Saved", "Unsaved changes", "Pushing to remote"), so a glyph-only
 * chip never announces "Save" while the words are not saved. `EditorBar`'s
 * own suite pins those names.
 */
const SLOTS = ["Project structure", "Undo", "Bold", "Italic", "Palette"];

test.describe("the chrome stands where the plane says", () => {
  test("the phone puts it at the foot and the tablet leaves it at the head", async ({
    page,
  }) => {
    await openDemoEditor(page);
    const shell = page.locator(".editor-shell");
    const phone = (await shell.getAttribute("data-phone")) === "1";
    const width = page.viewportSize()?.width ?? 0;

    // The attribute is the plane, and the plane is width: 720 inclusive, the
    // same edge as the shell's `.app-find` rule.
    expect(phone).toBe(width <= 720);

    const chrome = await page.locator(".chrome").boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    if (!chrome) throw new Error("no chrome");

    if (phone) {
      // On the bottom edge, with no gap: the bar is what the thumb rests on,
      // and a gap under it is a place a tap misses.
      expect(chrome.y + chrome.height).toBeCloseTo(height, 0);
      // At the foot only: `.chrome` rests fixed at the top edge, so a rule
      // that moved its bottom and left its top would stretch it over the
      // whole window.
      expect(chrome.y).toBeGreaterThan(height / 2);
      // Hidden, not removed: the titlebar is `display: none` on the phone
      // plane rather than a branch in React, so rotating back to a tablet
      // width restores it without remounting the chrome.
      await expect(page.locator(".titlebar")).toBeHidden();
    } else {
      expect(chrome.y).toBeCloseTo(0, 0);
      await expect(page.locator(".titlebar")).toBeVisible();
    }
  });

  // Above the phone the structure panel rests as a rail at the page's left
  // edge. It is `position: fixed`, so it takes none of the room the surface
  // reserves, and only that reserve keeps the first letters of every line out
  // from under it.
  test("the resting rail never lies over the prose", async ({ page }) => {
    await openDemoEditor(page);
    const shell = page.locator(".editor-shell");
    test.skip(
      (await shell.getAttribute("data-phone")) === "1",
      "the phone plane has no rail",
    );
    await expect(shell).toHaveAttribute("data-rail", "1");

    const rail = await stableBox(page, ".doc-tree");
    const prose = await stableBox(page, ".editor");
    expect(prose.x).toBeGreaterThanOrEqual(rail.x + rail.width);
  });

  test("the phone bar carries six slots and nothing else", async ({ page }) => {
    await openDemoEditor(page);
    const shell = page.locator(".editor-shell");
    test.skip(
      (await shell.getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );

    const buttons = page.locator(".ui-bar button");
    const labels = await buttons.evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label")),
    );
    expect(labels).toHaveLength(6);
    expect(labels.slice(0, 5)).toEqual(SLOTS);
    await expect(buttons.nth(5)).toHaveClass(/ed-save/);

    // Seventeen controls at 44px each need 750px of a 375px screen, so the
    // phone bar is a different bar, not the desk bar folded. The controls it
    // drops are a press away in the palette, which is why the palette is one
    // of the six.
    await expect(page.getByRole("button", { name: "Justify" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Redo" })).toHaveCount(0);
  });

  // `.doc-tree` stacks at `z-index: 105` over the chrome's 100, so with the bar
  // at the foot the folded 52px rail can cover the leftmost slot, and a tap on
  // "Project structure" lands on "Writing preferences". The button is still
  // present, named, 44x44 and enabled; only asking what is at that point
  // catches it.
  test("every slot answers to a tap at its own centre", async ({ page }) => {
    await openDemoEditor(page);
    const shell = page.locator(".editor-shell");
    test.skip(
      (await shell.getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );

    const hits = await page.locator(".ui-bar").evaluate((bar) =>
      [...bar.querySelectorAll("button")].map((btn) => {
        const r = btn.getBoundingClientRect();
        const at = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        const owner = at?.closest("button");
        return {
          want: btn.getAttribute("aria-label"),
          got: owner?.getAttribute("aria-label") ?? null,
        };
      }),
    );
    for (const hit of hits) expect(hit.got, hit.want ?? "").toBe(hit.want);
  });

  test("the bar spans the page, on the page's own margin", async ({ page }) => {
    await openDemoEditor(page);
    const shell = page.locator(".editor-shell");
    test.skip(
      (await shell.getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );

    const width = page.viewportSize()?.width ?? 0;
    const bar = await page.locator(".ui-bar").boundingBox();
    if (!bar) throw new Error("no bar");
    // 8px of page margin each side, `--panel-left`, the token the prose falls
    // back to below the plane, so the bar agrees with the page about where it
    // begins.
    expect(bar.x).toBeCloseTo(8, 0);
    expect(bar.width).toBeCloseTo(width - 16, 0);
    // The prose begins on the same margin, past only the gutter the surface
    // keeps where it draws a scrollbar.
    const prose = await stableBox(page, ".editor");
    const gutter = await page
      .locator(".editor-surface")
      .evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth);
    expect(prose.x).toBeGreaterThanOrEqual(bar.x - 0.5);
    expect(prose.x).toBeLessThanOrEqual(bar.x + gutter + 0.5);
  });

  test("the top of the page is manuscript, and the foot clears the bar", async ({
    page,
  }) => {
    await openDemoEditor(page);
    const shell = page.locator(".editor-shell");
    test.skip(
      (await shell.getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );

    const pad = await page.locator(".editor-surface").evaluate((el) => {
      const s = getComputedStyle(el);
      return { top: s.paddingTop, bottom: s.paddingBottom };
    });
    // No chrome floats over the top on this plane.
    expect(pad.top).toBe("24px");

    // The foot clears the chrome, measured against the chrome rather than a
    // literal, so a taller bar cannot silently cover a chapter's last line.
    const chrome = await page.locator(".chrome").boundingBox();
    if (!chrome) throw new Error("no chrome");
    expect(parseFloat(pad.bottom)).toBeGreaterThanOrEqual(chrome.height);
  });

  // The phone bar has no find segment, so the palette's Search is the only
  // way into find there, and the field it opens is the panel's own. Without
  // it the panel's controls stand under a bar with nowhere to type the query.
  test("the palette's Search opens a field to type the query in", async ({
    page,
  }) => {
    await openDemoEditor(page);
    const phone =
      (await page.locator(".editor-shell").getAttribute("data-phone")) === "1";
    await page.getByRole("button", { name: "Palette" }).click();
    await paletteCommand(page, "Search").click();

    const field = page.locator(
      phone
        ? ".find-panel .ui-bar-find-input"
        : ".ed-seg-find .ui-bar-find-input",
    );
    await expect(field).toBeVisible();
    // Typed, not filled: the field must already hold the focus, or the first
    // keystroke lands in the prose.
    await page.keyboard.type("the");
    await expect(field).toHaveValue("the");
    await expect(page.locator(".ui-bar-find-count")).toContainText("/");

    // Inside the screen, so the thumb can reach the whole field. A desk bar
    // too wide for the window scrolls, and the field is scrolled into view.
    const box = await stableBox(
      page,
      phone ? ".find-panel .ui-bar-find" : ".ed-seg-find .ui-bar-find",
    );
    const width = page.viewportSize()?.width ?? 0;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
});
