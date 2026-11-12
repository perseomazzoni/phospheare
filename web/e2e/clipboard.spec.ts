// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Cut, copy, paste and select-all in a real browser, since jsdom cannot
// measure layout or carry a clipboard: select-all scopes to the editor, not
// the page; cut removes the selection as one undo step; paste inserts through
// the `ClipboardEvent` path the view owns. The codec's contract suite pins
// rich-HTML correctness; this pins the wiring.

import { expect, test } from "@playwright/test";

import { glideSettled } from "./probe";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
});

test("select-all scopes to the document, not the page", async ({ page }) => {
  const editor = page.locator(".editor");
  await editor.click();
  await page.keyboard.type("one");
  await page.keyboard.press("Control+a");
  // Both ends of the selection lie inside the editor, and the typed text is
  // in it: the page's own controls were not selected.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sel = window.getSelection();
        const editor = document.querySelector(".editor");
        if (!sel || !editor || sel.rangeCount === 0) return "no selection";
        const inside =
          editor.contains(sel.anchorNode) && editor.contains(sel.focusNode);
        return inside ? sel.toString() : "outside the editor";
      }),
    )
    .toContain("one");
});

test("cut removes the selection and a single undo restores it", async ({
  page,
}) => {
  const editor = page.locator(".editor");
  await editor.click();
  await page.keyboard.type("The storm came without warning.");
  const before = await editor.textContent();

  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+x");

  // Everything is cut; the engine holds a single empty paragraph.
  await expect(editor).toHaveText("");

  // One undo puts the whole document back (one history step, not per-char).
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText(before ?? "");
});

test("paste inserts the clipboard text and a single undo removes it", async ({
  page,
}) => {
  const editor = page.locator(".editor");
  await editor.click();
  await editor.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "Pasted line");
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: dt });
    el.dispatchEvent(ev);
  });
  await expect(editor).toContainText("Pasted line");

  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("Pasted line");
});

// The wash is the browser's paint and the bars are the component's. A reflow
// moves the wash without touching the selection, so after the layout changes
// each bar must still bracket the selection's glyph box, half a leading out on
// each side, at the new geometry. The disturbance is a window resize, because
// the typewriter's station owns scrolling and fights a manual scroll back.
//
// Three conditions make the reflow real. The prose must wrap, or
// a resize rewraps nothing. The window must cross to the phone plane: the
// column is measure-locked at 680px at every desk width and the station
// re-centres on a caret move, not a resize, so a desk-plane resize moves
// nothing. And the baseline must be read after the select-all glide settles,
// or it measures the tail of that glide rather than the reflow.

test("the selection bars follow the wash when the layout reflows", async ({
  page,
}) => {
  const editor = page.locator(".editor");
  await editor.click();
  await editor.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData(
      "text/plain",
      // Long enough to wrap at every column the editor draws, so narrowing it
      // re-lays the selection out.
      Array.from(
        { length: 12 },
        (_, i) =>
          `Paragraph ${i} runs on for a good long while so that it certainly ` +
          `wraps across more than one line at any column width the editor is ` +
          `willing to draw.`,
      ).join("\n"),
    );
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: dt });
    el.dispatchEvent(ev);
  });
  await page.keyboard.press("Control+a");

  const bar = page.locator(".selection-bar").first();
  await expect(bar).toBeVisible();

  const geometry = () =>
    page.evaluate(() => {
      const sel = window.getSelection();
      const rect = sel?.rangeCount
        ? sel.getRangeAt(0).getClientRects()[0]
        : null;
      const barEl = document
        .querySelector(".selection-bar")
        ?.getBoundingClientRect();
      if (!rect || !barEl) return null;
      return {
        top: barEl.top,
        above: rect.top - barEl.top,
        below: barEl.bottom - rect.bottom,
      };
    });

  // Settled before the baseline is read. Select-all hands the
  // station a new caret, so the typewriter is gliding the page when the
  // paste finishes. The poll below asks whether the bars moved from `before`,
  // and a mid-glide baseline makes that a coin toss.
  await glideSettled(page);

  const before = await geometry();
  expect(before).not.toBeNull();
  // The baseline is a resting state: the invariant the poll re-checks after
  // the reflow already holds here.
  expect(Math.abs(before!.above - before!.below)).toBeLessThan(1);
  expect(before!.above).toBeGreaterThan(0);

  // Past the phone plane the column shrinks from 680 to 468, the selection's
  // lines rewrap, and the wash moves with them. The bars re-measure on every
  // scroll and resize event, so they must bracket the wash with the leading
  // split evenly and must have moved, which proves they re-measured.
  await page.setViewportSize({ width: 500, height: 560 });

  const settled = before as { top: number };
  await expect
    .poll(async () => {
      const g = await geometry();
      if (!g) return null;
      const bracketing = Math.abs(g.above - g.below) < 1 && g.above > 0;
      const moved = Math.abs(g.top - settled.top) > 1;
      return bracketing && moved ? g : null;
    })
    .toBeTruthy();
});
