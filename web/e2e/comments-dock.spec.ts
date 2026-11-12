// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The margin beside the open dock. On the wide plane the dock lies over the
// editing surface's right side and the surface runs on under it, so the
// margin's room ends where the dock begins, not at the surface's edge: cards
// beside the prose when they fit, dots when they do not, and the thread's
// panel beside the dock either way.
//
// With the structure panel folded there is room left of the prose, so with
// comments to show the prose moves over to make a card column beside the dock
// (`data-margin`, the shift in `editor.css`). The widths below pin where that
// lands: cards at 1700 and 1440, dots at 1200, where the prose is already as
// far left as it goes.
//
// The demo book needs no account; its margin lives in memory.

import { expect, test, type Page } from "@playwright/test";
import { commentOn, pressCommentControl } from "./comments";
import { settleAnimations } from "./probe";

/** Every right edge the margin draws, against the dock's left edge. */
async function overDock(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const dock = document.querySelector(".ed-dock")?.getBoundingClientRect();
    if (!dock) throw new Error("no dock");
    return [...document.querySelectorAll(".cm-card, .cm-marker, .cm-float")]
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.right > dock.left)
      .map(
        ({ el, box }) =>
          `${el.className} ends at ${Math.round(box.right)}, the dock starts at ${Math.round(dock.left)}`,
      );
  });
}

/** Open the demo chapter at a width, with the dock open on Snapshots. */
async function withDock(
  page: Page,
  width: number,
  passages: string[],
  panel: "folded" | "open" = "folded",
) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  // With the structure panel folded, the room left of the prose is what the
  // margin's shift spends.
  if (panel === "folded") await page.locator(".dt-collapse").click();
  for (const passage of passages)
    await commentOn(page, passage, `About "${passage}"`);
  // Any face opens the dock at the same width; the demo has no spark.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toBeVisible();
  // The prose's move with the dock is a transition; measure after it.
  await settleAnimations(page);
}

const proseLeft = (page: Page) =>
  page.evaluate(
    () => document.querySelector(".editor")?.getBoundingClientRect().left ?? 0,
  );

test("putting the comments away takes the margin and its room with it", async ({
  page,
}) => {
  await withDock(page, 1440, ["Tiny sparks"]);
  await expect(page.locator(".cm-layer")).toHaveAttribute("data-mode", "cards");
  const moved = await proseLeft(page);
  const toggle = page
    .locator(".bar-stack")
    .getByRole("button", { name: "Comments", exact: true });
  await pressCommentControl(page, "Comments");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".cm-layer")).toHaveCount(0);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-margin",
    "0",
  );
  await settleAnimations(page);
  // Back to where the dock alone puts it: to the right of the margin's place.
  expect(await proseLeft(page)).toBeGreaterThan(moved + 40);
  // Put away, there is no walk, so the toggle stands alone.
  await toggle.click();
  await expect(page.locator(".cm-layer")).toHaveAttribute("data-mode", "cards");
});

test("Previous and Next comment walk the chapter's comments in reading order", async ({
  page,
}) => {
  await withDock(page, 1440, ["Tiny sparks", "people began to understand"]);
  const active = page.locator('.cm-card[data-active="1"] .cm-body');
  await pressCommentControl(page, "Next comment");
  await expect(active).toHaveText('About "Tiny sparks"');
  await pressCommentControl(page, "Next comment");
  await expect(active).toHaveText('About "people began to understand"');
  // Round the end, and back.
  await pressCommentControl(page, "Next comment");
  await expect(active).toHaveText('About "Tiny sparks"');
  await pressCommentControl(page, "Previous comment");
  await expect(active).toHaveText('About "people began to understand"');
});

const toggleComments = (page: Page) => pressCommentControl(page, "Comments");

for (const [width, panel, expected] of [
  [1700, "folded", "cards"],
  [1440, "folded", "cards"],
  [1200, "folded", "markers"],
  // The panel open leaves no room for cards.
  [1440, "open", "markers"],
] as const) {
  test(`at ${width}px, the panel ${panel}, the margin stays clear of the open dock`, async ({
    page,
  }) => {
    await withDock(page, width, ["Tiny sparks"], panel);
    await expect(page.locator(".editor-shell")).toHaveAttribute(
      "data-dock",
      "1",
    );
    await expect(page.locator(".cm-layer")).toHaveAttribute(
      "data-mode",
      expected,
    );
    expect(await overDock(page)).toEqual([]);

    // In dots, the thread opens in the panel, beside the dock too.
    const mode = await page.locator(".cm-layer").getAttribute("data-mode");
    if (mode === "markers") {
      await page.getByRole("button", { name: "Comment by You" }).click();
      await expect(page.locator(".cm-float")).toBeVisible();
      expect(await overDock(page)).toEqual([]);

      // And dots ask for no room: the prose stands where the dock alone
      // puts it, so putting the comments away moves nothing.
      await page.keyboard.press("Escape");
      const shown = await proseLeft(page);
      await toggleComments(page);
      await expect(page.locator(".cm-layer")).toHaveCount(0);
      await settleAnimations(page);
      expect(Math.abs((await proseLeft(page)) - shown)).toBeLessThan(1);
    }
  });
}
