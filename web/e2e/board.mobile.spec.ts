// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The board on a phone, measured with the board open.
// `reach.mobile.spec.ts` sweeps the landing page and the demo editor at rest
// and never opens the palette, and `probe-mobile.ts` leaves `input` out of the
// type walk, so neither sees an autofocused field under 16px, which zooms the
// page on iOS, or cells under the 44px floor.

import { expect, test, type Page } from "@playwright/test";

import { openDemoEditor } from "./probe-mobile";

// `ipad-mini` (768) and `phone-landscape` (852) are coarse and wide, so they
// take the desk branch: the board is a panel there, not a room. The reach
// floors below are a `(pointer: coarse)` claim and hold on every profile; the
// full-bleed ones are a `max-width: 720` claim and are gated on it.
const PHONE_PLANE = 720;

/** Opens the board as a writer on this plane does, by thumb. */
async function openBoard(page: Page) {
  await openDemoEditor(page);
  // The phone drops the titlebar, so the route is the command bar's
  // slot; above 720 it is the titlebar's button. Either way a pointing gesture
  // opens it, which makes the board live rather than the field.
  await page.getByRole("button", { name: "Palette" }).first().click();
  await expect(page.locator(".board")).toBeVisible();
  // The entrance finishes before anything is measured: `paletteIn` starts at
  // `scale(0.98)`, so a 44px cell read mid-animation measures under the floor.
  // The phone plane does not animate, so this waits only on the desk
  // branch.
  await page
    .locator(".board")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
}

test("every command is on screen at rest, grouped, with no keystroke", async ({
  page,
}) => {
  await openBoard(page);

  // Every command shows without typing: 25 rows at 44px behind a field would
  // be 1100px of scroll, hidden until the writer types, which a phone cannot
  // offer. The demo has an assistant, so Enlighten! is among them.
  await expect(page.locator(".board-cell")).toHaveCount(25);
  await expect(page.locator(".board-well")).toHaveCount(6);
});

test("the board clears both reach floors: the tap target and the 16px font", async ({
  page,
}) => {
  await openBoard(page);

  const measured = await page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>(".board-cell")];
    const field = document.querySelector<HTMLElement>(".board-filter")!;
    return {
      shortest: Math.round(
        Math.min(...cells.map((c) => c.getBoundingClientRect().height)),
      ),
      fieldHeight: Math.round(field.getBoundingClientRect().height),
      fieldFont: parseFloat(getComputedStyle(field).fontSize),
      autofocused: document.activeElement === field,
      tap: parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--tap"),
      ),
    };
  });

  // 44 is the smallest target a fingertip hits reliably.
  expect(measured.shortest).toBeGreaterThanOrEqual(measured.tap);
  expect(measured.fieldHeight).toBeGreaterThanOrEqual(measured.tap);
  // Below 16 WebKit zooms the page on focus.
  expect(measured.fieldFont).toBeGreaterThanOrEqual(16);
  // The field does not take focus: a pointing gesture opened the board, so it
  // is live and the soft keyboard stays down.
  expect(measured.autofocused).toBe(false);
});

test("it is a room, not a card lying on the manuscript", async ({ page }) => {
  test.skip(
    page.viewportSize()!.width > PHONE_PLANE,
    "a desk plane draws the board as a panel",
  );
  await openBoard(page);

  const room = await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>(".board")!;
    const box = board.getBoundingClientRect();
    const cs = getComputedStyle(board);
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      radius: cs.borderRadius,
      shadow: cs.boxShadow,
      animation: cs.animationName,
      // What the writer's finger lands on in the middle of the page.
      covers:
        document
          .elementFromPoint(box.width / 2, box.height / 2)
          ?.closest(".board") !== null,
    };
  });

  expect(room.x).toBe(0);
  expect(room.y).toBe(0);
  expect(room.width).toBe(page.viewportSize()!.width);
  expect(room.radius).toBe("0px");
  expect(room.shadow).toBe("none");
  // The scrim's fade is the whole entrance: a panel that is the page has
  // nowhere to arrive from, and travel on a full-bleed surface reads as
  // arrival from off-screen.
  expect(room.animation).toBe("none");
  expect(room.covers).toBe(true);
});

test("the exit is a button here, because a soft keyboard has no Esc", async ({
  page,
}) => {
  test.skip(
    page.viewportSize()!.width > PHONE_PLANE,
    "the desk keeps its Esc cap, and has an Esc key to go with it",
  );
  await openBoard(page);

  const head = await page.evaluate(() => {
    const cap = document.querySelector<HTMLElement>(".board-head .ui-kbd");
    const close = document.querySelector<HTMLElement>(".board-close")!;
    return {
      capShown: cap ? getComputedStyle(cap).display !== "none" : false,
      closeHeight: close.getBoundingClientRect().height,
    };
  });

  // The cap is a cost note about what a command costs on a desk, never the
  // sole statement of an exit.
  expect(head.capShown).toBe(false);
  // Rounded: the close is `var(--tap)` and lays out at 43.996 on a fractional
  // device pixel ratio, which is the floor met rather than missed.
  expect(Math.round(head.closeHeight)).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Close the palette" }).click();
  await expect(page.locator(".board")).toHaveCount(0);
});

test("the wells stay wells: cells wrap without their lines drifting apart", async ({
  page,
}) => {
  test.skip(
    page.viewportSize()!.width > PHONE_PLANE,
    "a 680px board fits its wells on one line, so nothing wraps to measure",
  );
  await openBoard(page);

  // The width guard is a proxy: a rotated phone at 667px takes the phone
  // branch, yet a 680px board fits its wells on one line there. So the wrap is
  // measured rather than inferred from the viewport, and a row with
  // nothing wrapped skips.
  const gaps = await page.evaluate(() => {
    const well = [...document.querySelectorAll(".board-well")].find(
      (w) => w.querySelectorAll(".board-cell").length > 2,
    )!;
    const tops = [
      ...new Set(
        [...well.querySelectorAll(".board-cell")].map((c) =>
          Math.round(c.getBoundingClientRect().top),
        ),
      ),
    ].sort((a, b) => a - b);
    const height = [
      ...well.querySelectorAll<HTMLElement>(".board-cell"),
    ][0].getBoundingClientRect().height;
    return tops.slice(1).map((top, i) => Math.round(top - tops[i] - height));
  });

  // A wrapped flex container defaults to `align-content: stretch`, which
  // spreads its lines to fill spare cross-axis height and widens the 6px gap
  // until the wells stop reading as groups.
  test.skip(
    gaps.length === 0,
    "no well wraps at this width, so there is no line spacing to measure",
  );
  for (const gap of gaps) expect(gap).toBe(6);
});
