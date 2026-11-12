// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The shared header band ───────────────────────────────────────────────────
//
// Both halves draw a header carrying the brand or the way back at the leading
// edge and the palette and the account face at the trailing one. One constant,
// `--header-h`, sizes it on both, so the account face holds still on the way
// into a project.
//
// Every panel that sits under the band derives its top from the same
// constant; a literal copy leaves that panel behind when the band changes,
// with the header landing on top of it, and no layout reading catches that.
// So the first test changes the constant and asserts that everything moves.

import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./session";

/** The account face — the same element, by the same name, on both surfaces. */
const accountFace = (page: Page) =>
  page
    .locator("[aria-label^='Account:']")
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        centreY: Math.round((r.y + r.height / 2) * 100) / 100,
        fromTrailingEdge: Math.round((window.innerWidth - r.right) * 100) / 100,
      };
    });

/** Everything that claims the header's horizon, in one read. */
const horizon = (page: Page) =>
  page.evaluate(() => {
    const y = (sel: string) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().y * 100) / 100 : null;
    };
    return {
      titlebarHeight: Math.round(
        document.querySelector(".titlebar")!.getBoundingClientRect().height,
      ),
      tree: y(".doc-tree"),
      dock: y(".ed-dock"),
      handle: y(".dt-collapse"),
    };
  });

test("the whole chrome moves with the band, not just the titlebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  // The dock must be open to be measured. Any face opens it at the same
  // width, and the demo has no spark.
  await page
    .locator(".bar-stack")
    .getByRole("button", { name: "Snapshots" })
    .click();
  await expect(page.locator(".ed-dock")).toHaveAttribute("data-open", "1");

  const before = await horizon(page);
  expect(before.titlebarHeight).toBe(40);
  // The panels start on the chrome's horizon, 4px below the band's bottom
  // edge (`--chrome-horizon`), pinned against the band rather than as 44 so
  // the relationship survives a change to it.
  expect(before.tree).toBe(before.titlebarHeight + 4);
  expect(before.dock).toBe(before.titlebarHeight + 4);

  // Only the one constant changes.
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--header-h", "60px"),
  );
  const after = await horizon(page);

  expect(after.titlebarHeight).toBe(60);
  // Each of the three moves by the 20px the band grew.
  expect(after.tree).toBe(before.tree! + 20);
  expect(after.dock).toBe(before.dock! + 20);
  expect(after.handle).toBe(before.handle! + 20);
});

test("the editor's own header is the shared band", async ({ page }) => {
  // The Library's half of this claim needs a writer session and runs below.
  // This half needs none.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();

  const band = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--header-h")
      .trim(),
  );
  expect(band).toBe("40px");
  const titlebar = await page
    .locator(".titlebar")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(titlebar).toBe(40);
});

test("the frost is one band under the titlebar's items", async ({ page }) => {
  // The blur is the titlebar's `::before` and the veil a span inside it. Both
  // cover the titlebar and nothing more, so no fog reaches under the command
  // bar; the box equality holds only while the titlebar is their containing
  // block, since `.chrome` around it spans the window.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/editor/demo");
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();

  const band = await page.evaluate(() => {
    const titlebar = document.querySelector(".titlebar")!;
    const veil = document.querySelector(".titlebar-veil")!;
    const layer = (el: Element, pseudo: string | null) => {
      const s = getComputedStyle(el, pseudo);
      return {
        top: s.top,
        left: s.left,
        width: s.width,
        height: s.height,
        zIndex: s.zIndex,
        pointerEvents: s.pointerEvents,
        mask: s.maskImage,
        frost: s.getPropertyValue("--frost-a").trim(),
      };
    };
    const r = titlebar.getBoundingClientRect();
    const v = veil.getBoundingClientRect();
    return {
      titlebar: { x: r.x, y: r.y, width: r.width, height: r.height },
      veilBox: { x: v.x, y: v.y, width: v.width, height: v.height },
      veil: layer(veil, null),
      blur: layer(titlebar, "::before"),
    };
  });
  expect(band.veilBox).toEqual(band.titlebar);
  for (const layer of [band.veil, band.blur]) {
    expect({
      top: layer.top,
      left: layer.left,
      width: layer.width,
      height: layer.height,
    }).toEqual({
      top: "0px",
      left: "0px",
      width: `${band.titlebar.width}px`,
      height: `${band.titlebar.height}px`,
    });
    // Beneath the items' text, and never a target.
    expect(layer.zIndex).toBe("-1");
    expect(layer.pointerEvents).toBe("none");
    // One strength from top to foot: both stops of the mask carry the theme's
    // `--frost-a`, opaque where the theme sets none.
    const stops = [...layer.mask.matchAll(/rgba?\(([^)]*)\)/g)].map((m) => {
      const [, , , a] = m[1].split(",").map(Number);
      return a ?? 1;
    });
    expect(layer.mask.startsWith("linear-gradient(")).toBe(true);
    expect(stops).toEqual([Number(layer.frost || 1), Number(layer.frost || 1)]);
  }

  // The items stand on the band's centre line, each a hit target over it,
  // and none carries a layer of its own.
  const items = await page.evaluate(() => {
    const titlebar = document
      .querySelector(".titlebar")!
      .getBoundingClientRect();
    return [".titlebar-return", ".titlebar-project", ".titlebar-right"].map(
      (sel) => {
        const el = document.querySelector(sel)!;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2,
        );
        const item = el.closest(".titlebar > *")!;
        return {
          sel,
          above: Math.round((r.y - titlebar.y) * 100) / 100,
          below: Math.round((titlebar.bottom - r.bottom) * 100) / 100,
          hit: hit !== null && el.contains(hit),
          layers: ["::before", "::after"].map(
            (p) => getComputedStyle(item, p).content,
          ),
        };
      },
    );
  });
  for (const item of items) {
    expect(item.above, item.sel).toBeGreaterThan(0);
    expect(item.above, item.sel).toBeCloseTo(item.below, 0);
    expect(item.hit, item.sel).toBe(true);
    expect(item.layers, item.sel).toEqual(["none", "none"]);
  }
});

// ── The crossing into a project ──────────────────────────────────────────────
//
// The Library is behind the writer gate, so this half signs in as a local
// writer first. It measures the account face from the writer's side
// rather than the stylesheet's.

test.describe("the account face does not move on the way into a project", () => {
  test("same height, same inset, both halves", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page);

    await page.goto("/app");
    await expect(page.locator(".app-top")).toBeVisible();
    const shelf = await accountFace(page);

    await page.goto("/app/editor/demo");
    await page.getByRole("button", { name: "Continue writing" }).click();
    await expect(page.locator(".editor p").first()).toBeVisible();
    const editor = await accountFace(page);

    // Identical, not merely close: the account face is the fixed corner of
    // the application.
    expect(shelf.centreY).toBe(editor.centreY);
    expect(shelf.fromTrailingEdge).toBe(editor.fromTrailingEdge);
  });
});
