// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The structure panel by finger. A phone has no hover and a soft keyboard has
// no F2, so a row's actions sit in an overflow that is always there rather
// than behind a hover. The panel scrolls under the same motion that arms a
// drag, so the drag does not answer to a touch pointer, and `Move…` instead
// draws a landing in every gap the node can sit in, in the panel at the depth
// it would land at, so the writer looks at the place while choosing it.
//
// These run on the device profiles, where `hasTouch` is set and a tap is a
// touch pointer. `DocumentTree.test.tsx` pins the same behaviour through
// synthetic events; this file proves the emulated finger reaches it.

import { expect, test } from "@playwright/test";
import { openDemoEditor, openStructurePanel } from "./probe-mobile";

/** The panel, opened the way a writer on a phone would open it. */
async function openPanel(page: import("@playwright/test").Page) {
  await openDemoEditor(page);
  await openStructurePanel(page);
  await expect(page.locator(".dt-row").first()).toBeVisible();
  // A row is visible before its title is painted, so a snapshot taken when
  // the first row appears can capture empty rows. The wait is for text, not
  // for a box.
  await expect(page.locator(".dt-row").first()).toHaveText(/\S/);
}

const row = (page: import("@playwright/test").Page, title: string) =>
  page.locator(".dt-row").filter({ hasText: title }).first();

test("a row's actions are reachable with no hover at all", async ({ page }) => {
  await openPanel(page);

  // Present at rest, proved by the tap: `toBeVisible` alone does not prove a
  // control can be tapped.
  const more = row(page, "The First Light").getByLabel("Actions for");
  await more.tap();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Words, not glyphs. A Section, so no "Add inside". Select is the finger's
  // way into ticking rows to move together, since the row's box is revealed
  // by hover. The demo has an assistant, so a Section also offers its
  // summary.
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Rename",
    "Select",
    "Move…",
    "Create summary",
    "Move to the bin",
  ]);
});

test("Move… lands the section where the finger says, in the panel", async ({
  page,
}) => {
  await openPanel(page);

  await row(page, "The First Light").getByLabel("Actions for").tap();
  await page.getByRole("menuitem", { name: "Move…" }).tap();

  // Every landing is a real target in the panel, not a description of one.
  const landings = page.locator(".dt-landing");
  await expect(landings.first()).toBeVisible();
  await expect(page.locator(".dt-moving")).toContainText("Moving");

  const first = landings.first();
  const label = await first.getAttribute("aria-label");
  await first.tap();

  await expect(page.locator(".dt-landing")).toHaveCount(0);
  await expect(page.locator(".dt-toast")).toContainText("Moved");
  // The landing names where it goes.
  expect(label).toBeTruthy();
});

test("Select, a second tick and Move… land two sections in one tap", async ({
  page,
}) => {
  await openPanel(page);

  await row(page, "The First Light").getByLabel("Actions for").tap();
  await page.getByRole("menuitem", { name: "Select" }).tap();

  // Ticking is a mode: every Section offers its box, with no hover.
  const bar = page.locator(".dt-selecting");
  await expect(bar).toContainText("1 Section selected");
  // By the box's full name: "The Flame" is also inside "Ten — The Flame",
  // a Part, which offers no box while Sections are being ticked.
  await page.getByRole("checkbox", { name: "Select “The Flame”" }).tap();
  await expect(bar).toContainText("2 Sections selected");

  await bar.getByRole("button", { name: "Move…" }).tap();
  await expect(page.locator(".dt-moving")).toContainText("Moving 2 Sections");
  await page.locator(".dt-landing").first().tap();

  await expect(page.locator(".dt-landing")).toHaveCount(0);
  await expect(page.locator(".dt-toast")).toContainText("Moved 2 Sections");
  await expect(bar).toHaveCount(0);
});

test("a finger scrolling the panel never moves anything", async ({ page }) => {
  await openPanel(page);
  const before = await page.locator(".dt-row").allInnerTexts();

  // A press on a row, then travel down the panel: how a thumb scrolls a list.
  //
  // The press is a real touch: the guard reads `pointerType` on
  // `pointerdown`, so a finger it lets through arms the gesture. The travel is
  // dispatched, because Playwright's touchscreen offers only `tap` and mobile
  // WebKit has no wheel. An armed gesture would answer these moves; a refused
  // one cannot.
  const box = await row(page, "The First Light").boundingBox();
  expect(box).not.toBeNull();
  // The row's own left indent. `onPointerDown` is on `.dt-row` itself, so the
  // guard is armed from anywhere on it. The whole row opens its Section,
  // so on the phone plane the tap closes the sheet, and the rows
  // are read again with the panel back.
  const x = box!.x + 4;
  const y = box!.y + box!.height / 2;
  await page.touchscreen.tap(x, y);
  await page.evaluate(
    ([fromX, fromY]) => {
      for (const dy of [12, 40, 90]) {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: "touch",
            clientX: fromX,
            clientY: fromY + dy,
            bubbles: true,
          }),
        );
      }
      window.dispatchEvent(
        new PointerEvent("pointerup", { pointerType: "touch", bubbles: true }),
      );
    },
    [x, y],
  );

  await expect(page.locator(".dt-ghost")).toHaveCount(0);
  await expect(page.locator(".dt-drop-line")).toHaveCount(0);
  await expect(page.locator(".dt-toast")).toHaveCount(0);
  if (!(await page.locator(".dt-row").first().isVisible()))
    await openStructurePanel(page);
  expect(await page.locator(".dt-row").allInnerTexts()).toEqual(before);
});

// The whole row opens its node, not only the title. The indent is
// the spot furthest from the title, and the one a thumb lands on first.
test("a tap anywhere on a row opens it, not only on its title", async ({
  page,
}) => {
  await openPanel(page);
  const target = row(page, "The Memory of the Past");
  // A raw touchscreen tap does not scroll; on a short phone the row starts
  // below the sheet's fold.
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + 4, box!.y + box!.height / 2);

  if (!(await page.locator(".dt-row").first().isVisible()))
    await openStructurePanel(page);
  await expect(row(page, "The Memory of the Past")).toHaveClass(/\bactive\b/);
});

test("every control the panel's move mode adds is big enough to hit", async ({
  page,
}) => {
  await openPanel(page);
  await row(page, "The First Light").getByLabel("Actions for").tap();
  await page.getByRole("menuitem", { name: "Move…" }).tap();

  // The reach floor covers the overflow and the landings.
  // `reach.mobile.spec.ts` measures the panel at rest, and this mode is not
  // rest.
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const slack = 1 / (window.devicePixelRatio || 1);
    for (const el of document.querySelectorAll<HTMLElement>(
      ".dt-more, .dt-landing, .ui-menu button",
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height >= 44 - slack) continue;
      out.push(
        `${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`,
      );
    }
    return out;
  });
  expect(small).toEqual([]);
});
