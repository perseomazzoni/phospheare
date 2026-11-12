// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { stableBox } from "./probe";
import { openDockFace, openVisionProject } from "./visionProject";

// Vision's Desk: the book's half-title page. The running head names the book
// alone in small capitals over a hairline, on the measure, 16 above the text's
// first line; the Desk stands on the same measure under it. The place the
// writer left off is in italic, their last line quoted on a hairline, the one
// button an ink block framed inside by a gold rule, and "Open something else"
// stands only while the panel is folded. The shape is drawn as rules, one
// column per Part with the Sections at their share of it; the open thread
// stands on a rule in the attention colour. Beside the open Dock the head
// keeps to the Desk's column. Matte keeps its Desk. The measure and the
// columns come from the frame's tokens: Vision paints, the frame lays out.

test.use({ timezoneId: "UTC", locale: "en-GB" });

async function open(page: Page, family?: "matte", variant = "light") {
  await page.setViewportSize({ width: 1198, height: 691 });
  await openVisionProject(page, {
    variant: variant as "light" | "dark",
    text: "desk",
    family,
  });
  await expect(page.locator(".desk")).toBeVisible({ timeout: 20_000 });
}

/** A token as the shell resolves it: a colour, or a length in pixels. */
async function token(page: Page, name: string, as: "color" | "width") {
  return page.evaluate(
    ({ name, as }) => {
      const probe = document.createElement("div");
      probe.style.position = "absolute";
      probe.style[as] = `var(${name})`;
      document.querySelector(".editor-shell")!.appendChild(probe);
      const value = getComputedStyle(probe)[as];
      probe.remove();
      return value;
    },
    { name, as },
  );
}

const px = async (page: Page, name: string) =>
  parseFloat(await token(page, name, "width"));

/** Where the measure stands: centred in the room between the panel and the
 * window's right margin, with no Dock open. */
async function measure(page: Page) {
  const width = await px(page, "--editor-width");
  const left =
    (await px(page, "--panel-left")) +
    (await px(page, "--panel-w")) +
    (await px(page, "--panel-gutter"));
  const room =
    page.viewportSize()!.width - left - (await px(page, "--desk-right"));
  return { x: left + Math.max(0, (room - width) / 2), width };
}

for (const variant of ["light", "dark"] as const) {
  test(`the Desk is set as the book's half-title (${variant})`, async ({
    page,
  }) => {
    await open(page, undefined, variant);
    const ink = await token(page, "--ink", "color");
    const gilt = await token(page, "--vision-gilt", "color");
    const hairFirm = await token(page, "--hair-firm", "color");

    // The head names the book, with no Part and no folio, in small capitals
    // over a hairline.
    const head = page.locator(".ed-runhead");
    await expect(head).toHaveText("Once Dark");
    await expect(head.locator("b")).toHaveCount(0);
    await expect(page.locator(".ed-folio")).toHaveCount(0);
    expect(
      await head.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.fontVariantCaps, s.borderBottom];
      }),
    ).toEqual(["all-small-caps", `1px solid ${hairFirm}`]);

    // The head and the Desk on the one measure, the head's rule 16 above
    // the text's first line.
    const column = await measure(page);
    const desk = await stableBox(page, ".desk");
    const top = await px(page, "--text-top");
    expect(desk).toMatchObject({ ...column, y: top });
    const runhead = await stableBox(page, ".ed-runhead");
    expect(runhead).toMatchObject(column);
    expect(runhead.y + runhead.height).toBe(top - 16);

    await expect(page.locator(".desk-where")).toHaveText(
      "Ki — Void / The First Light",
    );
    expect(
      await page
        .locator(".desk-where")
        .evaluate((el) => getComputedStyle(el).fontStyle),
    ).toBe("italic");
    expect(
      await page
        .locator(".desk-last")
        .evaluate((el) => getComputedStyle(el).borderLeft),
    ).toBe(`1px solid ${hairFirm}`);
    const control = await page.locator(".desk-primary").evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.outline, s.outlineOffset];
    });
    expect(control).toEqual([ink, `${gilt} solid 1px`, "-4px"]);
    // With Contents open the structure is the way somewhere else.
    await expect(page.locator(".desk-quiet")).toHaveCount(0);

    // The shape: four Parts, the writer's own marked, as one image.
    const shape = page
      .locator(".desk")
      .getByRole("img", { name: /^Once Dark: 4 parts/ });
    await expect(shape).toBeVisible();
    await expect(page.locator(".sr-nums span")).toHaveText([
      "01",
      "02",
      "03",
      "04",
    ]);
    await expect(page.locator('.sr-nums [data-current="1"]')).toHaveText("01");
    await expect(page.locator(".sr-counts span")).toHaveText([
      "633",
      "512",
      "401",
      "280",
    ]);
    // One column per Part across the measure, 8 between them, each 8 tall.
    const parts = page.locator(".sr-part");
    const share = (column.width - 3 * 8) / 4;
    for (let i = 0; i < 4; i++) {
      const part = (await parts.nth(i).boundingBox())!;
      expect(part.x).toBeCloseTo(column.x + i * (share + 8), 1);
      expect(part.width).toBeCloseTo(share, 1);
      expect(part.height).toBe(8);
    }
    // The first Part's two Sections as ink rules at their share of it,
    // 412 and 221 of 1,000, the room after them to the column's end.
    const first = await parts
      .first()
      .locator("i")
      .evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            cls: el.className,
            mark: el.getAttribute("data-mark"),
            width: r.width,
            right: r.right,
            ground: getComputedStyle(el).backgroundColor,
          };
        }),
      );
    expect(first.map((r) => [r.cls, r.mark])).toEqual([
      ["sr-rule", "cut"],
      ["sr-rule", "written"],
      ["sr-room", null],
    ]);
    expect(first[0].width).toBeCloseTo(0.412 * share, 0);
    expect(first[1].width).toBeCloseTo(0.221 * share, 0);
    expect(first[0].ground).toBe(ink);
    expect(first[1].ground).toBe(ink);
    expect(first[2].right).toBeCloseTo(column.x + share, 1);

    await expect(page.locator(".desk-ledger")).toHaveText(
      /since Tuesday\s*\+152 words\s*6 sections\s*last written Tue 21:14\s*1,826 total/,
    );
    const rule = await page
      .locator(".desk-thread")
      .evaluate((el) => getComputedStyle(el).borderLeft);
    expect(rule).toBe(`1px solid ${await token(page, "--attention", "color")}`);
  });
}

test("a folded panel offers the way somewhere else", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Narrow the panel" }).click();
  await expect(page.locator(".desk-quiet")).toHaveText("Open something else");
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  // The measure re-centres in the room the panel gave up.
  const column = await measure(page);
  expect(await stableBox(page, ".desk")).toMatchObject(column);
  expect(await stableBox(page, ".ed-runhead")).toMatchObject(column);
  // The second choice beside the ink button, its words in a hairline.
  const primary = (await page.locator(".desk-primary").boundingBox())!;
  const quiet = (await page.locator(".desk-quiet").boundingBox())!;
  expect(quiet.y).toBe(primary.y);
  expect(quiet.x).toBeGreaterThan(primary.x + primary.width);
  expect(
    await page
      .locator(".desk-quiet")
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).toBe(`${await token(page, "--hair-firm", "color")} 0px 0px 0px 1px inset`);
});

test("the crumb's project name is a route back to the Desk", async ({
  page,
}) => {
  // The chrome over the window takes no pointer, nor does the crumb that
  // labels where the writer is, so the name inside it hands itself one back.
  // A real press hit-tests where a dispatched click would not.
  await open(page);
  await page
    .getByRole("button", { name: "The First Light", exact: true })
    .click();
  await expect(page.locator(".editor")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".desk")).toHaveCount(0);

  const name = page.locator(".titlebar-project");
  await expect(name).toHaveText("Once Dark");
  const hit = await name.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(
      document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
    );
  });
  expect(hit).toBe(true);
  await name.click();
  await expect(page.locator(".desk")).toBeVisible();
});

test("beside the open Dock the head keeps to the column", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openVisionProject(page, { variant: "light", text: "desk" });
  await expect(page.locator(".desk")).toBeVisible({ timeout: 20_000 });
  await openDockFace(page, "notes");
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-dock", "1");
  const desk = await stableBox(page, ".desk");
  const head = await stableBox(page, ".ed-runhead");
  expect(desk.width).toBe(await px(page, "--editor-width"));
  expect(head.width).toBe(desk.width);
  expect(head.x).toBe(desk.x);
  const dock = await stableBox(page, ".ed-dock");
  const crops = await stableBox(page, ".crop-frame");
  expect(crops.x + crops.width).toBeLessThanOrEqual(dock.x);
  expect(desk.x + desk.width).toBeLessThan(crops.x + crops.width);
});

test("Matte keeps its Desk", async ({ page }) => {
  await open(page, "matte");
  await expect(page.locator(".desk .spine")).toBeVisible();
  await expect(page.locator(".spine-rules")).toHaveCount(0);
  await expect(page.locator(".ed-runhead")).toHaveCount(0);
  expect(
    await page.locator(".desk").evaluate((el) => getComputedStyle(el).display),
  ).toBe("flex");
});
