// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The typewriter holds the writing line at the centre of the surface, at the
// station. jsdom measures every rect as zero, so this drives the demo
// (`/app/editor/demo`: an in-memory book, no account, no picker) with
// `?debug=station` and reads the probe's readout (`.station-probe pre`) as
// the one source of truth, rather than a second formula in the test that
// could disagree with it. The readout repaints on every caret move and
// scroll, so a stale readout is itself a regression. Chromium may round
// `scrollTop` to integers, and the probe prints one decimal, enough to see a
// drift that matters.
//
// The rows pin that the ends of a section can reach the station, that the
// line stays put while typing, that a hand scroll trips off-station and the
// next keystroke brings the line home, and that the caret bar and, with line
// focus, the lit line stay on the writing line, never pinned to the station,
// so they never mark text they do not belong to.

import { expect, test } from "@playwright/test";
import {
  DOCK_BOUND,
  barPinned,
  litBand,
  glideSettled,
  readoutEventually,
} from "./probe";
import { START_MS } from "./start";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo?debug=station");
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "scroll",
    { timeout: START_MS },
  );
  // The demo opens on the Desk, a resume prompt standing in for the prose, so
  // a section must be open before there is a caret to measure.
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("checkbox", { name: "Typewriter Mode" }).click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "typewriter",
  );
});

test("a book that opens in typewriter mode settles its first line at the station", async ({
  page,
}) => {
  // The caret has never moved from position 0, so a docked readout here shows
  // the first line of a section reaching the station: the paper feed gives
  // the page room to scroll to it.
  const r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  expect(r.clamp).toBe("free");
  expect(r.scrollTop).toBeGreaterThan(0);
});

test("typing keeps the writing line at the station", async ({ page }) => {
  await page.locator(".editor p").first().click();
  await page.keyboard.type("The storm came without warning. ");
  let r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  expect(r.clamp).toBe("free");

  // A run of keystrokes must not drift the line toward the bottom of the
  // page.
  await page.keyboard.type("It kept coming. It kept coming. ");
  r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  expect(r.clamp).toBe("free");
});

test("a hand scroll trips off-station, and the next keystroke docks home", async ({
  page,
}) => {
  await page.locator(".editor p").first().click();
  await page.keyboard.type("One. ");
  let r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);

  // The dock's glide must have landed before the page is pulled by hand.
  // `readoutEventually` answers once the caret is within `DOCK_BOUND`, while
  // the 300ms glide is still running, and the glide's remaining frames would
  // overwrite the scroll below. The glide is asked directly: an
  // integer-rounded `scrollTop` sits still while the ease-out's tail has a
  // pixel to run.
  await glideSettled(page);

  // A real `scroll` event to the bottom, which the station machine reads as
  // the writer taking the page.
  await page.locator(".editor-surface").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  r = await readoutEventually(page, (c) => c.clamp === "at end");
  // The writing line went where the writer pulled it, far from the station.
  expect(Math.abs(r.delta)).toBeGreaterThan(DOCK_BOUND);

  // The next keystroke brings the line home.
  await page.keyboard.type("Two. ");
  r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  expect(r.clamp).toBe("free");
});

test("a hand scroll keeps the caret bar on the writing line while the text runs away", async ({
  page,
}) => {
  await page.locator(".editor p").first().click();
  await page.keyboard.type("One. ");
  let r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  // Docked: the bar sits on the writing line, which is the station.
  await barPinned(page, r.station);

  // The glide must land before the page is pulled, or its remaining frames
  // overwrite the hand scroll. `barPinned` answers once the bar
  // is within `DOCK_BOUND`, which is already true mid-glide.
  await glideSettled(page);

  // A hand scroll to the bottom: the writing line runs away and the bar runs
  // with it, because the caret bar marks the writing line, never the station.
  await page.locator(".editor-surface").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  r = await readoutEventually(page, (c) => c.clamp === "at end");
  expect(Math.abs(r.delta)).toBeGreaterThan(DOCK_BOUND);
  // The bar is on the writing line, the probe's caret, far from the station.
  expect(Math.abs(r.caret - r.station)).toBeGreaterThan(DOCK_BOUND);
  await barPinned(page, r.caret);

  // The next keystroke brings the writing line home; the bar comes with it.
  await page.keyboard.type("Two. ");
  r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  await barPinned(page, r.station);
});

test("a keystroke never leaves the focus highlight pointing at the root instead of the prose", async ({
  page,
}) => {
  // The demo opens with focus off; line focus is turned on from the
  // preferences panel the `beforeEach` left open.
  await page.getByRole("button", { name: "Line" }).click();
  await page.locator(".editor p").first().click();
  await page.keyboard.type("One. ");

  // A clean painted state first: the last keystroke's deferred repaint has
  // run, so the highlight's range sits inside a paragraph rather than
  // re-rooted onto the editor root.
  const rangeInProse = () =>
    page.evaluate(() => {
      const editor = document.querySelector("[contenteditable]") as HTMLElement;
      const hl = (
        globalThis.CSS as unknown as {
          highlights?: { get: (name: string) => unknown };
        }
      ).highlights?.get("focus") as
        { values: () => Iterator<unknown> } | undefined;
      const r = hl?.values().next().value as
        { startContainer: Node } | null | undefined;
      if (!r) return false;
      let n: Node | null = r.startContainer;
      while (n && n !== editor) {
        const tag = (n as Element).tagName;
        if (tag === "P" || tag === "H1" || tag === "H2") return true;
        n = n.parentElement;
      }
      return false;
    });
  await expect.poll(rangeInProse, { timeout: 15_000 }).toBe(true);

  // The doc path runs synchronously inside one `page.evaluate`, and the core
  // defers its repaint to a double rAF, so the highlight read right after the
  // dispatch is the post-patch state before any frame. `patchDocument`
  // replaces the typed paragraph by removing the old node, and the browser
  // re-roots the previous paint's live Range onto the editor root, a
  // degenerate range that paints nothing, so the whole column flashes dim on
  // every keystroke unless the dim is repainted in the same task as the patch.
  const afterInProse = await page.evaluate(() => {
    const editor = document.querySelector("[contenteditable]") as HTMLElement;
    const hl = (
      globalThis.CSS as unknown as {
        highlights?: { get: (name: string) => unknown };
      }
    ).highlights?.get("focus") as
      { values: () => Iterator<unknown> } | undefined;
    const inProse = (r: { startContainer: Node } | null | undefined) => {
      if (!r) return false;
      let n: Node | null = r.startContainer;
      while (n && n !== editor) {
        const tag = (n as Element).tagName;
        if (tag === "P" || tag === "H1" || tag === "H2") return true;
        n = n.parentElement;
      }
      return false;
    };
    const sel = window.getSelection()!;
    const p = editor.querySelector("p")!;
    const textNode = p.lastChild as Text;
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();
    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertText",
        data: "x",
        bubbles: true,
        cancelable: true,
      }),
    );
    return inProse(hl?.values().next().value);
  });
  expect(afterInProse).toBe(true);
});

test("line focus keeps its lit line on the writing line while the text runs away", async ({
  page,
}) => {
  // The demo opens with focus off; line focus is turned on from the
  // preferences panel the `beforeEach` left open.
  await page.getByRole("button", { name: "Line" }).click();
  await page.locator(".editor p").first().click();
  await page.keyboard.type("One. ");
  let r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  // Docked: the lit line is the writing line, which is the station, so the
  // station sits inside the lit band.
  await expect
    .poll(
      async () => {
        const lit = await litBand(page);
        return lit !== null && lit.top <= r.station && r.station <= lit.bottom;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // The `litBand` poll answers on a painted band, not a settled page, so the
  // hand scroll would race the glide's tail.
  await glideSettled(page);

  await page.locator(".editor-surface").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  r = await readoutEventually(page, (c) => c.clamp === "at end");
  expect(Math.abs(r.delta)).toBeGreaterThan(DOCK_BOUND);
  // Off-station, the lit line follows the writing line, not the station: the
  // caret sits inside the lit band, far from the station.
  await expect
    .poll(
      async () => {
        const lit = await litBand(page);
        return lit !== null && lit.top <= r.caret && r.caret <= lit.bottom;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await page.keyboard.type("Two. ");
  r = await readoutEventually(page);
  expect(Math.abs(r.delta)).toBeLessThanOrEqual(DOCK_BOUND);
  await expect
    .poll(
      async () => {
        const lit = await litBand(page);
        return lit !== null && lit.top <= r.station && r.station <= lit.bottom;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
