// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Every dialog action stays inside its dialog on the desk. A
// dialog is 400px wide, so whether its actions fit in one row depends on
// their words. A
// `nowrap` row aligned to `flex-end` pushes the excess out the start edge,
// which does not scroll, and the dismissal is drawn outside the dialog, greyed
// against the scrim and still clickable.
//
// `scrollWidth === clientWidth` reports the foot clean, because the overflow
// leaves through the edge `scrollWidth` does not count. The assertion is
// about containment, which holds however the CSS achieves it, and it runs in
// two locales so it holds for translations not yet written.
//
// The sign-out question is behind a writer session, so each row signs in as
// a local writer first.

import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

// The tab and the action, per locale. Written here, not read from the locale
// JSON: a spec that derives its expectations from the file under test passes
// when both are wrong together.
const SPEECH = {
  en: { tab: "Who you are", signOut: "Sign out" },
  it: { tab: "Chi sei", signOut: "Esci" },
};

async function openSignOut(page: Page, words: (typeof SPEECH)["en"]) {
  await page.goto("/app/settings");
  await page.getByRole("button", { name: words.tab }).click();
  await page.getByRole("button", { name: words.signOut, exact: true }).click();
  await expect(page.locator(".ui-dialog-foot")).toBeVisible();
  // The dialog arrives animated; a box read mid-entrance is scaled.
  await page
    .locator(".ui-dialog:has(.ui-dialog-foot)")
    .first()
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>(
      ".ui-dialog:has(.ui-dialog-foot)",
    )!;
    const box = dialog.getBoundingClientRect();
    const foot = document.querySelector<HTMLElement>(".ui-dialog-foot")!;
    return [...foot.querySelectorAll<HTMLElement>("button")].map((button) => {
      const r = button.getBoundingClientRect();
      return {
        label: button.innerText.trim(),
        // Positive means the action has left the dialog on that side.
        outLeft: Math.round(box.left - r.left),
        outRight: Math.round(r.right - box.right),
        width: Math.round(r.width),
      };
    });
  });
}

for (const [lang, words] of Object.entries(SPEECH)) {
  test.describe(`sign-out actions (${lang})`, () => {
    test.use({ locale: lang === "it" ? "it-IT" : "en-GB" });

    test("every action stays inside the dialog that owns it", async ({
      page,
    }) => {
      await signIn(page);
      await openSignOut(page, words);

      const actions = await measure(page);
      expect(actions.length).toBeGreaterThanOrEqual(2);
      for (const action of actions) {
        // The first action in the row, the dismissal, is the one pushed out.
        expect(
          action.outLeft,
          `"${action.label}" past the left edge`,
        ).toBeLessThanOrEqual(0);
        expect(
          action.outRight,
          `"${action.label}" past the right edge`,
        ).toBeLessThanOrEqual(0);
      }
    });

    test("and no action has been squeezed to make it fit", async ({ page }) => {
      // Containment bought by shrinking the buttons would crush a label into
      // a box too small to print it, so each action keeps the width its own
      // text asks for.
      await signIn(page);
      await openSignOut(page, words);

      const spills = await page.evaluate(() => {
        const foot = document.querySelector<HTMLElement>(".ui-dialog-foot")!;
        return [...foot.querySelectorAll<HTMLElement>("button")].map(
          (button) => {
            const box = button.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(button);
            const text = range.getBoundingClientRect();
            return {
              label: button.innerText.trim(),
              spill: Math.round(
                Math.max(text.bottom - box.bottom, box.top - text.top),
              ),
            };
          },
        );
      });

      for (const action of spills) {
        expect(
          action.spill,
          `"${action.label}" text spill`,
        ).toBeLessThanOrEqual(0);
      }
    });
  });
}
