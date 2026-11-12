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

// Vision's Notes: Matte's table, painted as the book. The way to a new note
// is italic words; the open note's title is in verdigris, deepened by a
// fifth of the ink on its row's band, with a verdigris rule down the row's
// edge and no caret mark. A row's actions arrive under the hand in room
// kept for them at rest, so nothing in the row moves; a kept note shows its
// closed eye at rest, its title in the third ink. Matte keeps its table, in
// the order of the names.

test.use({ timezoneId: "UTC", locale: "en-GB" });

async function open(page: Page, family?: "matte", variant = "light") {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, {
    variant: variant as "light" | "dark",
    text: "section",
    family,
  });
  await openFirstLight(page);
  await openDockFace(page, "notes");
  await expect(page.locator(".dock-read h1")).toHaveText("The river bridge");
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
  test(`the open note is marked in verdigris (${variant})`, async ({
    page,
  }) => {
    await open(page, undefined, variant);
    await expect(page.locator(".snap-add")).toHaveText("Add a new note");
    expect(await css(page, ".snap-add", "font-style")).toBe("italic");
    await expect(page.locator(".snap-title")).toHaveText([
      "Names of the animals",
      "The river bridge",
      "Visitors arrive late",
    ]);

    const spark = await colour(page, "var(--spark)");
    await expect(page.locator(".snap-row.selected .snap-title")).toHaveText(
      "The river bridge",
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

test("under the hand a note's actions arrive, and nothing in the row moves", async ({
  page,
}) => {
  await open(page);
  const row = page.locator(".snap-row", { hasText: "Names of the animals" });
  const actions = row.locator(".snap-actions");
  await expect(actions).toHaveCSS("opacity", "0");
  // Each piece's place in its row, so the list settling under the Dock's
  // head does not read as the row's own movement.
  const inRow = () =>
    row.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = (s: string) => {
        const b = el.querySelector(s)!.getBoundingClientRect();
        return { x: b.x - r.x, y: b.y - r.y };
      };
      return { when: at(".snap-when"), title: at(".snap-title") };
    });
  const before = await inRow();

  await row.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(row.locator(".snap-when")).toBeVisible();
  expect(await inRow()).toEqual(before);
  const titleNow = await row.locator(".snap-title").boundingBox();

  // The eye, the pencil and the bin, in that order, the bin at the row's end.
  const eye = await row.locator(".ref-row-ai").boundingBox();
  const pen = await row.getByRole("button", { name: "Rename" }).boundingBox();
  const bin = await row.getByRole("button", { name: "Delete" }).boundingBox();
  const end = await row.boundingBox();
  expect(eye!.x).toBeGreaterThan(titleNow!.x);
  expect(pen!.x).toBeGreaterThan(eye!.x + eye!.width - 1);
  expect(bin!.x).toBeGreaterThan(pen!.x + pen!.width - 1);
  expect(bin!.x + bin!.width).toBeCloseTo(end!.x + end!.width, 0);
});

// The notes table is the snapshot table's grid. Only where there is an
// Assistant do its rows carry a third control, the AI toggle, and only there
// does the actions track widen; without one the rows keep the snapshot
// table's track, so the delete stands at the same trailing edge in both
// faces. The track is the face's, so every row shares one template.
test("the notes' actions track widens for the AI toggle, and only for it", async ({
  page,
}) => {
  await open(page);
  const rows = () =>
    page.locator(".notes-face").evaluate((face) =>
      [...face.querySelectorAll(".snap-row")].map((row) => {
        const actions = row.querySelector(".snap-actions")!;
        return {
          columns: getComputedStyle(row).gridTemplateColumns,
          fits: actions.scrollWidth <= actions.clientWidth,
          end: row
            .querySelector(".snap-actions > :last-child")!
            .getBoundingClientRect().right,
        };
      }),
    );
  const withAssistant = await rows();
  expect(withAssistant.length).toBeGreaterThan(1);
  for (const row of withAssistant)
    expect(row).toMatchObject({
      columns: withAssistant[0].columns,
      fits: true,
    });

  // The face as it is drawn without an Assistant: no `data-ai-toggle` on
  // the face and no toggle in any row.
  await page.locator(".notes-face").evaluate((face) => {
    face.removeAttribute("data-ai-toggle");
    for (const eye of face.querySelectorAll<HTMLElement>(".ref-row-ai"))
      eye.style.display = "none";
  });
  const without = await rows();
  for (const row of without)
    expect(row).toMatchObject({ columns: without[0].columns, fits: true });

  await openDockFace(page, "snapshot");
  const snapshot = await page
    .locator(".snap-row:not(.adopted)")
    .first()
    .getByRole("button", { name: "Delete" })
    .boundingBox();
  for (const row of without)
    expect(row.end).toBeCloseTo(snapshot!.x + snapshot!.width, 1);
});

test("a kept note keeps its closed eye after its date", async ({ page }) => {
  await open(page);
  const row = page.locator(".snap-row", { hasText: "Visitors arrive late" });
  await row.hover();
  await row.locator(".ref-row-ai").click();
  await page.mouse.move(600, 600);
  const eye = row.locator(".ref-row-ai.barred");
  await expect(eye).toBeVisible();
  await expect(eye).toHaveCSS("opacity", "1");
  await expect(row.locator(".snap-when")).toBeVisible();
  const when = await row.locator(".snap-when").boundingBox();
  expect((await eye.boundingBox())!.x).toBeGreaterThan(when!.x + when!.width);
  await expect(row.locator(".snap-title")).toHaveCSS(
    "color",
    await colour(page, "var(--ink-3)"),
  );
  // Put back as the fixture has it.
  await row.hover();
  await row.locator(".ref-row-ai").click();
  await expect(row.locator(".ref-row-ai.barred")).toHaveCount(0);
});

test("under the keyboard a note's verbs stand after its date", async ({
  page,
}) => {
  await open(page);
  const row = page.locator(".snap-row", { hasText: "The river bridge" });
  // A key first, so the focus that follows is the keyboard's.
  await page.keyboard.press("Shift");
  await row.locator(".ref-row-ai").focus();
  await expect(row.locator(".snap-when")).toBeVisible();
  await expect(row.getByRole("button", { name: "Delete" })).toBeVisible();
});

test("Matte keeps its table, in the order of the names", async ({ page }) => {
  await open(page, "matte");
  await expect(page.locator(".snap-title")).toHaveText([
    "Names of the animals",
    "The river bridge",
    "Visitors arrive late",
  ]);
  await expect(page.locator(".snap-when").first()).not.toHaveText(/^Thu/);
  expect((await box(page, ".ref-divider")).height).toBe(7);
});
