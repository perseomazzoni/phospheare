// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The caret below the chrome ───────────────────────────────────────────────
//
// The fake cursor is a `position: fixed` div painted at viewport coordinates,
// so only its z-index keeps it off the floating UI. The caret belongs to the
// text plane: one step above the prose and beneath every floating surface,
// the command bar at 100, the structure panel at 105 and the dock at 115, the
// panels stacking over the bar. A caret below the chrome's 100 is below the
// panels too.
//
// Painting order is invisible to jsdom and to the DOM, since the caret is
// `pointer-events: none` and hit-testing never sees it, so the computed
// z-indices the renderer stacks by are asserted in a real browser.

import { expect, test, type Page } from "@playwright/test";
import { glideSettled } from "./probe";

/**
 * The first paragraph that holds prose. The demo's sections lead with empty
 * paragraphs, and a caret in an empty `<p><br></p>` has no client rects to
 * measure.
 */
const firstProse = (page: Page) =>
  page.locator(".editor p").filter({ hasText: /\S/ }).first();

test("the caret sits above the prose and below the floating chrome", async ({
  page,
}) => {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();

  // Focus on the prose, so the fake cursor is painted.
  await firstProse(page).click();
  await expect(page.locator(".fake-cursor")).toBeVisible();

  const read = async (sel: string) =>
    page
      .locator(sel)
      .evaluate((el) => Number(getComputedStyle(el as HTMLElement).zIndex));

  const caret = await read(".fake-cursor");
  const chrome = await read(".chrome");

  // One step above the text plane, never under the prose it marks.
  expect(caret).toBeGreaterThanOrEqual(1);

  // Beneath every floating surface. `.chrome`, the titlebar and command bar,
  // is the floor of the chrome ladder at 100, and the structure panel and the
  // dock stack above it, so one comparison against the lowest floating layer
  // bounds the caret against all of them.
  expect(caret).toBeLessThan(chrome);
});

// ── The caret back in view ───────────────────────────────────────────────────
//
// A free wheel-scroll can park the caret's paragraph above the command bar,
// where the z-index stack hides the caret. The text may flow under the bar,
// but once the writer touches the caret it is back in view: a keystroke never
// lands in hidden text, and a caret moved by arrows, PageUp, PageDown, Home or
// End never stays hidden. The z-index comparison above cannot see either, so
// both are asserted on the caret's own rect.
//
// The keep-in-band pull on the typing settle reveals a hidden caret only after
// the character is committed, so the typing test samples the caret every
// animation frame from the keydown on; the arrow test asserts that the move
// itself brings it back.

/** Open the demo book, open a section, and focus the prose. */
async function openEditorAndFocus(page: Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await firstProse(page).click();
  await expect(page.locator(".fake-cursor")).toBeVisible();
}

/** Floods the open section so the surface can scroll by a wide margin, then
 * waits for the keep-in-band settle to finish, or it would pull the page back
 * after the park below and undo the scenario. */
async function floodAndSettle(page: Page) {
  await page.keyboard.press("Control+End");
  const flood = Array.from(
    { length: 60 },
    () =>
      "The storm came in from the west, without warning, and by four the lane was gone.",
  ).join(" ");
  await page.keyboard.insertText(flood);
  await expect
    .poll(
      async () => {
        // Two reads three frames apart: a page still moving differs.
        const r = await page.evaluate(async () => {
          const s = document.querySelector(".editor-surface") as HTMLElement;
          const top = s.scrollTop;
          for (let frame = 0; frame < 3; frame++)
            await new Promise((done) => requestAnimationFrame(done));
          return {
            top,
            later: s.scrollTop,
            max: s.scrollHeight - s.clientHeight,
          };
        });
        return r.max > 1000 && r.top === r.later && r.top > 0;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  // A still `scrollTop` is not a finished glide: its tail moves less than a
  // pixel a frame, and a glide still running pulls the page back down after
  // the park below scrolls it up.
  await glideSettled(page);
}

/** Parks the caret on the first line of prose, then scrolls it up behind the
 * bar: the state a free wheel-scroll leaves. The caret is placed visibly
 * first, so the reveal on caret move has nothing to do, then hidden by a pure
 * scroll, which keep-in-band never reacts to, as when a writer scrolls.
 *
 * Two conditions hold the scenario:
 *
 *   * The paragraph holds text. A collapsed range inside an empty
 *     `<p><br></p>` has no client rects in Chromium. `measureCaretRect`
 *     (`views/writing/caret.ts`) inserts a transient zero-width space to work
 *     around that; this spec reads the native range directly, so an empty
 *     paragraph would give every assertion `null`.
 *
 *   * The scroll is computed from the bar and the caret, not a constant: the
 *     distance depends on how many blank paragraphs lead the section.
 *     Scrolling further than needed is still a pure scroll.
 */
async function parkCaretAboveBar(page: Page) {
  // Resolves a frame after the selection change has been heard, so the
  // editor's handling of it lands before the scroll that hides the caret.
  const parked = await page.evaluate(async () => {
    const editor = document.querySelector(".editor") as HTMLElement;
    const surface = document.querySelector(".editor-surface") as HTMLElement;
    const p = [...editor.querySelectorAll("p")].find(
      (el) => (el.textContent ?? "").trim().length > 0,
    );
    const first = p?.firstChild;
    if (!p || !first || first.nodeType !== Node.TEXT_NODE) return null;
    const heard = new Promise((done) =>
      document.addEventListener(
        "selectionchange",
        () => requestAnimationFrame(done),
        { once: true },
      ),
    );
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(first, 0);
    range.collapse(true);
    sel.addRange(range);
    surface.scrollTop = 0;
    await heard;
    return { text: (p.textContent ?? "").slice(0, 30) };
  });
  expect(
    parked,
    "no paragraph with text to park the caret in — the fixture leads with empty paragraphs and a collapsed range in one has no client rects",
  ).not.toBeNull();

  await page.evaluate(() => {
    const surface = document.querySelector(".editor-surface") as HTMLElement;
    const bar = document.querySelector(".chrome .ui-bar");
    const sel = window.getSelection()!;
    const rect = sel.rangeCount
      ? sel.getRangeAt(0).getClientRects()[0]
      : undefined;
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    // The caret's line a clear 40px above the bar's underside, whatever the
    // section's leading blank paragraphs.
    const wanted = rect ? rect.top - (barBottom - 40) : 200;
    surface.scrollTop = Math.min(
      surface.scrollHeight - surface.clientHeight,
      surface.scrollTop + Math.max(wanted, 200),
    );
  });
}

function readBarBottom(page: Page): Promise<number> {
  return page
    .locator(".chrome .ui-bar")
    .evaluate((el) => el.getBoundingClientRect().bottom);
}

/** The caret's top from the live range, not the painted div, in viewport
 * pixels, or `null` when the range has no rect. */
function trueCaretTop(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const sel = window.getSelection()!;
    const rects = sel.rangeCount ? sel.getRangeAt(0).getClientRects() : [];
    return rects.length ? rects[0].top : null;
  });
}

test("typing never lands a character in text hidden under the command bar", async ({
  page,
}) => {
  await openEditorAndFocus(page);
  await floodAndSettle(page);
  await parkCaretAboveBar(page);

  const barBottom = await readBarBottom(page);

  // The precondition: the caret's true rect sits above the bar.
  const trueTop = await trueCaretTop(page);
  expect(trueTop).not.toBeNull();
  expect(trueTop as number).toBeLessThan(barBottom);

  // The caret's true rect, sampled every animation frame from just before the
  // keystroke and tagged against the keydown's time, until 30 frames after
  // it. A frame after the keydown with the caret above the bar is a
  // keystroke in hidden text.
  await page.evaluate(() => {
    const w = window as unknown as {
      __samples: { top: number; t: number }[];
      __keyT: number;
      __done: boolean;
    };
    w.__samples = [];
    w.__keyT = 0;
    w.__done = false;
    const loop = () => {
      const sel = window.getSelection()!;
      const rects = sel.rangeCount ? sel.getRangeAt(0).getClientRects() : [];
      const t = performance.now();
      w.__samples.push({
        top: rects.length ? rects[0].top : Number.POSITIVE_INFINITY,
        t,
      });
      const after =
        w.__keyT > 0 ? w.__samples.filter((s) => s.t >= w.__keyT).length : 0;
      if (after < 30) requestAnimationFrame(loop);
      else w.__done = true;
    };
    requestAnimationFrame(loop);
    document.addEventListener(
      "keydown",
      () => {
        w.__keyT = performance.now();
      },
      { once: true },
    );
  });

  await page.keyboard.type("x");
  // A slow runner can answer before a frame has been drawn after the key.
  await page.waitForFunction(
    () => (window as unknown as { __done: boolean }).__done,
  );

  // Read once a frame has run after the keystroke: read at once, a busy page
  // can answer before its next frame, and there is nothing yet to judge.
  const read = () =>
    page.evaluate(() => {
      const w = window as unknown as {
        __samples: { top: number; t: number }[];
        __keyT: number;
      };
      return { samples: w.__samples, keyT: w.__keyT };
    });
  await expect
    .poll(async () => {
      const { samples, keyT } = await read();
      return keyT > 0 && samples.some((s) => s.t >= keyT);
    })
    .toBe(true);
  const { samples, keyT } = await read();

  const during = samples.filter((s) => s.t >= keyT);
  for (const s of during) {
    expect(s.top).toBeGreaterThanOrEqual(barBottom - 1);
  }
});

test("moving the caret with arrows brings a hidden caret back into view", async ({
  page,
}) => {
  await openEditorAndFocus(page);
  await floodAndSettle(page);
  await parkCaretAboveBar(page);

  const barBottom = await readBarBottom(page);

  // The precondition: the caret's true rect sits above the bar.
  const trueTop = await trueCaretTop(page);
  expect(trueTop).not.toBeNull();
  expect(trueTop as number).toBeLessThan(barBottom);

  // An arrow key moves the caret without touching the document, so the
  // pre-commit reveal on input never fires and the caret-move reveal brings
  // the caret below the bar.
  await page.keyboard.press("ArrowDown");

  await expect
    .poll(async () => (await trueCaretTop(page)) ?? Number.POSITIVE_INFINITY, {
      timeout: 5_000,
      message: "the caret scrolls back below the bar bottom",
    })
    .toBeGreaterThanOrEqual(barBottom - 1);
});

// ── The caret on a moving column ─────────────────────────────────────────────
//
// The dock translates the editor column left over a composited transition,
// and a window or panel width change shifts it too. The caret is painted at
// viewport coordinates, so it is repainted as the column moves, or it would
// stay at the old x, off its text, until the next keystroke. The painted
// caret's x and the live text position must coincide.

test("the caret stays on its text when the dock moves the column horizontally", async ({
  page,
}) => {
  await openEditorAndFocus(page);

  const caretX = () =>
    page
      .locator(".fake-cursor")
      .evaluate((el) => Number.parseFloat(el.style.left));
  const textX = () =>
    page.evaluate(() => {
      const sel = window.getSelection()!;
      const rects = sel.rangeCount ? sel.getRangeAt(0).getClientRects() : [];
      return rects.length ? rects[0].left : Number.NaN;
    });
  const offset = async () => Math.abs((await caretX()) - (await textX()));

  // Before the dock: the painted caret sits on its text.
  await expect.poll(offset, { timeout: 5_000 }).toBeLessThanOrEqual(1);

  // The dock translates the column left, and the caret travels with it and
  // settles on the moved text. Any face opens the dock at the same width.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect.poll(offset, { timeout: 15_000 }).toBeLessThanOrEqual(1);
});
