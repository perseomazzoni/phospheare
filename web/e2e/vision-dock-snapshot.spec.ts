// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import {
  openDockFace,
  openFirstLight,
  openVisionProject,
} from "./visionProject";

// Vision's Snapshots: Matte's table, painted as the book, the newest first.
// The adopted snapshot's tick and the open one's title are in verdigris, the
// title deepened by a fifth of the ink on its row's band, with a verdigris
// rule down the row's edge and no caret mark; where each stands against the
// adopted one, and its date, are in italic. Under the hand Adopt arrives in
// room kept for it at rest, so nothing in the row moves. Matte keeps its
// table. In en-US, so the dates read as the fixture's.

test.use({ timezoneId: "UTC", locale: "en-US" });

async function open(page: Page, family?: "matte", variant = "light") {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, {
    variant: variant as "light" | "dark",
    text: "section",
    family,
  });
  await openFirstLight(page, { save: false });
  await openDockFace(page, "snapshot");
  // Off the row the face opened, so it rests.
  await page.mouse.move(600, 600);
  await expect(page.locator(".snap-preview-body h1")).toHaveText(
    "The First Light",
  );
}

async function box(page: Page, selector: string, nth = 0) {
  const b = await page.locator(selector).nth(nth).boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) };
}

/** A colour, written with the page's tokens, as the page computes it. */
function colour(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const probe = document.createElement("i");
    probe.style.position = "absolute";
    probe.style.color = v;
    document.querySelector(".editor-shell")!.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, value);
}

const css = (
  page: Page,
  selector: string,
  property: string,
  pseudo: string | null = null,
) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, [p, w]) => getComputedStyle(el, w).getPropertyValue(p!), [
      property,
      pseudo,
    ] as const);

for (const variant of ["light", "dark"] as const) {
  test(`the adopted and the open snapshot are marked in verdigris (${variant})`, async ({
    page,
  }) => {
    await open(page, undefined, variant);
    await expect(page.locator(".snap-title")).toHaveText([
      "The morning it clicked",
      "Before the turn",
      "First pass",
      "Opening lines",
    ]);
    await expect(page.locator(".snap-rel")).toHaveText([
      "1 ahead",
      "1 back",
      "2 back",
    ]);
    await expect(page.locator(".snap-when")).toHaveText([
      "10/11/26, 9:18 AM",
      "10/10/26, 6:40 PM",
      "10/9/26, 6:02 PM",
      "10/8/26, 7:55 AM",
    ]);
    expect(await css(page, ".snap-rel", "font-style")).toBe("italic");
    expect(await css(page, ".snap-when", "font-style")).toBe("italic");

    const spark = await colour(page, "var(--spark)");
    const tick = page.locator(".snap-row.adopted .snap-tick");
    await expect(page.locator(".snap-row.adopted .snap-title")).toHaveText(
      "Before the turn",
    );
    await expect(tick).toBeVisible();
    await expect(tick).toHaveCSS("color", spark);

    await expect(page.locator(".snap-row.selected .snap-title")).toHaveText(
      "The morning it clicked",
    );
    expect(await css(page, ".snap-row.selected .snap-title", "color")).toBe(
      await colour(page, "color-mix(in srgb, var(--spark) 80%, var(--ink))"),
    );
    expect(await css(page, ".snap-row.selected", "box-shadow")).toBe(
      `${spark} 2px 0px 0px 0px inset`,
    );
    for (const pseudo of ["::before", "::after"])
      expect(await css(page, ".snap-row.selected", "content", pseudo)).toBe(
        "none",
      );
  });
}

test("under the hand Adopt arrives, and nothing in the row moves", async ({
  page,
}) => {
  await open(page);
  const row = page.locator(".snap-row", { hasText: "First pass" });
  const adopt = row.locator(".snap-adopt");
  await expect(adopt).toHaveCSS("opacity", "0");
  const rel = await row.locator(".snap-rel").boundingBox();

  await row.hover();
  await expect(adopt).toHaveCSS("opacity", "1");
  await expect(row.locator(".snap-actions")).toHaveCSS("opacity", "1");
  await expect(row.locator(".snap-rel")).toBeVisible();
  const relNow = await row.locator(".snap-rel").boundingBox();
  expect({ x: relNow!.x, y: relNow!.y }).toEqual({ x: rel!.x, y: rel!.y });
  // Adopt is a word over a hairline, in small capitals.
  expect(
    await adopt.evaluate((el) => getComputedStyle(el).fontVariantCaps),
  ).toBe("all-small-caps");
  expect(await adopt.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
    `${await colour(page, "var(--hair-firm)")} 0px -1px 0px 0px inset`,
  );

  // The pencil, then the bin, in the actions' track at the row's end.
  const pen = await row.getByRole("button", { name: "Rename" }).boundingBox();
  const bin = await row.getByRole("button", { name: "Delete" }).boundingBox();
  const track = await row.locator(".snap-actions").boundingBox();
  const end = await row.boundingBox();
  expect(pen!.x).toBeGreaterThanOrEqual(track!.x);
  expect(bin!.x).toBeGreaterThan(pen!.x + pen!.width - 1);
  expect(bin!.x + bin!.width).toBeLessThanOrEqual(track!.x + track!.width);
  expect(track!.x + track!.width).toBeCloseTo(end!.x + end!.width, 0);

  // The adopted row has its pencil alone.
  const adopted = page.locator(".snap-row.adopted");
  await adopted.hover();
  await expect(adopted.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(adopted.getByRole("button", { name: "Delete" })).toHaveCount(0);

  // One button or two, every row's cells start and end alike: the actions
  // track keeps its width whatever it holds, or the shorter row's other
  // columns widen into the room it leaves.
  const cells = await page.locator(".snap-row").evaluateAll((rows) =>
    rows.map((row) =>
      [".snap-when-cell", ".snap-title-cell", ".snap-actions"].map((sel) => {
        const r = row.querySelector(sel)!.getBoundingClientRect();
        return [r.x, r.width];
      }),
    ),
  );
  expect(cells.length).toBeGreaterThan(1);
  for (const row of cells) expect(row).toEqual(cells[0]);
});

test("a long list keeps each row whole and scrolls", async ({ page }) => {
  await open(page);
  const scroll = page.locator(".snap-scroll");
  for (let i = 1; i <= 8; i++) {
    const full = await scroll.evaluate(
      (el) => el.scrollHeight > el.clientHeight + 1,
    );
    if (full) break;
    await page.locator(".snap-add").click();
    await expect(page.locator(".snap-add-input")).toBeFocused();
    await page.keyboard.type(`Take ${i}`);
    await page.keyboard.press("Enter");
    await expect(
      page.locator(".snap-title", { hasText: `Take ${i}` }),
    ).toHaveCount(1);
  }
  expect(
    await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 1),
  ).toBe(true);

  // Every row keeps the frame's height at least, and all alike.
  const rows = await page
    .locator(".snap-row:has(.snap-when)")
    .evaluateAll((els) =>
      els.map((el) => ({
        height: el.getBoundingClientRect().height,
        floor: parseFloat(getComputedStyle(el).minHeight),
      })),
    );
  for (const r of rows) {
    expect(r.height).toBeGreaterThanOrEqual(r.floor);
    expect(r.height).toBeCloseTo(rows[0].height, 1);
  }

  // The list scrolls to its last row.
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.locator(".snap-row").last()).toBeInViewport();
});

test("Matte keeps its table", async ({ page }) => {
  await open(page, "matte");
  await expect(page.locator(".snap-adopted")).toBeHidden();
  await expect(page.locator(".snap-tick")).toBeVisible();
  expect((await box(page, ".snap-divider")).height).toBe(7);
});
