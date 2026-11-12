// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Accessibility beyond the 44px target size: the keyboard reaches every
// control and can leave again, focus is visible, and every control has
// a name. The probes in `probe-mobile.ts` say how each fact must be measured,
// because a stylesheet read, a scripted `focus()`, a read of the focused
// element alone or a read on the same tick each misreport it.

import { expect, test } from "@playwright/test";
import {
  invisibleFocus,
  namelessControls,
  openDemoEditor,
  openStructurePanel,
} from "./probe-mobile";

test("the keyboard can leave the writing surface (WCAG 2.1.2)", async ({
  page,
}) => {
  await openDemoEditor(page);
  await page.locator(".editor").first().click();

  await page.keyboard.press("Tab");
  const after = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.className ?? "",
  );

  // The blur handler re-claims focus after a click on the chrome so the caret
  // is never stranded. Applied to the keyboard, that re-claim makes every
  // chrome control unreachable and the editor a keyboard trap.
  expect(after, "focus never left the writing surface").not.toContain("editor");
});

test("the caret is still in the prose after a click on the chrome", async ({
  page,
}) => {
  // After a click on the chrome, the writer's next keystroke goes into the
  // prose. This pins that guarantee, not the blur handler's re-claim: opening
  // a Section focuses the editor on its own, and a bar button never blurs it
  // because it prevents the default on pointerdown.
  //
  // The click is on the command bar, not a tree row. On the phone the
  // structure panel is a modal sheet portalled out of `.editor-shell`,
  // and a row click there leaves focus on `body`.
  await openDemoEditor(page);
  await page.locator(".editor").first().click();

  const bold = page.getByRole("button", { name: "Bold" });
  await expect(bold).toHaveCount(1);
  await bold.click();

  // Polled rather than slept past, so the assertion holds whichever async
  // mechanism returns focus.
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.activeElement as HTMLElement | null)?.className ?? "",
      ),
    )
    .toContain("editor");
});

test("every control that takes focus shows it", async ({ page }) => {
  await openDemoEditor(page);
  const offenders = await invisibleFocus(page);

  // `.editor` is the one exception: the caret is its indicator, as `editor.css`
  // states where it suppresses the ring, and a ring round the whole writing
  // surface would box the manuscript while the writer reads it.
  const unexplained = offenders.filter((o) => !o.label.includes("div.editor"));
  expect(unexplained, "controls whose focus cannot be seen").toEqual([]);
});

test("every control that takes focus has a name", async ({ page }) => {
  await openDemoEditor(page);
  await openStructurePanel(page);

  // The panel holds the icon-only controls: the chevrons, the ⋯ menus, the
  // summary buttons. To a screen reader an icon is a button called nothing,
  // and tooltips do not appear on touch, so on this plane a control has a
  // label only when a name is declared.
  expect(
    await namelessControls(page),
    "controls with no accessible name",
  ).toEqual([]);
});
