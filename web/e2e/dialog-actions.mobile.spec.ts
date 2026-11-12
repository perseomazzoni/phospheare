// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// No dialog action's text leaves its own button on a phone.
// Actions sharing one row on a 375px screen get a fraction of it each, and a
// label too long for its button paints above and below it, white text on the
// grey foot, so the words naming the destructive action vanish. Below the
// phone plane each action takes a row of its own, so a label's length stops
// mattering. The assertions are about the text and the rows, which hold
// whatever a locale's words are.
//
// The sign-out question carries the longest destructive labels and is behind
// sign-in, so each row signs in first.

import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

async function openSignOut(page: Page) {
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Who you are" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".ui-dialog-foot")).toBeVisible();
  // The sheet arrives animated; a box read mid-entrance is scaled.
  await page
    .locator(".ui-dialog:has(.ui-dialog-foot)")
    .first()
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
}

test("no action's label leaves its own button", async ({ page }) => {
  await openSignOut(page);

  const actions = await page.evaluate(() => {
    const foot = document.querySelector<HTMLElement>(".ui-dialog-foot")!;
    return [...foot.querySelectorAll<HTMLElement>("button")].map((button) => {
      const box = button.getBoundingClientRect();
      // The text's own box: `scrollWidth` cannot see the escape, because the
      // overflow is vertical and `overflow` is `visible`, so the text wraps
      // rather than widening the element.
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      return {
        label: button.innerText.trim(),
        spillsBelow: Math.round(text.bottom - box.bottom),
        spillsAbove: Math.round(box.top - text.top),
        height: Math.round(box.height),
      };
    });
  });

  expect(actions.length).toBeGreaterThanOrEqual(2);
  for (const action of actions) {
    // A centred label too tall for its button escapes at both ends at once.
    expect(action.spillsBelow, `"${action.label}" below`).toBeLessThanOrEqual(
      0,
    );
    expect(action.spillsAbove, `"${action.label}" above`).toBeLessThanOrEqual(
      0,
    );
  }
});

test("and every action still clears the reach floor", async ({ page }) => {
  // Legibility is not bought with a shorter button: a thumb lands on this
  // dialog's actions.
  await signIn(page);
  await page.goto("/app/settings");
  await page.getByRole("button", { name: "Who you are" }).click();
  // The page under the dialog has its own height, and on a short window it
  // can already pass the bottom edge. Only what the dialog adds is its fault.
  const pageBefore = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".ui-dialog-foot")).toBeVisible();
  await page
    .locator(".ui-dialog:has(.ui-dialog-foot)")
    .first()
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))),
    );

  const seen = await page.evaluate(() => {
    const foot = document.querySelector<HTMLElement>(".ui-dialog-foot")!;
    const heights = [...foot.querySelectorAll<HTMLElement>("button")].map((b) =>
      Math.round(b.getBoundingClientRect().height),
    );
    const actions = foot.getBoundingClientRect();
    return {
      shortest: Math.min(...heights),
      tap: parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--tap"),
      ),
      // Stacked actions are taller than one row; they must still end at
      // the bottom of the window rather than past it. Below 720 the sheet
      // is bounded by the window; above it a tall dialog scrolls in the
      // scrim and its foot sticks to the scrim's bottom edge.
      offBottom: Math.round(actions.bottom - window.innerHeight),
      pageAfter: document.documentElement.scrollHeight,
    };
  });

  expect(seen.shortest).toBeGreaterThanOrEqual(seen.tap);
  expect(seen.offBottom).toBeLessThanOrEqual(0);
  expect(seen.pageAfter).toBeLessThanOrEqual(pageBefore);
});

test("below the phone plane, every action has a row of its own", async ({
  page,
}) => {
  // Above 720px the dialog keeps the desk's row (`dialog-actions.spec.ts`).
  test.skip(
    page.viewportSize()!.width > 720,
    "the window is wider than the phone plane",
  );
  await openSignOut(page);

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".ui-dialog-foot button")].map(
      (button) => {
        const r = button.getBoundingClientRect();
        return { label: button.innerText.trim(), top: r.top, bottom: r.bottom };
      },
    ),
  );

  expect(rows.length).toBeGreaterThanOrEqual(2);
  const down = [...rows].sort((a, b) => a.top - b.top);
  for (let i = 1; i < down.length; i++) {
    // Half a pixel for the rounding of fractional device pixels.
    expect(
      down[i].top,
      `"${down[i].label}" shares a row with "${down[i - 1].label}"`,
    ).toBeGreaterThanOrEqual(down[i - 1].bottom - 0.5);
  }
});
