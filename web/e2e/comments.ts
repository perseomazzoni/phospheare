// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Commenting on a passage of the demo chapter the way a writer does, through
// the selection bubble, for the margin's browser specs.

import { expect, type Page } from "@playwright/test";

/** Comment on a passage of the demo chapter, from the selection bubble. */
export async function commentOn(page: Page, passage: string, body: string) {
  const bubble = page
    .locator(".ui-bubble")
    .getByRole("button", { name: "Comment", exact: true });
  // The selection is retried until the bubble answers, because the prose is
  // still being drawn in the first frames after the editor opens.
  await expect(async () => {
    await page.evaluate((words) => {
      const editor = document.querySelector<HTMLElement>(".editor");
      if (!editor) throw new Error("no editor");
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(words) ?? -1;
        if (at < 0) continue;
        editor.focus();
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + words.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      throw new Error(`"${words}" is not in the demo chapter`);
    }, passage);
    await expect(bubble).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await bubble.click();
  const composer = page.locator(".cm-draft");
  await composer.getByRole("combobox").fill(body);
  await composer.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(composer).toBeHidden();
}

/**
 * Presses one of the bar's comment controls. With a comment to walk to, they
 * sit in a fold (Previous, Comments, Next) whose row takes no pointer until
 * it opens, so the pointer reaches the fold first, as a writer's does.
 */
export async function pressCommentControl(
  page: Page,
  name: "Comments" | "Previous comment" | "Next comment",
) {
  const bar = page.locator(".bar-stack");
  const fold = bar.locator('[data-fold="comments"]');
  if (await fold.count()) {
    await fold.hover();
    await expect(fold).toHaveAttribute("data-open", "1");
  }
  await bar.getByRole("button", { name, exact: true }).click();
}
