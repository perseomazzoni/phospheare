// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The writing surface is no keyboard trap on the desk: Tab leaves the prose,
// so a writer with a keyboard reaches Undo, Bold, Save and the structure
// panel. `a11y.mobile.spec.ts` pins the same claim on the phone profiles;
// `desktop` ignores `*.mobile.spec.ts` and the mobile projects match only it,
// so a claim that holds on both planes is written twice.

import { expect, test } from "@playwright/test";

async function openDemo(page: import("@playwright/test").Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await page.locator(".editor").first().waitFor();
}

test("Tab leaves the writing surface (WCAG 2.1.2)", async ({ page }) => {
  await openDemo(page);
  await page.locator(".editor").first().click();
  await page.keyboard.press("Tab");
  // Out of every writing surface and its children, and onto something: focus
  // dropped on the body has left the prose and reached nothing.
  const left = await page.evaluate(() => {
    const active = document.activeElement;
    return (
      active !== null &&
      active !== document.body &&
      ![...document.querySelectorAll(".editor")].some((surface) =>
        surface.contains(active),
      )
    );
  });
  expect(left, "focus left the writing surface for a control").toBe(true);

  // A control the writer can use: seen, enabled, named, and working from the
  // keyboard. Which control comes next is the Tab order's business, so its
  // own effect is not asserted, only that the key reaches it.
  const landed = page.locator(":focus");
  await expect(landed).toBeVisible();
  await expect(landed).toBeEnabled();
  await expect(landed).toHaveAccessibleName(/\S/);
  await landed.evaluate((control) =>
    control.addEventListener(
      "click",
      () => document.documentElement.setAttribute("data-e2e-activated", "1"),
      { once: true },
    ),
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-e2e-activated", "1");
});

test("the caret is still in the prose, and still lit, after a chrome click", async ({
  page,
}) => {
  // After a click on the chrome, the writer's next keystroke goes into the
  // prose. This pins that guarantee, not the blur handler's re-claim: a
  // `.dt-label` click does blur the editor, but opening a Section focuses it
  // again on its own, and a bar button never blurs it because it prevents the
  // default on pointerdown. No assertion here fails on the handler alone.

  await openDemo(page);
  await page.locator(".editor").first().click();
  await page.locator(".dt-label").first().click();

  const readState = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const caret = document.querySelector(
        ".fake-cursor",
      ) as HTMLElement | null;
      return {
        active: el?.className ?? "",
        caretHidden: caret ? caret.hidden : null,
      };
    });

  // Polled rather than slept past, so the assertion holds whichever async
  // mechanism returns focus.
  await expect.poll(async () => (await readState()).active).toContain("editor");
  const state = await readState();
  // And lit: a caret hidden while focus is back misstates where the next
  // keystroke lands.
  expect(state.caretHidden).toBe(false);
});
