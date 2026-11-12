// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Two type sizes on the phone ──────────────────────────────────────────────
//
// The phone plane draws its chrome at two type sizes: 13px for anything the
// writer reads as a label, 11px for facts (counts, indices, timestamps, key
// caps and the uppercase-tracked eyebrow voice). The desk scale packs eight
// sizes into four pixels, which on a 375px screen reads as a smudge, with half
// of them too small for a difference to be legible at arm's length.
//
// The CSS enumerates the classes it resizes, because a blanket descendant
// rule would take the prose and the 16px field floor with it, and an
// enumerated list misses the next new surface. So the assertion is that
// nothing on this plane is drawn at any other size, walked over every room a
// phone can open.
//
// It runs on every device profile to pin the split: `ipad-mini` (768) and
// `phone-landscape` (852) are touch devices off the phone plane and keep the
// desk scale, as 1280 does.

import { expect, test, type Page } from "@playwright/test";
import {
  openDemoEditor,
  openStructurePanel,
  paletteCommand,
  uiTypeSizes,
} from "./probe-mobile";
import {
  openSignedInProject,
  skipWithoutLocalFolders,
} from "./signedInProject";
import { START_MS } from "./start";

/** The two, and nothing else. */
const LABEL = 13;
const FACT = 11;

/** Every distinct size currently on screen, smallest first. */
async function sizes(page: Page): Promise<number[]> {
  const found = await uiTypeSizes(page);
  return [...new Set(found.map((s) => s.fontSize))].sort((a, b) => a - b);
}

/**
 * Asserts the plane's rule over whatever is on screen. A failure names each
 * offender with its size, such as `span.ref-card-label 12.5px`, which points
 * at the rule to fix.
 */
async function twoSizes(page: Page, where: string) {
  const found = await uiTypeSizes(page);
  expect(found.length, `${where}: nothing was measured`).toBeGreaterThan(0);
  const wrong = found.filter(
    (s) => s.fontSize !== LABEL && s.fontSize !== FACT,
  );
  expect(
    [...new Set(wrong.map((s) => `${s.label} ${s.fontSize}px`))],
    `${where}: drawn at a size that is neither ${LABEL} nor ${FACT}`,
  ).toEqual([]);
}

/** Whether this profile is on the plane the rule applies to. */
async function onPhonePlane(page: Page): Promise<boolean> {
  return (
    (await page.locator(".editor-shell").getAttribute("data-phone")) === "1"
  );
}

test.describe("the phone chrome speaks at two sizes", () => {
  test.beforeEach(async ({ page }) => {
    await openDemoEditor(page);
  });

  test("the structure sheet, its row menu and its preferences", async ({
    page,
  }) => {
    test.skip(!(await onPhonePlane(page)), "not the phone plane");
    await openStructurePanel(page);
    await twoSizes(page, "structure sheet");

    // The find face renders only behind a focused field or a query, so the
    // walk enters it; the search rows and the invitation and empty statements
    // are on the two-size scale.
    await page.getByPlaceholder("Find a name or a phrase…").click();
    await twoSizes(page, "find face");
    // The back control is the one-act way out of the find on every plane;
    // Escape would also close the structure sheet on a phone, which the row
    // menu step below still needs.
    await page.getByRole("button", { name: "Back to the contents" }).click();
    await expect(page.locator(".dt-search-group").first()).toBeHidden();

    // The row menu is a `.ui-menu` portalled to the body, whose sizes come
    // from `base.css`, not the editor.
    const rows = page.locator(".dt-row:visible");
    await expect(rows.first()).toHaveText(/\S/);
    await rows
      .first()
      .getByRole("button", { name: /^Actions for/ })
      .click();
    await expect(page.locator(".ui-menu")).toHaveCount(1);
    await twoSizes(page, "row menu");
    await page.keyboard.press("Escape");

    // The preferences, whose foot carries the one shared `.ui-btn` a phone
    // writer presses inside the editor.
    await page.getByRole("button", { name: "Writing preferences" }).click();
    const sheet = page.locator(".dt-prefs-sheet");
    await expect(sheet).toBeVisible();
    await sheet.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(
        () => undefined,
      ),
    );
    await twoSizes(page, "preferences sheet");
  });

  test("every surface the palette opens", async ({ page }) => {
    test.skip(!(await onPhonePlane(page)), "not the phone plane");
    // The palette first: it is a surface itself and the route to the other
    // surfaces. The demo has four; the Ask face needs an Assistant, so
    // its rooms are measured on a signed-in project below. The bar is tapped,
    // as on a phone: a click is a mouse that hovers, and a hover opens the
    // button's tooltip, which no phone writer sees.
    await page.getByRole("button", { name: "Palette" }).tap();
    await twoSizes(page, "palette");
    await page.keyboard.press("Escape");

    for (const control of ["Reference", "Notes", "Snapshots", "History"]) {
      await page.getByRole("button", { name: "Palette" }).tap();
      await paletteCommand(page, control).click();
      // The reference picker is a room behind the Reference face, a card's
      // add press, so the walk goes one press in and leaves
      // through the picker's own close. Escape would not do: on the phone the
      // dock is an overlay and `useOverlay`'s capture-phase keydown consumes
      // Escape for the top layer, closing the whole sheet.
      if (control === "Reference") {
        await page
          .locator(".ref-card-head")
          .filter({ hasText: "Worldbuilding" })
          .click();
        await page
          .getByRole("button", { name: "Add a section" })
          .first()
          .click();
        await expect(page.locator(".ref-picker")).toBeVisible();
        await twoSizes(page, "reference picker");
        await page.locator(".ref-picker-close").click();
        await expect(page.locator(".ref-picker")).toBeHidden();
        // One press further: the reader room, with the edit button, the edit
        // bar's verbs and the Tentative/Canon pair.
        await page
          .locator(".ref-card-head")
          .filter({ hasText: "Guidebook" })
          .click();
        await page.locator(".ref-card-row").first().click();
        await expect(page.locator(".dock-edit-btn")).toBeVisible();
        await twoSizes(page, "dock: Reference reader");
      }
      await twoSizes(page, `dock: ${control}`);
      await page.keyboard.press("Escape");
    }
  });

  test("the three exceptions survive it", async ({ page }) => {
    test.skip(!(await onPhonePlane(page)), "not the phone plane");

    // Prose. `--f-prose` and `--leading` are fixed for this plane and the
    // writer owns the size; the demo opens at the 19px default.
    const prose = await page
      .locator(".editor p")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(prose).toBeGreaterThan(LABEL);

    await openStructurePanel(page);
    // The field floor. 16px is a platform rule, since WebKit zooms the page
    // when a focused input is under it, and it outranks the two sizes for
    // inputs.
    const field = await page
      .locator(".doc-tree input[type='search'], .doc-tree input")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(field).toBeGreaterThanOrEqual(16);

    // The heading voice. A dialog's title says which room the writer is in,
    // and there is no second string on the sheet to say it instead.
    await page.getByRole("button", { name: "Writing preferences" }).click();
    const title = await page
      .locator(".dt-prefs-sheet .ui-dialog-title")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(title).toBeGreaterThan(LABEL);
  });

  test("a touch device that is not a phone keeps the desk scale", async ({
    page,
  }) => {
    test.skip(await onPhonePlane(page), "this is the phone plane");
    await openStructurePanel(page);

    // The authored sizes are still the authored sizes: 12.5 is `.dt-label`'s,
    // the string a writer reads most in the panel.
    const label = await page
      .locator(".dt-label")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(label).toBe(12.5);

    // The scale is still a scale: the rule that collapses it stops at 720.
    expect((await sizes(page)).length).toBeGreaterThan(2);
  });

  // The Desk is the demo's first frame, the room before "Continue writing",
  // so it is measured fresh before the tap. `.desk-thread code`
  // is not covered: the demo resume carries no marker, so the thread band
  // does not render on this fixture.
  test("the Desk, measured before any surface opens", async ({ page }) => {
    test.skip(!(await onPhonePlane(page)), "not the phone plane");
    await page.goto("/app/editor/demo");
    await expect(page.locator(".desk")).toBeVisible({ timeout: START_MS });
    await twoSizes(page, "desk");
  });
});

// ── The Ask face's rooms ─────────────────────────────────────────────────────
//
// The Ask face's rooms are walked on a signed-in project, whose Assistant is
// the writer's own rather than the demo model. The row skips on
// engines without the File System Access API a local project needs, and off
// the phone plane.
test.describe("the phone chrome speaks at two sizes, signed in", () => {
  test("every room in the Ask face", async ({ page, browserName }) => {
    skipWithoutLocalFolders(browserName);
    await openSignedInProject(page);
    test.skip(!(await onPhonePlane(page)), "not the phone plane");
    await page.getByRole("button", { name: "Palette" }).tap();
    await paletteCommand(page, "Enlighten!").click();
    // A fresh book has no chat, so the chatbar, the composer's quotation and
    // the context dialog's source rows appear only once a chat exists. The
    // empty state is measured first, as a room of its own, then a chat is
    // created from the New chat menu of chat kinds and its context dialog
    // opened.
    await twoSizes(page, "dock: Ask empty");
    await page
      .locator(".ai-empty")
      .getByRole("button", { name: "New chat", exact: true })
      .click();
    await twoSizes(page, "dock: Ask new-chat menu");
    await page.getByRole("menuitem").first().click();
    await expect(page.locator(".composer")).toBeVisible();
    await twoSizes(page, "dock: Ask with a chat");
    await page.getByRole("button", { name: "Context" }).click();
    await expect(page.locator(".ai-source-list")).toBeVisible();
    await twoSizes(page, "dock: Ask context panel");
    // The reader chat's context dialog: its "This reader has read" select
    // renders for no other kind. The dialog closes first, since it sits on the
    // scrim over the new-chat button.
    await page.keyboard.press("Escape");
    await expect(page.locator(".ai-source-list")).toHaveCount(0);
    await page.locator(".ai-new-chat").click();
    await page.getByRole("menuitem", { name: "Alpha reader" }).click();
    await page.getByRole("button", { name: "Context" }).click();
    await expect(page.getByText("This reader has read")).toBeVisible();
    await twoSizes(page, "dock: Ask reader context");
    await twoSizes(page, "dock: Enlighten!");
  });
});
