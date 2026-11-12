// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { settleTransitions, stableBox } from "./probe";
import {
  openDockFace,
  openFirstLight,
  openVisionProject,
  type VisionOptions,
} from "./visionProject";

// Vision's Reference: Matte's shelves, painted as the book. Each shelf's
// head is in small capitals, its adds in italic words; the open title is in
// verdigris with no caret mark, and a kept title is in the third ink with
// its closed eye at rest. A row's glyphs stand 24 apart. The shelves fold,
// the divider moves and Edit edits. Matte keeps its two columns of cards
// and its divider.

test.use({ timezoneId: "UTC", locale: "en-GB" });

async function open(
  page: Page,
  family?: VisionOptions["family"],
  variant = "light",
) {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, {
    variant: variant as "light" | "dark",
    text: "section",
    family,
  });
  await openFirstLight(page);
  await openDockFace(page, "reference");
  await expect(page.locator(".dock-read h1")).toHaveText("Animals");
}

async function box(page: Page, selector: string, nth = 0) {
  const b = await page.locator(selector).nth(nth).boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) };
}

/** A colour token as the page computes it. */
function colour(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement("i");
    probe.style.position = "absolute";
    probe.style.color = `var(${t})`;
    document.querySelector(".editor-shell")!.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, token);
}

const pseudo = (page: Page, selector: string, which: "::before" | "::after") =>
  page
    .locator(selector)
    .first()
    .evaluate((el, w) => getComputedStyle(el, w).content, which);

for (const variant of ["light", "dark"] as const) {
  test(`the open reference is marked in verdigris (${variant})`, async ({
    page,
  }) => {
    await open(page, undefined, variant);

    const heads = page.locator(".ref-card-head");
    await expect(heads).toHaveCount(4);
    for (const caps of await heads.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).fontVariantCaps),
    ))
      expect(caps).toBe("all-small-caps");
    const add = page.locator(".ref-card-add").first();
    await expect(add).toHaveText("Add a section");
    await expect(add).toHaveCSS("font-style", "italic");

    // The open title in verdigris, and no caret mark beside it.
    const current = page.locator(".ref-card-row[aria-current='true']");
    await expect(current).toHaveText("Animals");
    await expect(current).toHaveCSS("color", await colour(page, "--spark"));
    const row = ".ref-row:has(> .ref-card-row[aria-current='true'])";
    expect(await pseudo(page, row, "::before")).toBe("none");
    expect(await pseudo(page, row, "::after")).toBe("none");

    // The kept title in the third ink, its closed eye standing at rest.
    const kept = page.locator(".ref-row:has(> .ref-row-ai.barred)");
    await expect(kept).toHaveCount(1);
    await expect(kept.locator(".ref-card-row")).toHaveCSS(
      "color",
      await colour(page, "--ink-3"),
    );
    await expect(kept.locator(".ref-row-ai")).toHaveCSS("opacity", "1");
  });
}

test("a hovered row's glyphs stand 24 apart, and a kept row's return", async ({
  page,
}) => {
  await open(page);
  const humans = page.locator(".ref-row", { hasText: "Humans" }).first();
  await humans.hover();
  const eye = await humans.locator(".ref-row-ai").boundingBox();
  const pen = await humans.locator(".ref-row-ren").boundingBox();
  const bin = await humans.locator(".ref-row-del").boundingBox();
  expect(pen!.x - eye!.x).toBe(24);
  expect(bin!.x - pen!.x).toBe(24);
  const kept = page.locator(".ref-row:has(> .ref-row-ai.barred)");
  await kept.hover();
  await expect(kept.locator(".ref-row-del")).toBeVisible();
});

test("the shelves still fold, the divider still moves, Edit still edits", async ({
  page,
}) => {
  await open(page);
  // Guidebook, open, and Worldbuilding, folded, share the grid's first row.
  // A grid stretches its items to the row by default, which would draw the
  // folded card as tall as its open neighbour, an empty box under its head.
  const guide = ".ref-card-grid > .ref-card:nth-child(1)";
  const shelf = ".ref-card-grid > .ref-card:nth-child(2)";
  const guideOpen = await stableBox(page, guide);
  const folded = await stableBox(page, shelf);
  expect(folded.y).toBe(guideOpen.y);
  const border = await page.locator(shelf).evaluate((card) => {
    const s = getComputedStyle(card);
    return parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
  });
  expect(folded.height).toBe(
    (await stableBox(page, `${shelf} .ref-card-head`)).height + border,
  );
  expect(folded.height).toBeLessThan(guideOpen.height);

  const world = page.locator(".ref-card-head", { hasText: "Worldbuilding" });
  await world.click();
  await expect(world).toHaveAttribute("aria-expanded", "true");
  expect((await stableBox(page, shelf)).height).toBeGreaterThan(folded.height);
  expect(await stableBox(page, guide)).toEqual(guideOpen);
  await world.click();
  await expect(world).toHaveAttribute("aria-expanded", "false");

  // Folded again, the card is its head and nothing more: no sliver of the
  // first row shows under the head, and none can take a click.
  await settleTransitions(page);
  expect(await stableBox(page, `${shelf} .ref-card-inner`)).toMatchObject({
    height: 0,
  });
  expect((await stableBox(page, shelf)).height).toBe(folded.height);
  // The lowest point inside the card's border.
  const hit = await page.locator(shelf).evaluate((card) => {
    const r = card.getBoundingClientRect();
    const foot =
      r.bottom - parseFloat(getComputedStyle(card).borderBottomWidth);
    const at = document.elementFromPoint(r.x + r.width / 2, foot - 0.5);
    if (at?.closest(".ref-card-body")) return "the body";
    return at?.closest(".ref-card-head") ? "the head" : at?.className;
  });
  expect(hit).toBe("the head");
  const before = await stableBox(page, ".ref-divider");
  // The drag takes the divider by its middle.
  const middle = before.y + before.height / 2;
  await page.mouse.move(1000, middle);
  await page.mouse.down();
  await page.mouse.move(1000, middle - 60, { steps: 4 });
  await page.mouse.up();
  expect((await stableBox(page, ".ref-divider")).y).toBeLessThan(before.y - 30);
  await page.locator(".dock-edit-btn").click();
  await expect(page.locator(".dock-edit")).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("Matte keeps its cards and its divider", async ({ page }) => {
  await open(page, "matte");
  const guide = await box(page, ".ref-card-head", 0);
  const world = await box(page, ".ref-card-head", 1);
  expect(world.y).toBe(guide.y);
  expect(world.x).toBeGreaterThan(guide.x);
  expect((await box(page, ".ref-divider")).height).toBe(7);
  await expect(page.locator(".ref-card-lead").first()).toBeHidden();
});

/** A face's OpenType features as the page computes them, by tag. */
function features(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    const set: Record<string, number> = {};
    for (const [, tag, value] of s.fontFeatureSettings.matchAll(
      /"(\w{4})" (\d+)/g,
    ))
      set[tag] = Number(value);
    return { ligatures: s.fontVariantLigatures, set };
  });
}

// The UI face ligates `-->` into one arrow, so a template's
// `<!-- Hint: … -->` would read as an opening marker with no close. Every
// theme sets the dock in its own face, so each one is read here, the reading
// face and the editing face alike.
for (const family of ["vision", "matte", "shine", "radiant"] as const) {
  test(`the dock draws no ligatures, reading or editing (${family})`, async ({
    page,
  }) => {
    await open(page, family);

    // What the writer sees: the markers set in the reading face are as wide
    // as the same characters with every ligature switched off. A face with
    // no ligature for these characters measures the same either way, so the
    // computed features below carry the check there.
    const widths = await page.locator(".dock-read").evaluate((read) => {
      const width = (ligatures?: string) => {
        const probe = document.createElement("span");
        probe.textContent = "a --> b != c -> d";
        if (ligatures) {
          probe.style.fontVariantLigatures = ligatures;
          probe.style.fontFeatureSettings = "normal";
        }
        read.append(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        return w;
      };
      return { drawn: width(), off: width("none") };
    });
    expect(widths.drawn).toBe(widths.off);

    const reading = await features(page, ".dock-read");
    expect(reading.ligatures).toBe("none");
    // `font-variant-ligatures` leaves a face free to switch the same
    // substitutions on through its own feature table, and contextual
    // alternates is where most faces keep their arrows.
    for (const tag of ["liga", "clig", "calt", "dlig", "hlig"])
      expect(reading.set[tag], tag).toBe(0);
    // Required ligatures stay on: some scripts are unreadable without them.
    expect(reading.set.rlig).not.toBe(0);

    // Editing is a second state of the same document, so it agrees with the
    // reading face on every character.
    await page.locator(".dock-edit-btn").click();
    await expect(page.locator(".dock-edit")).toBeFocused();
    expect(await features(page, ".dock-edit")).toEqual(reading);
  });
}

// A template's fields come in two list shapes: the first question, alone
// before its hint, is a tight list item, and every later one shares a list
// with the answer slot above it across a blank line, so markdown renders it
// loose, inside a `<p>`. Both are the start of a field and both take the seam.
test("a template sets every field apart, whichever list shape it lands in", async ({
  page,
}) => {
  await open(page);
  await page
    .locator(".ref-card-add", { hasText: "Add a section" })
    .first()
    .click();
  await page.getByRole("button", { name: /^Story at a Glance/ }).click();
  // An untouched template is not written, so the writer adds a word.
  await page.locator(".dock-edit").press("Control+End");
  await page.keyboard.type("Noir");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".dock-read h1")).toHaveText("Story at a glance");

  const questions = await page.locator(".dock-read li").evaluateAll((items) =>
    items
      .map((li) => ({
        tight: li.matches(":has(> strong:only-child)"),
        loose: li.matches(":has(> p:only-child > strong:only-child)"),
        seam: parseFloat(getComputedStyle(li).marginTop),
      }))
      .filter((q) => q.tight || q.loose),
  );
  const tight = questions.filter((q) => q.tight);
  const loose = questions.filter((q) => q.loose);
  expect(tight.length).toBeGreaterThan(0);
  expect(loose.length).toBeGreaterThan(0);
  for (const q of questions) expect(q.seam).toBeGreaterThan(0);
  expect(loose[0].seam).toBe(tight[0].seam);

  // The reader keeps the interface's 13/1.62: the chat reads at its own
  // larger ramp, and the two surfaces do different jobs.
  expect(
    await page.locator(".dock-read").evaluate((read) => {
      const css = getComputedStyle(read);
      return `${css.fontSize}/${css.lineHeight}`;
    }),
  ).toBe("13px/21.06px");

  // The page reads label, guidance, blank. A question carries no bullet and
  // sits flush with the hint beneath it, since bold and a colon already mark
  // it; the answer keeps its bullet, so the dot means the writer writes
  // here. An unfilled answer is a ruled blank with nothing written in it.
  const form = await page.locator(".dock-read").evaluate((read) => {
    const hint = read.querySelector(".tpl-note")!.getBoundingClientRect();
    const items = [...read.querySelectorAll("li")];
    const question = items.find((li) => li.querySelector("strong"))!;
    const blank = items.find((li) => li.matches(":empty"))!;
    const after = (li: Element) => {
      const css = getComputedStyle(li, "::after");
      return `${css.content} ${css.borderBottomWidth} ${css.borderBottomStyle}`;
    };
    return {
      hintX: hint.x,
      questionX: question.getBoundingClientRect().x,
      question: getComputedStyle(question).listStyleType,
      answer: getComputedStyle(blank).listStyleType,
      blank: after(blank),
    };
  });
  expect(Math.abs(form.questionX - form.hintX)).toBeLessThanOrEqual(1);
  expect(form).toMatchObject({
    question: "none",
    answer: "disc",
    blank: '"" 1px dashed',
  });
});

// The first field under a heading takes the heading's gap, not the seam.
// The build wraps the seam's selector list in `:is()`, which gives every
// shape the loosest one's specificity, so the exception has to win against
// that too.
test("a field first under a heading takes the heading's gap, not the seam", async ({
  page,
}) => {
  await open(page);
  await page
    .locator(".ref-card-add", { hasText: "Add a section" })
    .first()
    .click();
  await page.getByRole("button", { name: /^Story at a Glance/ }).click();
  await page.locator(".dock-edit").press("Control+End");
  // An untouched template is not written, so the writer adds a word.
  await page.keyboard.type("Noir\n\n## Cast\n\n- **Lead:**\n- **Rival:**\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".dock-read h2")).toHaveText("Cast");

  const [first, second] = await page
    .locator(".dock-read h2 + ul > li")
    .evaluateAll((items) =>
      items.map((li) => parseFloat(getComputedStyle(li).marginTop)),
    );
  expect(first).toBe(0);
  expect(second).toBeGreaterThan(0);
});
