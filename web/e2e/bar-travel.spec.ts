// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The bar travels with the measure and stays in the window. Its
// whole horizontal position is one clamped `translate` on the stack: centred
// on the measure at rest, pinned while engaged, never past the panel's left
// edge. The open dock moves the measure by one `--dock-shift`, which
// the bar's target reads. Two rules each shifting the bar spend the
// same pixels twice, push its leading edge out of the window, and take it off
// the measure it formats.

import { expect, test, type Page } from "@playwright/test";
import { settleTransitions, stableBox } from "./probe";

/** 1008 is `NARROW_AT` exactly and counts as wide, so the dock shares the
 *  window rather than lying over the desk; 1100 is mid-band, where the dock's
 *  shift is bounded by the room's slack; 1200 is a wide desk. */
const WIDTHS = [1008, 1100, 1200] as const;

/** The bar's own find field. `.ui-bar-find-input` is `CommandBarFind`'s class,
 *  which the structure panel also uses, so an unscoped locator resolves to two
 *  inputs and fails strict mode. */
const BAR_FIND = ".bar-stack .ui-bar-find-input";

/** Open the dock, and wait for the bar to settle at rest over the measure. */
async function openDockAtRest(page: Page) {
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  // Any face opens the dock at the same width.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toBeVisible();
  await page.locator(".editor p").first().click();
  // The click on Snapshots leaves the pointer in the bar, and an engaged bar is
  // pinned where it stood when the writer reached for it, before the dock
  // moved the measure. Ctrl+F inside the pin's 220ms release keeps
  // that stale pin, so the bar is let come home first, as a writer's would.
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-fold-engaged",
    "0",
  );
  await expect(page.locator(".bar-stack")).not.toHaveAttribute(
    "data-pinned",
    "1",
  );
  await settleTransitions(page);
}

async function openFind(page: Page) {
  await page.keyboard.press("Control+f");
  await expect(page.locator(BAR_FIND)).toBeVisible();
  // The fold and the find field both transition over `--t`, so the bar is
  // measured once it has arrived.
  await settleTransitions(page);
}

async function openFindOverDock(page: Page) {
  await openDockAtRest(page);
  await openFind(page);
}

const geometry = (page: Page) =>
  page.evaluate(() => {
    const box = (s: string) =>
      document.querySelector(s)!.getBoundingClientRect();
    const bar = box(".bar-stack");
    const editor = box(".editor");
    return {
      barX: bar.x,
      barRight: bar.right,
      delta: bar.x + bar.width / 2 - (editor.x + editor.width / 2),
    };
  });

/** A shell length in pixels, resolved through a probe, since a token may be
 * a calc(). */
const px = (page: Page, name: string) =>
  page.locator(".editor-shell").evaluate((el, n) => {
    const probe = document.createElement("i");
    probe.style.marginTop = `var(${n})`;
    el.append(probe);
    const value = parseFloat(getComputedStyle(probe).marginTop);
    probe.remove();
    return value;
  }, name);

for (const width of WIDTHS) {
  test(`at ${width} the bar's leading edge stays inside the window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openFindOverDock(page);

    const seen = await page.evaluate(() => {
      const stack = document
        .querySelector(".bar-stack")!
        .getBoundingClientRect();
      const togs = [...document.querySelectorAll<HTMLElement>(".find-tog")].map(
        (el) => el.getBoundingClientRect().x,
      );
      return {
        stackX: stack.x,
        leadingTog: togs.length ? Math.min(...togs) : null,
      };
    });

    // Nothing the writer reaches for may begin off the left edge. The stack
    // carries the drop, so its own edge goes first.
    expect(seen.stackX).toBeGreaterThanOrEqual(0);
    expect(seen.leadingTog).not.toBeNull();
    expect(seen.leadingTog!).toBeGreaterThanOrEqual(0);
  });

  test(`at ${width} the bar still sits over the measure, not the window`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openDockAtRest(page);

    // At rest the bar's centre is the measure's, wherever the dock's
    // shift has put the measure.
    const rest = await geometry(page);
    expect(Math.abs(rest.delta)).toBeLessThanOrEqual(1);

    // Opening find engages the bar, which pins its left edge where it stood
    // and lets the field grow rightwards, so the bar does not jump
    // off the measure to make room: its left edge moves only by what the
    // window's right edge forces (the clamp's least movement), never right.
    await openFind(page);
    const open = await geometry(page);
    expect(open.barX).toBeLessThanOrEqual(rest.barX + 1);
    const forced = Math.max(0, rest.barX + (open.barRight - open.barX) - width);
    expect(rest.barX - open.barX).toBeLessThanOrEqual(forced + 1);
  });
}

test("a pinned bar against the right limit grows to the window's edge before it slides", async ({
  page,
}) => {
  // The panel at its ceiling (600) at 1200 leaves the bar resting against
  // the right limit, 24 short of the window's edge. A fold opened under the
  // pointer widens it by more than that margin. Pinned, it may take the
  // margin first, so its left edge holds until its right edge meets the
  // window's, and then moves only by the rest of the growth. Easing into the
  // pin would blend the centring's `- 50%` into a bar the fold is widening,
  // so every frame of the opening is read, not only where it lands.
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.locator('.doc-tree [role="separator"]').focus();
  await page.keyboard.press("End");
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "style",
    /--panel-w: 600px/,
  );
  await page.mouse.move(1000, 600);
  await expect(page.locator(".bar-stack")).not.toHaveAttribute(
    "data-pinned",
    "1",
  );
  await settleTransitions(page);
  const rest = await page
    .locator(".bar-stack")
    .evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect);
  expect(rest.right).toBeCloseTo(1200 - 24, 0);

  // Every frame until the fold is open and the bar has held still for ten.
  const recording = page.evaluate(
    () =>
      new Promise<{ x: number; right: number; width: number }[]>((done) => {
        const stack = document.querySelector(".bar-stack")!;
        const fold = document.querySelector(".ed-fold-block")!;
        const frames: { x: number; right: number; width: number }[] = [];
        let still = 0;
        const read = () => {
          const { x, right, width } = stack.getBoundingClientRect();
          const prev = frames[frames.length - 1];
          still = prev && prev.x === x && prev.width === width ? still + 1 : 0;
          frames.push({ x, right, width });
          if (fold.getAttribute("data-open") === "1" && still >= 10)
            done(frames);
          else requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
      }),
  );
  const fold = (await page.locator(".ed-fold-block").boundingBox())!;
  await page.mouse.move(fold.x + fold.width / 2, fold.y + fold.height / 2, {
    steps: 3,
  });
  await expect(page.locator(".ed-fold-block")).toHaveAttribute(
    "data-open",
    "1",
  );
  const frames = await recording;

  const last = frames[frames.length - 1];
  expect(last.width - rest.width).toBeGreaterThan(24);
  expect(last.right).toBeCloseTo(1200, 0);
  for (const f of frames) {
    expect(f.right).toBeLessThanOrEqual(1200 + 0.5);
    expect(f.x).toBeGreaterThanOrEqual(Math.min(rest.x, 1200 - f.width) - 0.5);
  }
  // The pin lands a beat before the fold widens, so an ease into it has
  // mostly run out by then and the frames can miss it. The stack's own
  // transition is read as well: none while pinned.
  await expect(page.locator(".bar-stack")).toHaveAttribute("data-pinned", "1");
  const ease = await page
    .locator(".bar-stack")
    .evaluate((el) =>
      Math.max(
        ...getComputedStyle(el).transitionDuration.split(",").map(parseFloat),
      ),
    );
  expect(ease).toBe(0);
});

test("with the dock closed the bar is where it always was", async ({
  page,
}) => {
  // The dock's travel is keyed on `[data-dock="1"]` (`--dock-shift`), so the
  // undocked desk stays put at the width where the docked bar moves most: at
  // rest the bar's centre is the measure's own.
  await page.setViewportSize({ width: 1008, height: 800 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await settleTransitions(page);

  const rest = await page.evaluate(() => {
    const mid = (s: string) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return r.x + r.width / 2;
    };
    return {
      dock: (document.querySelector(".editor-shell") as HTMLElement).dataset
        .dock,
      delta: mid(".bar-stack") - mid(".editor"),
    };
  });
  expect(rest.dock).not.toBe("1");
  expect(Math.abs(rest.delta)).toBeLessThanOrEqual(1);

  // With the find drop up, the bar is inside the window.
  await page.locator(".editor p").first().click();
  await page.keyboard.press("Control+f");
  await expect(page.locator(BAR_FIND)).toBeVisible();
  await settleTransitions(page);
  const stackX = await page
    .locator(".bar-stack")
    .evaluate((el) => el.getBoundingClientRect().x);
  expect(stackX).toBeGreaterThanOrEqual(0);
});

test("a bar wider than the room starts at the left limit and scrolls, over the panel and the dock", async ({
  page,
}) => {
  // The limits are the window's, 32 in from the panel's inset on the left
  // and 24 from the right, and the left one wins when they cross. The panel
  // and the dock are not limits: the bar passes over them rather than
  // folding while the window has room.
  await page.setViewportSize({ width: 800, height: 800 });
  await openDockAtRest(page);
  // Content wider than the room between the limits.
  await page.locator(".bar-stack .ui-bar").evaluate((bar) => {
    const wide = document.createElement("i");
    wide.style.cssText = "display:block;width:240px;height:1px;flex-shrink:0";
    bar.append(wide);
  });
  const stack = await stableBox(page, ".bar-stack");
  expect(stack.x).toBe((await px(page, "--panel-left")) + 32);
  expect(stack.x + stack.width).toBe(800 - 24);
  const bar = await page
    .locator(".bar-stack .ui-bar")
    .evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(bar[0]).toBeGreaterThan(bar[1]);
  const panel = await stableBox(page, ".doc-tree");
  const dock = await stableBox(page, ".ed-dock");
  expect(stack.x).toBeLessThan(panel.x + panel.width);
  expect(stack.x + stack.width).toBeGreaterThan(dock.x);
});

test("an open search keeps its field wide after the focus leaves it", async ({
  page,
}) => {
  // Find is not a fold: its field widens on the search being open, never
  // under a passing pointer, so it stays wide and legible while the search
  // panel is up, with the focus on one of its controls and no query typed.
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.locator(".editor p").first().click();
  await openFind(page);
  await page.locator(".find-tog").first().focus();
  await page.mouse.move(600, 600);
  await settleTransitions(page);
  const find = page.locator(".bar-stack .ui-bar-find");
  await expect(page.locator(".bar-stack .ed-seg-find")).toHaveAttribute(
    "data-open",
    "1",
  );
  await expect(find).not.toHaveAttribute("data-query", "1");
  const field = await find.evaluate((el) => {
    const probe = document.createElement("i");
    probe.style.cssText = "position:absolute;width:var(--bar-find-w)";
    el.closest(".ui-bar")!.append(probe);
    const token = parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return {
      focused: el.contains(document.activeElement),
      width: el.getBoundingClientRect().width,
      token,
      ink: getComputedStyle(el.querySelector(".ui-bar-find-input")!).opacity,
    };
  });
  expect(field).toEqual({
    focused: false,
    width: field.token,
    token: field.token,
    ink: "1",
  });
  expect(field.token).toBeGreaterThan(100);
});
