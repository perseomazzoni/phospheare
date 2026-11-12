// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The margin on a phone. The prose runs to the screen's edge, so there
// is no room for a card beside a passage: the margin draws a dot at the
// paragraph's edge, and the dot opens the thread as a bottom sheet over the
// bar, the width of the screen. Above 720px the same dot opens a floating
// panel instead; that plane is the desk's, checked in `Margin.test.tsx`, so
// the wider touch profiles skip here.
//
// The demo book needs no account, and its margin lives in memory: a comment
// written here is gone on the next load.

import { expect, test } from "@playwright/test";
import { openDemoEditor } from "./probe-mobile";

const PASSAGE = "Tiny sparks";

test("a comment on a phone is a dot that opens the thread as a bottom sheet", async ({
  page,
}) => {
  const viewport = page.viewportSize();
  test.skip(
    !viewport || viewport.width > 720,
    "the sheet is the phone plane's; wider touch devices get the panel",
  );
  if (!viewport) return;
  await openDemoEditor(page);

  // The selection a long-press makes, made directly: the bubble listens for
  // the document's selection, not for the gesture. It is retried until the
  // bubble answers, because the prose is still settling when the editor
  // first shows and a selection made then lands on text about to be redrawn.
  const bubble = page
    .locator(".ui-bubble")
    .getByRole("button", { name: "Comment", exact: true });
  await expect(async () => {
    await page.evaluate((passage) => {
      const editor = document.querySelector<HTMLElement>(".editor");
      if (!editor) throw new Error("no editor");
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(passage) ?? -1;
        if (at < 0) continue;
        editor.focus();
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + passage.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      throw new Error(`"${passage}" is not in the demo chapter`);
    }, PASSAGE);
    await expect(bubble).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await bubble.click();
  const sheet = page.locator(".cm-float");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("combobox").fill("Does this earn its place?");
  await sheet.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(sheet).toBeHidden();

  // The dot sits inside the screen, by the passage's line.
  const dot = page.getByRole("button", { name: "Comment by You" });
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  await dot.click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Does this earn its place?");
  // A sheet: the screen's full width, standing on its bottom edge.
  const drawn = await sheet.boundingBox();
  expect(drawn).not.toBeNull();
  if (!drawn) return;
  expect(Math.round(drawn.x)).toBe(0);
  expect(Math.round(drawn.width)).toBe(viewport.width);
  expect(
    Math.abs(drawn.y + drawn.height - viewport.height),
  ).toBeLessThanOrEqual(1);

  // It closes in one tap, and the thread is kept.
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  await expect(dot).toBeVisible();
});
