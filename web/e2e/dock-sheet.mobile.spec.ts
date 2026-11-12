// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The dock's buttons on a phone ────────────────────────────────────────────
//
// None of the phone bar's six slots is the dock, so the palette names every
// button the desk bar carries: the dock's faces, the snapshots and the history
// walk. The dock they open is a full screen, not a 340px column
// against the edge of a 375px one.
//
// Every project has five buttons and four faces, the demo included, whose
// Assistant answers from the demo model. The rows about a signed-in
// Ask face run on a local project at the foot of this file, and skip on every
// engine but Chromium, since a local project needs the File System Access
// API.
//
// The dock's rooms are also swept with the suite's reach probe, which only
// opening a face puts in front of a thumb.

import { expect, test, type Page } from "@playwright/test";
import {
  isCoarsePointer,
  MIN_INPUT_FONT,
  MIN_TAP,
  openDemoEditor,
  paletteCommand,
  smallTapTargets,
} from "./probe-mobile";
import { dockTabs, TAB_AIR } from "./probe";
import {
  openSignedInProject,
  skipWithoutLocalFolders,
} from "./signedInProject";

/** Runs a palette command by its visible name. */
async function throughPalette(page: Page, name: string) {
  await page.getByRole("button", { name: "Palette" }).click();
  await paletteCommand(page, name).click();
}

/**
 * Asserts that the sheet's close is on the screen, whole and under the thumb,
 * that the tabs that gave it room are still legible, and that it closes the
 * sheet. Shared by the demo's three-tab head and a signed-in project's
 * four-tab one.
 */
async function wayOutOfTheSheet(page: Page) {
  const win = page.viewportSize();
  if (!win) throw new Error("no viewport");

  const close = await page.locator(".dock-close").boundingBox();
  if (!close) throw new Error("no close");
  expect(close.x, "the close starts off the left edge").toBeGreaterThanOrEqual(
    0,
  );
  expect(
    Math.round(close.x + close.width),
    "the close ends off the right edge",
  ).toBeLessThanOrEqual(win.width);
  expect(Math.round(close.width)).toBeGreaterThanOrEqual(MIN_TAP);

  // A clipped ancestor removes hit-testing too, so the thumb must land on the
  // button itself.
  const reaches = await page.locator(".dock-close").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!at && el.contains(at);
  });
  expect(reaches, "something else is under the close's centre").toBe(true);

  // The tabs compress to make room and stay readable: they are fitted,
  // so every word keeps air on both sides and the thumb lands on the
  // chosen one.
  const { air, thumbOff } = await dockTabs(page);
  for (const tab of air) {
    expect(tab.left, `${tab.label} left`).toBeGreaterThanOrEqual(TAB_AIR);
    expect(tab.right, `${tab.label} right`).toBeGreaterThanOrEqual(TAB_AIR);
  }
  expect(Math.abs(thumbOff.x)).toBeLessThan(0.5);
  expect(Math.abs(thumbOff.width)).toBeLessThan(0.5);

  await page.locator(".dock-close").click();
  await expect(page.locator(".ed-dock-sheet")).toHaveCount(0);
}

test.describe("the editor's buttons on a phone", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
  });

  test("the palette names every button the desk bar carries", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Palette" }).click();
    // Named individually rather than counted, so a rename fails here.
    for (const name of ["Reference", "Notes", "Snapshots", "History"]) {
      await expect(paletteCommand(page, name)).toBeVisible();
    }
    // The demo's Assistant answers from the demo model, so its palette
    // carries the Ask command too.
    await expect(paletteCommand(page, "Enlighten!")).toBeVisible();
  });

  test("a face opens as a full screen, with the manuscript inert", async ({
    page,
  }) => {
    await throughPalette(page, "Reference");
    const sheet = page.locator(".ed-dock-sheet");
    await expect(sheet).toBeVisible();

    const box = await sheet.boundingBox();
    const win = page.viewportSize();
    if (!box || !win) throw new Error("no sheet or no viewport");
    // The whole width, not a column beside 35px of unusable prose.
    expect(Math.round(box.width)).toBe(win.width);

    // A modal on the same scrim as the structure sheet, so the prose behind it
    // is unreachable, not merely dimmed.
    await expect(page.locator(".editor-shell")).toHaveAttribute("inert", "");
  });

  test("each of the demo's reference faces is reachable, and nothing in them is under the floor", async ({
    page,
  }) => {
    // The faces after Ask, entered through Reference. The Ask face has
    // controls under the floor, swept in the quarantined row at the foot of
    // this file.
    await throughPalette(page, "Reference");
    for (const face of ["Reference", "Notes", "Snapshot"]) {
      await page
        .locator(".dock-head")
        .getByRole("button", { name: face })
        .click();
      await expect(page.locator(".dock-face").first()).toBeVisible();
      const small = await smallTapTargets(page, MIN_TAP, ".dock-face");
      expect(small, `${face}: controls under ${MIN_TAP}px`).toEqual([]);
    }
  });

  test("the way out of the sheet is on the screen", async ({ page }) => {
    // On a phone the close is a 44px tap target and the head can exceed the
    // screen. Flexbox puts the overflow on the last item, the close, and the
    // sheet's `overflow: hidden` clips its paint and its hit-testing, so the
    // tabs give instead.
    //
    // The demo's head is the four-tab head.
    await throughPalette(page, "Reference");
    await wayOutOfTheSheet(page);
  });

  test("the Ask face's asking stack is opaque over the prose, its field off the iOS zoom", async ({
    page,
  }) => {
    await throughPalette(page, "Enlighten!");
    await page
      .locator(".ai-empty")
      .getByRole("button", { name: "New chat", exact: true })
      .click();
    await page.getByRole("menuitem").first().click();
    const field = page.locator(".ed-dock-sheet .composer textarea");
    await expect(field).toBeVisible();

    // The sheet lies over the manuscript, and a translucent or frosted pane
    // over the writer's own prose is illegible. The sheet is portalled out
    // of the editor shell, so only a rule that reaches it there applies.
    const stack = await page
      .locator(".ed-dock-sheet .ai-asking")
      .evaluate((el) => {
        const style = getComputedStyle(el);
        // `rgba(r, g, b, a)`, or `color(srgb r g b / a)` for a mix; no
        // alpha written is opaque.
        const alpha =
          /\/\s*([\d.]+)\s*\)$/.exec(style.backgroundColor) ??
          /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(style.backgroundColor);
        return {
          alpha: alpha ? Number(alpha[1]) : 1,
          frost:
            style.backdropFilter ||
            style.getPropertyValue("-webkit-backdrop-filter") ||
            "none",
        };
      });
    expect(stack.alpha).toBe(1);
    expect(stack.frost).toBe("none");

    // iOS zooms the page on focus into a field under 16px, and offers no way
    // back but a pinch.
    if (await isCoarsePointer(page)) {
      const size = await field.evaluate((el) =>
        parseFloat(getComputedStyle(el).fontSize),
      );
      expect(size).toBeGreaterThanOrEqual(MIN_INPUT_FONT);
    }
  });

  test("Escape gives the manuscript back", async ({ page }) => {
    await throughPalette(page, "Notes");
    await expect(page.locator(".ed-dock-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".ed-dock-sheet")).toHaveCount(0);
    await expect(page.locator(".editor-shell")).not.toHaveAttribute(
      "inert",
      "",
    );
  });

  test("one sheet at a time: the dock takes the bar with it", async ({
    page,
  }) => {
    // On a phone the dock and the structure sheet never stack.
    // Both are modals on the shared scrim, each making the shell, the bar
    // included, inert, and the structure button lives in the bar, so with the
    // dock open there is no route to a second sheet.
    await throughPalette(page, "Reference");
    await expect(page.locator(".ed-dock-sheet")).toBeVisible();

    const structure = page.getByRole("button", { name: "Project structure" });
    await expect(structure).toBeVisible();
    // Visible behind the scrim and unreachable: `inert` removes it from
    // hit-testing, so its point belongs to the scrim.
    const reaches = await structure.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(
        r.x + r.width / 2,
        r.y + r.height / 2,
      );
      return !!at && el.contains(at);
    });
    expect(reaches).toBe(false);
    await expect(page.locator(".doc-tree-sheet")).toHaveCount(0);
  });

  test("the back gesture closes the face it opened, not itself, not the board it replaced", async ({
    page,
  }) => {
    // The board closing and the face opening are one handler (`onClose()`
    // then `command.run()`), batched into one commit. The same-tick handoff
    // in `useBackCloses.ts` offers the board's history entry to the face
    // rather than popping it from under the face that just opened, which
    // would close the face at once.
    const url = page.url();
    await throughPalette(page, "Reference");
    await expect(page.locator(".ed-dock-sheet")).toBeVisible();

    await page.goBack();

    await expect(page.locator(".ed-dock-sheet")).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(page.locator(".editor").first()).toBeVisible();
  });

  test("the history walk's controls are on the screen, not off its left edge", async ({
    page,
  }) => {
    // The history walk takes the paper over and the bar stands down for it.
    // Its chrome is placed against the prose column's left margin, which the
    // phone does not have, so its controls must still land on the screen.
    await throughPalette(page, "History");
    const win = page.viewportSize();
    if (!win) throw new Error("no viewport");

    for (const name of [
      "Step to an older revision",
      "Step toward Now",
      "Cancel",
    ]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      if (!box) throw new Error(`no ${name}`);
      expect(box.x, `${name} starts off-screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name} ends off-screen`).toBeLessThanOrEqual(
        win.width,
      );
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(MIN_TAP - 1);
    }

    // The scrub marker too: it hangs 3px left of the rail line, so a line at
    // x 0 puts it off the edge.
    const marker = await page.locator(".rev-rail-head").first().boundingBox();
    expect(marker?.x ?? -1).toBeGreaterThanOrEqual(0);
  });
});

// ── The Ask face and four-tab head ───────────────────────────────────────────
//
// These rows open a signed-in local project, whose Ask face reaches the
// writer's own models. Each skips on engines without the File System Access
// API, and off the phone plane.
test.describe("the Ask face on a phone, signed in", () => {
  test.beforeEach(async ({ page, browserName }) => {
    skipWithoutLocalFolders(browserName);
    await openSignedInProject(page);
    test.skip(
      (await page.locator(".editor-shell").getAttribute("data-phone")) !== "1",
      "not the phone plane",
    );
  });

  test("each of the four faces is reachable, and nothing in them is under the floor", async ({
    page,
  }) => {
    // The demo's other three faces are swept above.
    await throughPalette(page, "Enlighten!");
    // The empty room first: its chip is the only button there, and the sweep
    // below creates a chat before it measures, so a missing `dock-face` class
    // on the empty state would otherwise pass.
    expect(await smallTapTargets(page, MIN_TAP, ".dock-face")).toEqual([]);
    // Then the Ask face with a chat open: the empty state renders almost none
    // of its controls, and a scoped sweep of the face's subtree sees the
    // classless ones (`+`, the new-chat kinds, the run buttons) with no label
    // filter. New chat is a menu of chat kinds, and the context is its own
    // dialog on the scrim, so it is swept as its own room and closed before
    // the tabs, which it would otherwise cover.
    await page
      .locator(".ai-empty")
      .getByRole("button", { name: "New chat", exact: true })
      .click();
    await page.getByRole("menuitem").first().click();
    await expect(page.locator(".composer")).toBeVisible();
    await page.getByRole("button", { name: "Context" }).click();
    await expect(page.locator(".ai-source-list")).toBeVisible();
    // The dialog has an entrance, and a row measured mid-entrance reads under
    // its 44px while rounding to 44, so it settles first.
    await page
      .locator(".ai-context-dialog")
      .evaluate((el) =>
        Promise.all(
          el.getAnimations({ subtree: true }).map((a) => a.finished),
        ).then(() => undefined),
      );
    expect(
      await smallTapTargets(page, MIN_TAP, ".ai-context-dialog"),
      `context: controls under ${MIN_TAP}px`,
    ).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".ai-source-list")).toHaveCount(0);
    for (const face of ["Enlighten!", "Reference", "Notes", "Snapshot"]) {
      await page
        .locator(".dock-head")
        .getByRole("button", { name: face })
        .click();
      await expect(page.locator(".dock-face").first()).toBeVisible();
      const small = await smallTapTargets(page, MIN_TAP, ".dock-face");
      expect(small, `${face}: controls under ${MIN_TAP}px`).toEqual([]);
    }
  });

  test("the way out of the four-tab sheet is on the screen", async ({
    page,
  }) => {
    // The four-tab head, the widest the sheet carries.
    await throughPalette(page, "Enlighten!");
    await expect(page.locator(".dock-head .ui-bar-track button")).toHaveCount(
      4,
    );
    await wayOutOfTheSheet(page);
  });

  // While a command is typed the field's own text is transparent and an
  // aria-hidden mirror draws the glyphs, so the two share every metric, or
  // the caret and the selection wash follow invisible glyphs of another size.
  // The coarse-pointer block lifts the field to `--tap-font`,
  // so it must lift `.composer-mirror` with it.
  test("the command mirror draws on the field's own metrics", async ({
    page,
  }) => {
    // The composer is the Assistant's, so this runs signed in.
    await throughPalette(page, "Enlighten!");
    await page.getByRole("button", { name: "New chat", exact: true }).click();
    await page.getByRole("menuitem").first().click();
    const field = page.locator(".composer textarea");
    await field.fill("/where the car crash happened on the bridge at night");
    const mirror = page.locator(".composer-mirror");
    await expect(mirror).toBeVisible();
    const metrics = (selector: string) =>
      page.locator(selector).evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          padding: style.padding,
          fontFamily: style.fontFamily,
        };
      });
    expect(await metrics(".composer-mirror")).toEqual(
      await metrics(".composer textarea"),
    );
  });
});
