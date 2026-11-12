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
} from "./visionProject";

// Vision's Dock: the frame's Dock, `--dock-inset` from the window's right
// edge, `--dock-w` wide, its foot `--sheet-gap` above the window's. Beside
// the page it stands on the panels' horizon; while it covers the measure,
// Vision's leaves in a row step it down to the page's face, framed in ink
// with a gold rule inside. Its faces are named in words, in small capitals
// with no glyph, the open one in ink over a gold rule of its own. Matte
// keeps its card.

test.use({ timezoneId: "UTC", locale: "en-GB" });

async function open(page: Page, width = 1198, family?: "matte") {
  await page.setViewportSize({ width, height: 723 });
  await openVisionProject(page, { variant: "light", text: "section", family });
  await openFirstLight(page);
  await openDockFace(page, "ask");
}

/** A length token as the shell resolves it, in px. */
function length(page: Page, token: string): Promise<number> {
  return page.evaluate((t) => {
    const probe = document.createElement("i");
    probe.style.cssText = `position:absolute;width:var(${t})`;
    document.querySelector(".editor-shell")!.append(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }, token);
}

/** A colour token as the page computes it. */
function colour(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement("i");
    probe.style.cssText = `position:absolute;color:var(${t})`;
    document.querySelector(".editor-shell")!.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

const tabs = (page: Page) => page.locator(".dock-head .ui-bar-track button");
/** Each tab's word, without its tooltip. */
const words = (page: Page) => tabs(page).locator(":scope > span:not([class])");

async function dockAt(page: Page, top: string) {
  const viewport = page.viewportSize()!;
  const dock = await stableBox(page, ".ed-dock");
  const inset = await length(page, "--dock-inset");
  const width = await length(page, "--dock-w");
  const y = await length(page, top);
  expect(dock.x).toBeCloseTo(viewport.width - inset - width, 1);
  expect(dock.width).toBeCloseTo(width, 1);
  expect(dock.y).toBeCloseTo(y, 1);
  const gap = await length(page, "--sheet-gap");
  expect(dock.y + dock.height).toBeCloseTo(viewport.height - gap, 1);
}

test("beside the page the Dock stands on the panels' horizon", async ({
  page,
}) => {
  await open(page, 1700);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "0",
  );
  await dockAt(page, "--chrome-horizon");
  expect(
    await page
      .locator(".ed-dock")
      .evaluate((el) => getComputedStyle(el, "::after").opacity),
  ).toBe("0");
});

test("over the measure the Dock steps down to the page's face, framed", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "1",
  );
  await dockAt(page, "--face-top");
  const dock = page.locator(".ed-dock");
  expect(await dock.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
    await colour(page, "--ink"),
  );
  await expect
    .poll(() => dock.evaluate((el) => getComputedStyle(el, "::after").opacity))
    .toBe("1");
  expect(
    await dock.evaluate((el) => getComputedStyle(el, "::after").boxShadow),
  ).toContain(await colour(page, "--vision-gilt"));
});

test("the Dock's faces are named in words", async ({ page }) => {
  await open(page);
  await expect(words(page)).toHaveText([
    "Enlighten!",
    "Reference",
    "Notes",
    "Snapshot",
  ]);
  for (const svg of await tabs(page).locator(":scope > svg").all())
    await expect(svg).toBeHidden();
  expect(
    await tabs(page).evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).fontVariantCaps),
    ),
  ).toEqual(Array(4).fill("all-small-caps"));

  // The open face in ink over a gold rule; the rest in the third ink, over
  // no rule of the track's own.
  const ink = await colour(page, "--ink");
  const ink3 = await colour(page, "--ink-3");
  const gilt = await colour(page, "--vision-gilt");
  const looks = await tabs(page).evaluateAll((els) =>
    els.map((el) => ({
      color: getComputedStyle(el).color,
      rule: getComputedStyle(el).boxShadow,
    })),
  );
  expect(looks.map((l) => l.color)).toEqual([ink, ink3, ink3, ink3]);
  expect(looks[0].rule).toContain(gilt);
  for (const l of looks.slice(1)) expect(l.rule).toBe("none");
  // The names stand over one rule the width of the track, which Vision
  // leaves unpainted: the open name's gold is the only line drawn.
  expect(
    await page.locator(".dock-head .ui-bar-track").evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`;
    }),
  ).toBe("1px solid rgba(0, 0, 0, 0)");

  // Another face's word takes the ink and the rule when chosen.
  await tabs(page).nth(2).click();
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      tabs(page)
        .nth(2)
        .evaluate((el) => getComputedStyle(el).color),
    )
    .toBe(ink);

  // The way out keeps the app's icon.
  await expect(
    page.getByRole("button", { name: "Close the dock" }).locator("svg"),
  ).toBeVisible();
});

test("Matte keeps its Dock", async ({ page }) => {
  await open(page, 1198, "matte");
  await expect(words(page).first()).toHaveText("Enlighten!");
  expect(
    await page
      .locator(".ed-dock")
      .evaluate((el) => getComputedStyle(el).borderTopWidth),
  ).toBe("1px");
});
