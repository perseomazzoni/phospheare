// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { stableBox } from "./probe";
import {
  openDockFace,
  openFirstLight,
  openVisionProject,
  type VisionStubs,
} from "./visionProject";

// Vision's page between crop marks. The prose scrolls in the frame's
// surface, which spans the window under every theme; the marks stand 32
// outside what the page holds, the text or, while the notes stand beside
// it, the text and their column, from 5 over the bar's foot to the sheet's
// foot. They move only as the text does: beside a Dock with room they stay
// clear of it, and a Dock that covers the text lies over them. The text is
// cut on the marks' top line (`underBar` "cut"), so the title bar keeps no
// frost. The prose's scrollbar shows only while it scrolls. Matte draws no
// marks, and slides the text under a frosted title bar.

test.use({ timezoneId: "UTC", locale: "en-US" });

let stubs: VisionStubs;

type Box = { x: number; y: number; width: number; height: number };

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

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

/** A colour token as the browser computes it. */
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

/** The marks' reach past what the page holds, and the notes' column. */
const REACH = 32;
const COLUMN = 208;

/** The marks' frame once its eased `left` and `width` have come to rest. */
const crops = (page: Page) => stableBox(page, ".crop-frame");

test("the crop marks frame the text and its notes", async ({ page }) => {
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  await expect(page.locator(".cm-layer")).toHaveAttribute("data-mode", "notes");
  expect(await box(page, ".editor-surface")).toEqual({
    x: 0,
    y: 0,
    width: 1198,
    height: 691,
  });
  const frame = await crops(page);
  const text = await box(page, ".editor");
  const measure = await px(page, "--editor-width");
  expect(frame.x).toBe(text.x - REACH);
  expect(frame.width).toBe(measure + COLUMN + 2 * REACH);
  expect(frame.y).toBe((await px(page, "--face-top")) - 5);
  expect(bottom(frame)).toBe(691 - (await px(page, "--sheet-gap")));

  // Four corners, each two 16 arms in the third ink.
  const ink = await token(page, "--ink-3");
  const corners = await page.locator(".crop").evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const arm = (side: string) =>
        cs.getPropertyValue(`border-${side}-width`) === "1px";
      return {
        size: [r.width, r.height],
        colour: cs.borderTopColor,
        arms: ["top", "right", "bottom", "left"].filter(arm),
      };
    }),
  );
  expect(corners).toEqual([
    { size: [16, 16], colour: ink, arms: ["top", "left"] },
    { size: [16, 16], colour: ink, arms: ["top", "right"] },
    { size: [16, 16], colour: ink, arms: ["bottom", "left"] },
    { size: [16, 16], colour: ink, arms: ["right", "bottom"] },
  ]);

  // The text is cut on the marks' top line, so nothing scrolls under the
  // title bar and it has no frost.
  expect(
    await page
      .locator(".editor-surface")
      .evaluate((el) => getComputedStyle(el).maskImage),
  ).toContain(`rgba(0, 0, 0, 0) ${frame.y}px`);
  await expect(page.locator(".titlebar-veil").first()).toBeHidden();

  // The cut is a clip at the face, not only the fade over it: prose
  // scrolled above the face takes no pointer there.
  const face = await px(page, "--face-top");
  const above = await page.locator(".editor-surface").evaluate((surface, y) => {
    const p = surface.querySelectorAll(".editor p")[1];
    const r = p.getBoundingClientRect();
    surface.scrollTop += r.top + r.height / 2 - y;
    const moved = p.getBoundingClientRect();
    return {
      covered: moved.top < y && moved.bottom > y,
      hit: document
        .elementsFromPoint(moved.x + 4, y)
        .some((el) => p.contains(el)),
    };
  }, face - 3);
  expect(above).toEqual({ covered: true, hit: false });
  expect(stubs.unexpected).toEqual([]);
});

test("the panel is attached with its contents where a floating panel has them", async ({
  page,
}) => {
  // Flush to the window, it takes the inset as padding and draws one edge,
  // on its right, so its contents and its right edge do not move.
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  const panel = await stableBox(page, ".doc-tree");
  const inset = await px(page, "--panel-left");
  expect(panel.x).toBe(0);
  expect(right(panel)).toBe(inset + (await px(page, "--panel-w")));
  expect(
    await page.locator(".doc-tree").evaluate((el) => {
      const cs = getComputedStyle(el);
      return [
        parseFloat(cs.paddingLeft),
        cs.borderTopWidth,
        cs.borderRightWidth,
        cs.borderBottomWidth,
        cs.borderLeftWidth,
      ];
    }),
  ).toEqual([inset, "0px", "1px", "0px", "0px"]);
});

test("a Dock that covers the text lies over the marks", async ({ page }) => {
  await page.setViewportSize({ width: 1198, height: 723 });
  stubs = await openVisionProject(page, { variant: "dark", text: "section" });
  await openFirstLight(page);
  await openDockFace(page, "notes");
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "1",
  );
  // The notes go to their marks, so the marks frame the text alone, and
  // stay with it under the Dock.
  await expect(page.locator(".cm-layer")).toHaveAttribute(
    "data-mode",
    "markers",
  );
  const frame = await crops(page);
  const text = await box(page, ".editor");
  const dock = await box(page, ".ed-dock");
  expect(text.width).toBe(await px(page, "--editor-width"));
  expect(frame.x).toBe(text.x - REACH);
  expect(frame.width).toBe(text.width + 2 * REACH);
  expect(right(frame)).toBeGreaterThan(dock.x);
  const over = await page.evaluate(
    () =>
      Number(getComputedStyle(document.querySelector(".ed-dock")!).zIndex) >
      Number(getComputedStyle(document.querySelector(".crop-frame")!).zIndex),
  );
  expect(over).toBe(true);
});

test("beside a Dock it has room beside the marks move with the text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  const measure = await px(page, "--editor-width");
  const before = await crops(page);
  expect(before.x).toBe((await box(page, ".editor")).x - REACH);
  expect(before.width).toBe(measure + COLUMN + 2 * REACH);

  await openDockFace(page, "notes");
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "0",
  );
  await expect(page.locator(".cm-layer")).toHaveAttribute("data-mode", "notes");
  const docked = await crops(page);
  const text = await stableBox(page, ".editor");
  const dock = await box(page, ".ed-dock");
  expect(docked.x).toBeLessThan(before.x);
  expect(docked.x).toBe(text.x - REACH);
  expect(docked.width).toBe(before.width);
  expect(right(docked)).toBeLessThanOrEqual(dock.x);
});

test("the marks follow the text through a panel drag", async ({ page }) => {
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  const grip = await box(page, ".panel-resize");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + 40, {
    steps: 8,
  });
  await page.mouse.up();
  const panel = await stableBox(page, ".doc-tree");
  expect(panel.width).toBeGreaterThan(300);
  const frame = await crops(page);
  const text = await stableBox(page, ".editor");
  const notes =
    (await page.locator(".cm-layer").getAttribute("data-mode")) === "notes";
  expect(frame.x).toBe(text.x - REACH);
  expect(frame.width).toBe(text.width + (notes ? COLUMN : 0) + 2 * REACH);
  expect(frame.x).toBeGreaterThanOrEqual(right(panel));
});

test("the prose's scrollbar shows while it scrolls and goes a second after", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  const surface = page.locator(".editor-surface");
  // The thumb is drawn in the surface's `--scroll-thumb`, clear at rest.
  const thumb = () =>
    surface.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--scroll-thumb").trim(),
    );
  const scrollbar = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--scrollbar")
      .trim(),
  );
  expect(await thumb()).toBe("transparent");
  await surface.hover();
  await page.mouse.wheel(0, 120);
  await expect(surface).toHaveAttribute("data-scrolling", "1");
  expect(await thumb()).toBe(scrollbar);
  await expect(surface).not.toHaveAttribute("data-scrolling", "1", {
    timeout: 3000,
  });
  expect(await thumb()).toBe("transparent");
});

test("Matte draws no crop marks", async ({ page }) => {
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, {
    variant: "light",
    text: "section",
    family: "matte",
  });
  await openFirstLight(page);
  await expect(page.locator(".editor")).toBeVisible();
  await expect(page.locator(".crop-frame")).toHaveCount(0);
});

test("Matte frosts the title bar with a blur and a veil of its own ground", async ({
  page,
}) => {
  // The frost shows only where prose passes under it. The blur carries no
  // fill and no `saturate()`, which moves the paper's hue, so over an empty
  // ground it blurs the same paper. The veil fades the ink and is invisible
  // over that ground because it is the shell's own ground, pinned to the
  // window the shell fills.
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, {
    variant: "light",
    text: "section",
    family: "matte",
  });
  await openFirstLight(page);
  await expect(page.locator(".titlebar-veil").first()).toBeVisible();
  const frost = await page.evaluate(() => {
    const blur = getComputedStyle(
      document.querySelector(".titlebar")!,
      "::before",
    );
    const veil = getComputedStyle(document.querySelector(".titlebar-veil")!);
    const shell = document.querySelector(".editor-shell")!;
    const ground = getComputedStyle(shell);
    const r = shell.getBoundingClientRect();
    return {
      blur: {
        filter: blur.backdropFilter,
        fill: [blur.backgroundColor, blur.backgroundImage],
        edge: [blur.boxShadow, blur.borderTopWidth, blur.borderBottomWidth],
      },
      radius: blur.getPropertyValue("--frost-blur").trim(),
      veil: {
        ground: [veil.backgroundColor, veil.backgroundImage],
        fixed: veil.backgroundAttachment.split(", "),
        filter: veil.backdropFilter,
        mask: veil.maskImage,
      },
      shell: [ground.backgroundColor, ground.backgroundImage],
      fills: [r.x, r.y, r.width, r.height],
    };
  });
  expect(frost.blur).toEqual({
    filter: `blur(${frost.radius})`,
    fill: ["rgba(0, 0, 0, 0)", "none"],
    edge: ["none", "0px", "0px"],
  });
  expect(frost.veil.ground).toEqual(frost.shell);
  expect(frost.fills).toEqual([0, 0, 1198, 691]);
  expect(new Set(frost.veil.fixed)).toEqual(new Set(["fixed"]));
  expect(frost.veil.filter).toBe("none");
  // The veil stands at part strength: the ink fades, never vanishes.
  const alphas = [...frost.veil.mask.matchAll(/rgba\(0, 0, 0, ([\d.]+)\)/g)];
  expect(alphas).toHaveLength(2);
  for (const [, a] of alphas) {
    expect(Number(a)).toBeGreaterThan(0);
    expect(Number(a)).toBeLessThan(1);
  }
});
