// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { stableBox } from "./probe";
import {
  openFirstLight,
  openVisionProject,
  type VisionStubs,
} from "./visionProject";

// Vision's contents: the structure panel attached to the window's edge and
// set as a classical book index. "Contents" stands between two gold squares;
// each Part is in spaced capitals over a hairline; every row runs on a dotted
// leader to its count; the chosen row is set in ink on a gold leader, with no
// ground and no caret mark. A row's menu hangs from its ⋮ as a slip of the
// page; folded, the contents are a rail of Part numbers; the find quotes each
// passage in two lines; the preferences card stands on the gear. Matte keeps
// its own panel. Sizes come from the frame's tokens, since Vision paints and
// the frame lays out.

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

async function open(
  page: Page,
  variant: "light" | "dark" = "light",
  text: "section" | "find" = "section",
) {
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, { variant, text });
  await openFirstLight(page);
}

/** The row of the node titled `title`. */
const row = (page: Page, title: string) =>
  page.locator(".dt-row", { has: page.locator(`.dt-label[title="${title}"]`) });

/** Every element whose generated content draws the ‸. */
const carets = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((el) =>
        ["::before", "::after"].some((at) =>
          getComputedStyle(el, at).content.includes("‸"),
        ),
      )
      .map((el) => el.className),
  );

test("the panel is attached to the window's edge under the titlebar", async ({
  page,
}) => {
  await open(page);
  const panel = await stableBox(page, ".doc-tree");
  expect(panel).toEqual({
    x: 0,
    y: await px(page, "--header-h"),
    width: (await px(page, "--panel-w")) + (await px(page, "--panel-left")),
    height: 691 - (await px(page, "--header-h")),
  });
});

test("the contents are set as a classical index", async ({ page }) => {
  await open(page);
  const ink = await token(page, "--ink", "color");
  const gilt = await token(page, "--vision-gilt", "color");
  const hair = await token(page, "--hair", "color");

  // "Contents" in full ink between two gold squares.
  const label = page.locator(".dt-region-head > .dt-region-label");
  await expect(label).toHaveText("Contents");
  const title = await label.evaluate((el) => {
    const square = (at: string) => {
      const s = getComputedStyle(el, at);
      return [s.width, s.height, s.backgroundColor];
    };
    return {
      ink: getComputedStyle(el).color,
      before: square("::before"),
      after: square("::after"),
    };
  });
  expect(title).toEqual({
    ink,
    before: ["4px", "4px", gilt],
    after: ["4px", "4px", gilt],
  });

  // A Part in spaced capitals, in ink, over a hairline; it counts everything
  // in it: 412 and 254.
  const part = row(page, "Ki — Void");
  const look = await part.evaluate((el) => {
    const name = getComputedStyle(el.querySelector(".dt-label")!);
    return {
      caps: name.textTransform,
      ink: name.color,
      tracking: parseFloat(getComputedStyle(el).letterSpacing),
      rule: getComputedStyle(el).backgroundImage,
    };
  });
  expect(look.caps).toBe("uppercase");
  expect(look.ink).toBe(ink);
  expect(look.tracking).toBeGreaterThan(0);
  expect(look.rule).toContain(hair);
  await expect(part.locator(".dt-words")).toHaveText("666");

  // The leader runs from the name and its comments to the count.
  const first = row(page, "The First Light");
  const name = (await first.locator(".dt-label").boundingBox())!;
  const comments = (await first.locator(".cm-bubbles").boundingBox())!;
  const lead = (await first.locator(".dt-lead").boundingBox())!;
  const count = (await first.locator(".dt-words").boundingBox())!;
  expect(comments.x).toBeGreaterThanOrEqual(right(name) - 0.5);
  expect(lead.x).toBeGreaterThanOrEqual(right(comments) - 0.5);
  expect(right(lead)).toBeLessThanOrEqual(count.x + 0.5);
  expect(lead.width).toBeGreaterThan(20);
  // The marks follow the name, so the counts keep one column.
  const ends = await page
    .locator(".dt-tree-body .dt-row .dt-words")
    .evaluateAll((all) => all.map((el) => el.getBoundingClientRect().right));
  expect(new Set(ends.map(Math.round)).size).toBe(1);

  // Every piece of the panel stays: each Part's add row, the bin, the
  // comments waiting and the § of a summary.
  await expect(page.locator(".dt-tree-body .dt-add:visible")).toHaveText([
    "Section",
    "Section",
    "Part",
  ]);
  await expect(page.locator(".dt-bin")).toBeVisible();
  await expect(first.locator(".cm-bubbles")).toBeVisible();
  await expect(page.locator("button.dt-summary").first()).toBeVisible();
  expect(stubs.unexpected).toEqual([]);
});

test("the chosen row is set in ink on a gold leader", async ({ page }) => {
  await open(page);
  const ink = await token(page, "--ink", "color");
  const gilt = await token(page, "--vision-gilt", "color");
  const rowInk = await token(page, "--row-ink", "color");
  const leaderInk = await token(page, "--leader-ink", "color");
  const read = (title: string) =>
    row(page, title).evaluate((el) => ({
      name: getComputedStyle(el.querySelector(".dt-label")!).color,
      count: getComputedStyle(el.querySelector(".dt-words")!).color,
      leader: getComputedStyle(el.querySelector(".dt-lead")!).backgroundImage,
      ground: getComputedStyle(el).backgroundColor,
      mark: getComputedStyle(el, "::before").backgroundColor,
    }));

  await expect(row(page, "The First Light")).toHaveClass(/\bactive\b/);
  const chosen = await read("The First Light");
  expect(chosen).toMatchObject({
    name: ink,
    count: ink,
    ground: "rgba(0, 0, 0, 0)",
    mark: "rgba(0, 0, 0, 0)",
  });
  expect(chosen.leader).toContain(gilt);

  const other = await read("The Dark");
  expect(other).toMatchObject({ name: rowInk, count: rowInk });
  expect(other.leader).toContain(leaderInk);
  expect(await carets(page)).toEqual([]);
});

test("a row's menu hangs from its ⋮ as a slip of the page", async ({
  page,
}) => {
  await open(page);
  const before = await box(page, ".dt-row.active");
  const more = page.getByRole("button", {
    name: "Actions for “The First Light”",
  });
  const dots = (await more.boundingBox())!;
  await more.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const slip = await stableBox(page, "[role='menu']");
  expect(right(slip)).toBeCloseTo(right(dots), 0);
  expect(slip.y).toBeCloseTo(bottom(dots) + 4, 0);
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Rename",
    "Select",
    "Move…",
    "Update summary",
    "Move to the bin",
  ]);
  // The page's paper under one firm hairline.
  const look = await menu.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.borderTopWidth, s.borderTopColor];
  });
  expect(look).toEqual([
    await token(page, "--paper-raised", "color"),
    "1px",
    await token(page, "--hair-firm", "color"),
  ]);
  // Opening it scrolls nothing sideways: the rows stay where they were.
  expect(await box(page, ".dt-row.active")).toEqual(before);
  expect(await carets(page)).toEqual([]);
});

test("folded, the contents are a rail of Part numbers", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Narrow the panel" }).click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  const rail = (await px(page, "--panel-w")) + (await px(page, "--panel-left"));
  await expect
    .poll(async () => (await box(page, ".doc-tree")).width)
    .toBe(rail);
  const strip = await stableBox(page, ".doc-tree");
  const parts = page.locator(".dt-rail button");
  await expect(parts).toHaveText(["01", "02", "03", "04"]);
  // Each number centres on the strip; the writer's Part is in ink, the
  // others in the rows' ink, and none has a ground.
  const ink = await token(page, "--ink", "color");
  const rowInk = await token(page, "--row-ink", "color");
  const numbers = await parts.evaluateAll((all) =>
    all.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        centre: r.x + r.width / 2,
        ink: getComputedStyle(el).color,
        ground: getComputedStyle(el).backgroundColor,
      };
    }),
  );
  for (const [i, n] of numbers.entries()) {
    expect(Math.abs(n.centre - (strip.x + strip.width / 2))).toBeLessThan(1);
    expect(n.ink).toBe(i === 0 ? ink : rowInk);
    expect(n.ground).toBe("rgba(0, 0, 0, 0)");
  }
  await expect(parts.first()).toHaveAttribute("aria-current", "true");
  // The numbers take the column the tree stood in: neither face is drawn.
  for (const selector of [".dt-bodies", ".dt-search", ".dt-tree-body"])
    await expect(page.locator(selector), selector).toBeHidden();
  await expect(page.locator(".dt-dock-button")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Writing preferences" }),
  ).toBeVisible();
});

test("folded, the rail draws neither the contents nor a live search", async ({
  page,
}) => {
  // The rail is 52px wide, too narrow for a list or for results. A search
  // left open when the panel folds keeps its query, and the rail still draws
  // none of it: the box both faces share is hidden, and with it each face.
  await open(page, "light", "find");
  const field = page.getByRole("searchbox", { name: "Find in this project" });
  await field.fill("elephant");
  await expect(page.locator(".dt-search-excerpt").first()).toBeVisible();
  await page.getByRole("button", { name: "Narrow the panel" }).click();
  await expect(page.locator(".editor-shell")).toHaveAttribute("data-rail", "1");
  await expect(page.locator(".dt-find input")).toHaveValue("elephant");
  await expect(page.locator(".dt-rail button").first()).toBeVisible();
  for (const selector of [".dt-bodies", ".dt-search", ".dt-tree-body"])
    await expect(page.locator(selector), selector).toBeHidden();
});

test("each quotation shows its match within its two lines", async ({
  page,
}) => {
  await open(page, "light", "find");
  await page
    .getByRole("searchbox", { name: "Find in this project" })
    .fill("elephant");
  const heads = page.locator(".dt-search .dt-region-label");
  await expect(heads).toHaveText(["In the text", "Characters", "Enlighten!"]);
  // The results take at most the rows' length, as the tree stood.
  const results = await box(page, ".dt-search");
  const rows = await page.locator(".dt-tree-body").evaluate((body) => {
    const laid = [...body.children]
      .map((child) => child.getBoundingClientRect())
      .filter((r) => r.height > 0);
    return Math.round(laid[laid.length - 1].bottom - laid[0].top);
  });
  const room = await box(page, ".dt-bodies");
  expect(results.height).toBeCloseTo(Math.min(rows, room.height), 1);
  const excerpts = page.locator(".dt-search-excerpt");
  await expect(excerpts).toHaveCount(5);
  for (const excerpt of await excerpts.all()) {
    const quote = (await excerpt.boundingBox())!;
    const line = await excerpt.evaluate((el) =>
      parseFloat(getComputedStyle(el).lineHeight),
    );
    const mark = (await excerpt.locator("mark").boundingBox())!;
    expect(quote.height).toBeCloseTo(2 * line, 1);
    expect(bottom(mark)).toBeLessThanOrEqual(bottom(quote) + 0.5);
  }
});

for (const folded of [false, true])
  test(`the preferences card stands on the gear${folded ? " of the rail" : ""}`, async ({
    page,
  }) => {
    await open(page, "dark");
    if (folded)
      await page.getByRole("button", { name: "Narrow the panel" }).click();
    const gear = page.getByRole("button", { name: "Writing preferences" });
    await gear.click();
    const card = page.locator(".dt-prefs");
    await expect(card).toHaveAttribute("data-open", "1");
    await expect
      .poll(async () => bottom(await box(page, ".dt-prefs")))
      .toBeCloseTo((await gear.boundingBox())!.y - 8, 0);
    // Right-aligned to the gear, the 300px card would start off the window,
    // so it is clamped 8px in from the edge, open or folded.
    expect(await box(page, ".dt-prefs")).toMatchObject({ x: 8, width: 300 });
    // The chosen step is set in ink over a gold rule.
    const medium = page.getByRole("button", { name: "Medium" });
    await expect(medium).toHaveAttribute("aria-pressed", "true");
    expect(await medium.evaluate((el) => getComputedStyle(el).color)).toBe(
      await token(page, "--ink", "color"),
    );
    const rule = await page
      .getByRole("group", { name: "Prose size" })
      .locator(".ui-bar-track-thumb")
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(rule).toBe(
      `${await token(page, "--vision-gilt", "color")} 0px -1px 0px 0px inset`,
    );
    await expect(
      page.getByRole("checkbox", { name: "Smooth caret" }),
    ).toBeChecked();
  });

test("Matte keeps its panel", async ({ page }) => {
  await page.setViewportSize({ width: 1198, height: 691 });
  stubs = await openVisionProject(page, {
    variant: "light",
    text: "section",
    family: "matte",
  });
  await openFirstLight(page);
  // Matte's panel floats, its inset from the window's edge.
  expect((await stableBox(page, ".doc-tree")).x).toBe(
    await px(page, "--panel-left"),
  );
  const label = page.locator(".dt-region-head > .dt-region-label");
  await expect(label).toHaveText("Contents");
  expect(
    await label.evaluate((el) => getComputedStyle(el, "::before").content),
  ).toBe("none");
  const part = row(page, "Ki — Void");
  expect(
    await part
      .locator(".dt-label")
      .evaluate((el) => getComputedStyle(el).textTransform),
  ).toBe("none");
  expect(
    await part
      .locator(".dt-lead")
      .evaluate((el) => getComputedStyle(el).opacity),
  ).toBe("0");
  await expect(part.locator(".dt-idx")).toHaveText("01");
});
