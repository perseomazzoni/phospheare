// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Reading the station probe ────────────────────────────────────────────────
//
// The docked-station invariant needs real layout, so the specs that drive the
// typewriter read the `?debug=station` overlay's readout
// (`.station-probe pre`) as the one source of truth, rather than a second
// formula in the test that could disagree with it. The readout repaints on
// every caret move and scroll, so a stale readout is itself a regression.

import { expect, type Page } from "@playwright/test";

export interface ProbeReadout {
  station: number;
  /** The page's visual centre below the floating chrome, where the station
   * belongs; its difference from `station` is the off-centre error. */
  visible: number;
  caret: number;
  delta: number;
  scrollTop: number;
  maxScroll: number;
  clamp: string;
  /** `running` while the page is still moving under the glide's own power. */
  glide: string;
}

/** The docked tolerance, in pixels. The dock holds the caret to within a
 * sub-pixel, Chromium may round `scrollTop` to integers, and the probe prints
 * one decimal, enough to see a drift that matters. */
export const DOCK_BOUND = 0.5;

export function parseProbe(text: string): ProbeReadout {
  const line = (prefix: string) =>
    text.split("\n").find((l) => l.startsWith(prefix)) ?? "";
  const num = (prefix: string) =>
    Number(line(prefix).slice(prefix.length).trim());
  const scroll = line("scroll ").slice("scroll ".length).trim();
  const [top, rest] = scroll.split("/");
  // `clamp` is everything after the max: `at end` is two words.
  const [max, ...clampWords] = rest.trim().split(/\s+/);
  return {
    station: num("station "),
    visible: num("visible "),
    caret: num("caret   "),
    delta: num("delta   "),
    scrollTop: Number(top.trim()),
    maxScroll: Number(max.trim()),
    clamp: clampWords.join(" "),
    glide: line("glide   ").slice("glide   ".length).trim(),
  };
}

/** The readout, once the predicate holds. A poll that asks only for a caret
 * can read the state before the gesture under test lands, since scroll events
 * fire after `scrollTop` writes resolve.
 *
 * The default waits for a settled dock, not just a finite caret: the mount
 * docks a frame or two after the caret first appears, because React 19 defers
 * the dock commit. Callers that want an intermediate state, such as a hand
 * scroll pulling the page away, pass a predicate for it.
 */
export async function readoutEventually(
  page: Page,
  when: (r: ProbeReadout) => boolean = (r) =>
    Number.isFinite(r.caret) && Math.abs(r.delta) <= DOCK_BOUND,
): Promise<ProbeReadout> {
  let r = null as ProbeReadout | null;
  await expect
    .poll(
      async () => {
        const text = await page.locator(".station-probe pre").textContent();
        if (!text) return false;
        r = parseProbe(text);
        return when(r);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return r as ProbeReadout;
}

/** The caret bar's centre in viewport coordinates, where it is drawn. */
export function barCentre(page: Page): Promise<number> {
  return page.locator(".fake-cursor").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
}

/** Waits until the caret bar's centre is within `DOCK_BOUND` of the given y. */
export async function barPinned(page: Page, station: number) {
  await expect
    .poll(
      async () => Math.abs((await barCentre(page)) - station) <= DOCK_BOUND,
      { timeout: 15_000 },
    )
    .toBe(true);
}

/** The focus lit line (`::highlight(focus)`) as a viewport band, or null. */
export async function litBand(
  page: Page,
): Promise<{ top: number; bottom: number } | null> {
  return page.evaluate(() => {
    const css = globalThis.CSS as unknown as {
      highlights?: { get: (name: string) => unknown };
    };
    const highlight = css.highlights?.get("focus") as
      { values: () => Iterator<unknown> } | undefined;
    const range = highlight?.values().next().value as
      { getBoundingClientRect(): DOMRect } | undefined;
    if (!range) return null;
    const rect = range.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
}

// ── Waiting for the page to settle ───────────────────────────────────────────
//
// The typewriter never jumps the page; it glides (`SCROLL_GLIDE_MS = 300`).
// A test cannot tell from outside when the glide has finished. A fixed sleep
// lands mid-glide under load, and `readoutEventually` answers
// once the caret is within `DOCK_BOUND`, while the glide still runs, so its
// remaining frames overwrite a hand scroll that follows. Polling
// `scrollTop` until two reads agree settles a frame early: Chromium rounds
// it to integers and an ease-out's tail moves sub-pixel per frame.
//
// No reading of the scroll position answers it, so the glide does:
// `scrollGlide.ts` publishes its state on the window under
// `import.meta.env.DEV`, and `glideSettled` waits on that.

/**
 * The page's test hooks, with neutral names like everything else the browser
 * holds: `memoryProvider.ts`'s demo files and `scrollGlide.ts`'s
 * glide signal. Passed into `page.evaluate`, where this module's imports do
 * not exist.
 */
export const DEMO_GLOBAL = "__demo";
export const GLIDING_GLOBAL = "__gliding";

/**
 * Resolves once no glide is in flight, so the page is where it is going.
 *
 * The state is read live, not from the painted readout. The probe repaints
 * only on a caret move or a scroll, and the glide's final frame writes the
 * exact target, which fires no scroll event when the value is already there,
 * so the painted line can say `running` on a still page and a wait on it
 * hangs.
 */
export async function glideSettled(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((global) => {
          const gliding = (
            window as unknown as Record<string, (() => boolean) | undefined>
          )[global];
          // Absent until the lazy editor chunk has evaluated, so this stays
          // false: a page with no glide module yet has no editor, and has not
          // settled.
          return gliding ? !gliding() : false;
        }, GLIDING_GLOBAL),
      { timeout: 10_000 },
    )
    .toBe(true);
}

/**
 * Waits for every CSS transition currently running to finish.
 *
 * Reading a computed style or a `boundingBox` right after changing a property
 * that feeds a transition returns a value in flight.
 * Two rAFs settle a reflow and say nothing about a transition, which runs its
 * full duration afterwards. The sign is a number short of the expected one,
 * from the direction the animation travels, that changes between runs.
 *
 * `CSSTransition` only: `getAnimations()` also returns looping
 * `CSSAnimation`s, such as the loading dots, whose `finished` never resolves
 * and would hang the caller.
 */
export async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.constructor.name === "CSSTransition")
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );
}

/**
 * Waits until no finite animation or transition is running anywhere on the
 * page, and none starts in the three frames after the last one ends.
 *
 * The frames hold what a finished move sets off: a resize observer's
 * re-measure runs two frames after the layout it reports, and a transition
 * it starts would be read in flight. Looping animations never finish, and a
 * paused one waits for a play that may never come, so neither is waited for.
 */
export async function settleAnimations(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const running = () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.getComputedTiming().endTime !== Infinity,
              );
          await Promise.all(
            running().map((animation) => animation.finished.catch(() => {})),
          );
          for (let frame = 0; frame < 3; frame++)
            await new Promise((done) => requestAnimationFrame(done));
          return running().length;
        }),
      { timeout: 10_000 },
    )
    .toBe(0);
}

/**
 * Reads an element's box once it has stopped moving: its own transitions
 * finished, then two equal reads a frame apart.
 *
 * The reads alone are not enough. Chrome can hold a transition it has just
 * started at its first value until the compositor takes it, and on a slow
 * machine two frames pass in that time: the box reads still and is where the
 * element is leaving from. `getAnimations()` updates the styles first, so
 * a transition set just before the call is awaited too.
 *
 * `settleTransitions` awaits only transitions already started, so anything
 * kicked off after it returns (a second transition, a ResizeObserver writing
 * a class, a font landing) is still ahead of the read. Asking whether the box
 * has stopped holds whatever is moving.
 */
export async function stableBox(
  page: Page,
  selector: string,
  timeoutMs = 5_000,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const read = () =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);

  const deadline = Date.now() + timeoutMs;
  await page.evaluate(
    (sel) =>
      Promise.all(
        (document.querySelector(sel)?.getAnimations() ?? [])
          .filter((animation) => animation.constructor.name === "CSSTransition")
          .map((animation) => animation.finished.catch(() => {})),
      ),
    selector,
  );
  let previous = await read();
  if (!previous) throw new Error(`stableBox: nothing matches ${selector}`);

  while (Date.now() < deadline) {
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => done(null))),
    );
    const next = await read();
    if (!next) throw new Error(`stableBox: ${selector} went away`);
    if (
      next.x === previous.x &&
      next.y === previous.y &&
      next.width === previous.width &&
      next.height === previous.height
    ) {
      return next;
    }
    previous = next;
  }
  throw new Error(`stableBox: ${selector} never stopped moving`);
}

/**
 * The dock's tabs as the writer sees them: the air left and right of each
 * tab's glyph and word inside its cell, and how far the thumb is from the
 * chosen cell. The tabs are a fitted track: each cell is as wide as
 * its word plus an equal share of what is left, so legibility is about the
 * air around each word, not equal cells.
 */
export function dockTabs(page: Page): Promise<{
  air: { label: string; left: number; right: number; glyph: boolean }[];
  thumbOff: { x: number; width: number };
}> {
  return page.evaluate(() => {
    const cells = [
      ...document.querySelectorAll<HTMLElement>(
        ".dock-head .ui-bar-track button",
      ),
    ];
    const air = cells.map((cell) => {
      const box = cell.getBoundingClientRect();
      const inked = [
        ...cell.querySelectorAll(":scope > svg, :scope > span[aria-hidden]"),
      ]
        .map((part) => part.getBoundingClientRect())
        .filter((part) => part.width > 0);
      return {
        label: cell.getAttribute("aria-label") ?? "",
        // A glyph-then-word cell is centred by its ink, not its boxes, so its
        // box air is one pixel short on the left and one over on the right
        // (`base.css`, the spark tab). Reported so an equal-air assertion can
        // undo that pixel.
        glyph: cell.querySelector(":scope > svg") !== null,
        left: Math.min(...inked.map((part) => part.left)) - box.left,
        right: box.right - Math.max(...inked.map((part) => part.right)),
      };
    });
    const thumb = document
      .querySelector(".dock-head .ui-bar-track-thumb")
      ?.getBoundingClientRect();
    const chosen = document
      .querySelector('.dock-head .ui-bar-track button[aria-pressed="true"]')
      ?.getBoundingClientRect();
    return {
      air,
      thumbOff: {
        x: (thumb?.left ?? NaN) - (chosen?.left ?? NaN),
        width: (thumb?.width ?? NaN) - (chosen?.width ?? NaN),
      },
    };
  });
}

/** The least air a dock tab's word may have on either side. */
export const TAB_AIR = 6;
