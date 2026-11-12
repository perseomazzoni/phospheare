// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { FRAME_GEOMETRY } from "../src/theme/domain/geometry";
import {
  openDockFace,
  openFirstLight,
  openVisionProject,
} from "./visionProject";

// Vision's page as a book sets it, on the frame's measure and sizes: a
// running head over the text with a gold square between the book and its
// Part, the title over three gold marks, the chapter's first line in small
// capitals, and the folio in a square ruled in gold under the text. The
// comments stand beside the text as notes, the hairline rule and the column
// placed by the frame; a passage's end and a note's byline are marked by a
// small square in the spark, never a ‸. Matte draws none of it.

test.use({ timezoneId: "UTC", locale: "en-GB" });

async function open(page: Page, family?: "matte") {
  await page.setViewportSize({ width: 1198, height: 691 });
  await openVisionProject(page, { variant: "light", text: "section", family });
  await openFirstLight(page);
}

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

/** A colour token as the browser computes it, so it compares with a
 * computed rgb(). */
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
};

/** The frame's notes: a 28 gap past the text, the rule, and the notes 15
 * into their column. */
const RULE_GAP = 28;
const NOTE_INSET = 43;
const COLUMN = 208;

test("the text is set as a book's chapter", async ({ page }) => {
  await open(page);
  const set = await page.evaluate(() => {
    const editor = document.querySelector(".editor")!.getBoundingClientRect();
    const h1 = document.querySelector(".editor > h1")!;
    const range = document.createRange();
    range.selectNodeContents(h1);
    const title = range.getBoundingClientRect();
    const paras = [...document.querySelectorAll(".editor > p")].map((p) => {
      const cs = getComputedStyle(p);
      return {
        indent: parseFloat(cs.textIndent),
        size: parseFloat(cs.fontSize),
        margin: cs.marginTop,
      };
    });
    const first = getComputedStyle(
      document.querySelector(".editor > h1 + p")!,
      "::first-line",
    );
    return {
      editorMid: editor.left + editor.width / 2,
      titleMid: title.left + title.width / 2,
      paras,
      firstLine: first.fontVariantCaps,
    };
  });
  // The title centred over the text.
  expect(Math.abs(set.titleMid - set.editorMid)).toBeLessThan(1);
  // The first paragraph flush, the rest indented 1.4em with no space between.
  expect(set.paras[0].indent).toBe(0);
  for (const p of set.paras.slice(1)) {
    expect(p.indent).toBeCloseTo(p.size * 1.4, 1);
    expect(p.margin).toBe("0px");
  }
  // The chapter's opening line in small capitals.
  expect(set.firstLine).toBe("all-small-caps");
});

test("the title stands over a square, a diamond and a square in gold", async ({
  page,
}) => {
  await open(page);
  const gilt = await token(page, "--vision-gilt");
  const marks = await page.locator(".editor > h1").evaluate((h1) => {
    const before = getComputedStyle(h1, "::before");
    const after = getComputedStyle(h1, "::after");
    return {
      width: h1.getBoundingClientRect().width,
      diamond: {
        ground: before.backgroundColor,
        turned: before.transform !== "none",
        left: parseFloat(before.left),
        size: [before.width, before.height],
      },
      squares: { shadow: after.boxShadow, left: parseFloat(after.left) },
    };
  });
  expect(marks.diamond.ground).toBe(gilt);
  expect(marks.diamond.turned).toBe(true);
  expect(marks.diamond.size).toEqual(["5px", "5px"]);
  expect(marks.squares.shadow).toBe(
    `${gilt} -11px 0px 0px 0px, ${gilt} 11px 0px 0px 0px`,
  );
  // Centred under a centred title.
  expect(marks.diamond.left).toBeCloseTo(marks.width / 2 - 2.5, 1);
  expect(marks.squares.left).toBeCloseTo(marks.width / 2 - 2.5, 1);
});

test("the running head and the folio frame the text and its notes", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".cm-layer")).toHaveAttribute("data-mode", "notes");
  const head = page.locator(".ed-runhead");
  await expect(head).toHaveText(/^Once Dark · .+\d$/);
  await expect(head).toHaveAttribute("aria-hidden", "true");

  // The head starts where the text does, spans the text and its notes, and
  // its rule stands 16 over the text.
  const text = await box(page, ".editor");
  const width = await px(page, "--editor-width");
  const headBox = await box(page, ".ed-runhead");
  expect(headBox.x).toBe(text.x);
  expect(headBox.width).toBe(width + COLUMN);
  expect(headBox.y + headBox.height).toBeCloseTo(text.y - 16, 0);

  // A gold square between the book and its Part, the separator's glyph
  // clear.
  const gilt = await token(page, "--vision-gilt");
  const sep = await page
    .locator(".ed-runhead-sep")
    .evaluate((el) => [
      getComputedStyle(el).color,
      getComputedStyle(el).backgroundImage,
      getComputedStyle(el).backgroundSize,
    ]);
  expect(sep).toEqual([
    "rgba(0, 0, 0, 0)",
    `linear-gradient(${gilt}, ${gilt})`,
    "4px 4px",
  ]);

  // The folio repeats the head's number in lining figures, in a square ruled
  // in gold, 18 under the text and centred under the text and its notes.
  const number = await head.locator("b").textContent();
  const folio = page.locator(".ed-folio > span");
  await expect(folio).toHaveText(number!);
  await expect(page.locator(".ed-folio")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  const rule = await folio.evaluate((el) => {
    const cs = getComputedStyle(el);
    return [
      cs.borderTopWidth,
      cs.borderTopStyle,
      cs.borderTopColor,
      cs.fontVariantNumeric,
    ];
  });
  expect(rule).toEqual(["1px", "solid", gilt, "lining-nums"]);
  const folioBox = await box(page, ".ed-folio > span");
  expect(folioBox.y).toBeCloseTo(text.y + text.height + 18, 0);
  expect(folioBox.x + folioBox.width / 2).toBeCloseTo(
    text.x + (width + COLUMN) / 2,
    0,
  );
});

test("the comments stand in the margin as notes, each marked by a square", async ({
  page,
}) => {
  await open(page);
  await expect(page.locator(".cm-layer")).toHaveAttribute("data-mode", "notes");
  const text = await box(page, ".editor");
  const right = text.x + text.width;
  const rule = page.locator(".cm-rule");
  const ruleBox = await box(page, ".cm-rule");
  expect({ x: ruleBox.x, width: ruleBox.width }).toEqual({
    x: right + RULE_GAP,
    width: 1,
  });
  expect(
    await rule.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(await token(page, "--hair"));
  const notes = page.locator('.cm-slot:not([data-slot="chapter"])');
  await expect(notes).toHaveCount(2);
  for (const left of await notes.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().left),
  ))
    expect(left).toBe(right + NOTE_INSET);

  // Each passage's end is a 4px square in the spark; its ‸ is not drawn.
  const spark = await token(page, "--spark");
  const marks = await page.locator(".cm-pmark").evaluateAll((els) =>
    els.map((el) => {
      const square = getComputedStyle(el, "::after");
      return {
        glyph: getComputedStyle(el).color,
        square: [square.width, square.height, square.backgroundColor],
      };
    }),
  );
  expect(marks).toHaveLength(2);
  for (const mark of marks)
    expect(mark).toEqual({
      glyph: "rgba(0, 0, 0, 0)",
      square: ["4px", "4px", spark],
    });

  // The byline: the name in small capitals after a square in the spark.
  const name = await page
    .locator(".cm-slot .cm-name")
    .first()
    .evaluate((el) => {
      const square = getComputedStyle(el, "::before");
      return [
        getComputedStyle(el).fontVariantCaps,
        square.content,
        square.width,
        square.backgroundColor,
      ];
    });
  expect(name).toEqual(["all-small-caps", '"" / ""', "4px", spark]);
});

test("beside a Dock that covers the text the comments go to their squares", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  await openDockFace(page, "ask");
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-dock-over",
    "1",
  );
  await expect(page.locator(".cm-layer")).toHaveAttribute(
    "data-mode",
    "markers",
  );
  await expect(page.locator(".cm-rule")).toHaveCount(0);
  // The text keeps the frame's measure: with the notes gone it has nothing
  // to give way to.
  expect((await box(page, ".editor")).width).toBe(FRAME_GEOMETRY.measure);
  // Each mark is a square in the spark, and opens its thread.
  const mark = page.locator('.cm-marker[data-at="end"]').first();
  expect(
    await mark.evaluate((el) => {
      const square = getComputedStyle(el, "::after");
      return [
        square.content,
        square.width,
        square.height,
        square.backgroundColor,
      ];
    }),
  ).toEqual(['"" / ""', "4px", "4px", await token(page, "--spark")]);
  await mark.click();
  await expect(page.getByRole("dialog", { name: "Comment" })).toBeVisible();
});

/** The text's box, and the notes' left edges. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const text = document.querySelector(".editor")!.getBoundingClientRect();
    return {
      left: Math.round(text.left),
      right: Math.round(text.right),
      width: text.width,
      notes: [
        ...document.querySelectorAll('.cm-layer[data-mode="notes"] .cm-slot'),
      ].map((slot) => Math.round(slot.getBoundingClientRect().left)),
    };
  });

test("the text holds its measure through a drag, the notes beside it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  const grip = (await page.locator(".panel-resize").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + 40, {
    steps: 8,
  });
  await page.mouse.up();
  const at = await layout(page);
  expect(at.width).toBeCloseTo(FRAME_GEOMETRY.measure, 1);
  await expect
    .poll(async () => (await layout(page)).notes)
    .toEqual([
      at.right + NOTE_INSET,
      at.right + NOTE_INSET,
      at.right + NOTE_INSET,
    ]);
});

test("the text gives way to the notes down to 480", async ({ page }) => {
  // The notes are part of the page, so the text is what the room leaves once
  // their column is paid, up to the measure. The room is the window less the
  // surface's two paddings: the panel's reserve and the desk's right edge.
  // Below 480 the notes cannot stand: the comments go to their squares and
  // the text keeps the measure.
  await page.setViewportSize({ width: 1100, height: 691 });
  await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  const room = () =>
    page.locator(".editor-surface").evaluate((el) => {
      const cs = getComputedStyle(el);
      return (
        window.innerWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight)
      );
    });
  for (const width of [1100, 1198]) {
    await page.setViewportSize({ width, height: 691 });
    const text = (await room()) - COLUMN;
    expect(text).toBeGreaterThan(480);
    expect(text).toBeLessThan(FRAME_GEOMETRY.measure);
    await expect(page.locator(".cm-layer")).toHaveAttribute(
      "data-mode",
      "notes",
    );
    await expect.poll(async () => (await layout(page)).width).toBe(text);
  }
});

test("beside the Dock a wide window keeps the notes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openVisionProject(page, { variant: "light", text: "section" });
  await openFirstLight(page);
  await openDockFace(page, "ask");
  const measure = FRAME_GEOMETRY.measure;
  const at = await layout(page);
  expect(at.width).toBeCloseTo(measure, 1);
  await expect(page.locator(".cm-layer")).toHaveAttribute("data-mode", "notes");
  // Dragging the Dock wider moves the page and keeps its measure.
  const grip = (await page.locator(".dock-resize").boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 100, grip.y + 40, {
    steps: 8,
  });
  await page.mouse.up();
  const after = await layout(page);
  expect(after.width).toBeCloseTo(measure, 1);
  expect(after.left).toBeLessThan(at.left);
  await expect
    .poll(async () => (await layout(page)).notes[0])
    .toBe(after.right + NOTE_INSET);
});

test("the caret is drawn in ink", async ({ page }) => {
  await open(page);
  const caret = page.locator(".fake-cursor");
  await expect(caret).toBeVisible();
  expect(
    await caret.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe(await token(page, "--ink"));
});

test("the head, the text and the folio scroll together", async ({ page }) => {
  await open(page);
  const surface = page.locator(".editor-surface");
  const at = () =>
    page.evaluate(() =>
      [".ed-runhead", ".editor", ".ed-folio"].map(
        (s) => document.querySelector(s)!.getBoundingClientRect().top,
      ),
    );
  const before = await at();
  await surface.evaluate((el) => el.scrollBy(0, 120));
  const after = await at();
  expect(after.map((y, i) => Math.round((before[i] - y) * 100) / 100)).toEqual([
    120, 120, 120,
  ]);
});

test("a note longer than the text keeps the rule and the folio under it", async ({
  page,
}) => {
  // `Margin` writes how far the notes run past the text as `--cm-overhang`,
  // so the page lengthens its rule and keeps its folio under the last note.
  await open(page);
  const last = page.locator('.cm-slot:not([data-slot="chapter"])').last();
  await last.evaluate((slot) => {
    const more = document.createElement("p");
    more.textContent = "A note that runs on. ".repeat(80);
    slot.querySelector(".cm-card")!.append(more);
  });
  const ends = () =>
    page.evaluate(() => {
      const bottom = (s: string) =>
        [...document.querySelectorAll(s)].at(-1)!.getBoundingClientRect();
      return {
        note: bottom(".cm-slot").bottom,
        rule: bottom(".cm-rule").bottom,
        folio: bottom(".ed-folio").top,
        text: bottom(".editor").bottom,
      };
    });
  await expect
    .poll(async () => {
      const at = await ends();
      return at.note > at.text + 100 && at.rule >= at.note - 1;
    })
    .toBe(true);
  // The folio eases down on the frame's `translate` transition.
  await expect
    .poll(async () => {
      const at = await ends();
      return at.folio - at.note;
    })
    .toBeGreaterThanOrEqual(18);
});

test("without comments the page is the text alone, centred under the bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await openVisionProject(page, { variant: "light", text: "section" });
  await page.getByRole("button", { name: "The Dark", exact: true }).click();
  await expect(page.locator(".ed-runhead")).toBeVisible();
  const mid = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { mid: (r.left + r.right) / 2, width: r.width };
      });
  const bar = await mid(".bar-stack");
  const text = await mid(".editor");
  const head = await mid(".ed-runhead");
  expect(text.width).toBe(await px(page, "--editor-width"));
  expect(head).toEqual(text);
  // The page centres in the frame, whose middle the bar's is.
  expect(Math.abs(text.mid - bar.mid)).toBeLessThan(8);
  await expect(page.locator(".cm-rule")).toBeHidden();
});

test("Matte draws no running head, folio or margin rule", async ({ page }) => {
  await open(page, "matte");
  await expect(page.locator(".editor")).toBeVisible();
  await expect(page.locator(".ed-runhead")).toHaveCount(0);
  await expect(page.locator(".ed-folio")).toHaveCount(0);
  await expect(page.locator(".cm-rule")).toHaveCount(0);
});
