// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { commentOn } from "./comments";
import { stableBox } from "./probe";
import { openFirstLight, openVisionProject } from "./visionProject";

// Radiant's editor is a sheet on a desk. The panel lies flat on the desk,
// attached to the window's edge under the title bar; the sheet stands on the
// chrome's horizon, `--sheet-gap` from the panel and the window's edges, its
// head rounded so its rim reads as the raised 12, and holds the bar. A
// pressed tool stands on the raised chip, the open Part is drawn apart
// on the spine, the comments are notes in the margin, and Radiant hides none
// of a row's marks.

test.use({ timezoneId: "UTC", locale: "en-US" });

async function open(page: Page, variant: "light" | "dark") {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, {
    variant,
    text: "section",
    family: "radiant",
  });
  await openFirstLight(page);
  // The pointer leaves the bar and the bar comes to rest, folded.
  await page.mouse.move(600, 715);
  await expect(page.locator(".editor-shell")).toHaveAttribute(
    "data-fold-engaged",
    "0",
  );
  await expect(page.locator(".bar-stack")).not.toHaveAttribute(
    "data-pinned",
    "1",
  );
}

/** A token as the browser computes it for `property`, so a hex token and a
 * computed rgb() compare. */
const token = (page: Page, name: string, property = "color") =>
  page.evaluate(
    ([n, p]) => {
      const probe = document.createElement("i");
      probe.style.setProperty(p, `var(${n})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p);
      probe.remove();
      return value;
    },
    [name, property] as const,
  );

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

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
}

for (const variant of ["light", "dark"] as const) {
  test(`the sheet lies on the desk beside the flat panel (${variant})`, async ({
    page,
  }) => {
    await open(page, variant);
    const [horizon, gap, panelLeft, panelW] = await Promise.all([
      px(page, "--chrome-horizon"),
      px(page, "--sheet-gap"),
      px(page, "--panel-left"),
      px(page, "--panel-w"),
    ]);
    const sheet = await page.locator(".editor-shell").evaluate((el) => {
      const cs = getComputedStyle(el, "::before");
      return {
        top: parseFloat(cs.top),
        left: parseFloat(cs.left),
        right: parseFloat(cs.right),
        bottom: parseFloat(cs.bottom),
        head: cs.borderTopLeftRadius,
        foot: cs.borderBottomLeftRadius,
        ground: cs.background,
      };
    });
    expect(sheet).toMatchObject({
      top: horizon,
      left: panelLeft + panelW + gap,
      right: gap,
      bottom: gap,
      // 12 less the gap the page's edge shadow spreads by.
      head: `${12 - gap}px`,
      foot: "0px",
    });
    expect(sheet.ground).toContain(await token(page, "--sheet"));
    expect(
      await page
        .locator(".editor-shell")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(await token(page, "--canvas"));

    // The panel lies flat on the desk under the title bar.
    const panel = await box(page, ".doc-tree");
    expect(panel).toMatchObject({ x: 0, y: 40 });

    // The bar stands its seat under the title bar, inside the sheet, the
    // frame's height, inside its edges.
    // The bar slides to its centre as the page settles.
    const bar = await stableBox(page, ".bar-stack .ui-bar");
    expect(bar.y).toBe(40 + (await px(page, "--bar-seat")));
    expect(bar.y).toBeGreaterThan(horizon);
    expect(bar.height).toBe(await px(page, "--bar-h"));
    expect(bar.x).toBeGreaterThanOrEqual(sheet.left + 10);
    expect(bar.x + bar.width).toBeLessThanOrEqual(1198 - gap - 10);

    // The prose slides under the bar, seen beside it, and is cut the bar's
    // seat below the sheet's head, so no line rises above the page into the
    // title bar's band. It is open to the sides, for the scrollbar and a
    // note beside the measure, and cut at the sheet's foot.
    const cut = horizon + (await px(page, "--bar-seat"));
    const surface = page.locator(".editor-surface");
    const under = await surface.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { clip: cs.clipPath, mask: cs.maskImage };
    });
    expect(under.clip).toBe(`inset(${cut}px -1198px ${gap + 1}px)`);
    expect(cut).toBeGreaterThan(bar.y);
    expect(cut).toBeLessThan(bar.y + bar.height);
    // Below the cut the prose fades in over 16px, so a line passing under
    // the bar thins away rather than shearing.
    expect(under.mask).toBe(
      `linear-gradient(rgba(0, 0, 0, 0) ${cut}px, rgb(0, 0, 0) ${cut + 16}px)`,
    );
    // The sheet's cut is the only edge: no frost band fogs the title bar.
    await expect(page.locator(".titlebar-veil")).toBeHidden();
    // The fade is the sheet's: under the frame's other two options nothing
    // masks the prose.
    for (const option of ["cut", "slide"]) {
      await page.evaluate(
        (o) => document.documentElement.setAttribute("data-under-bar", o),
        option,
      );
      expect(
        await surface.evaluate((el) => getComputedStyle(el).maskImage),
        option,
      ).toBe("none");
    }
  });

  // In Henosis the chrome leaves and nothing frames the page: the sheet
  // has no head, edge or corners, and its paper fills the gap to every
  // window edge, the top included.
  test(`in Henosis the page meets every edge of the window (${variant})`, async ({
    page,
  }) => {
    await open(page, variant);
    const gap = await px(page, "--sheet-gap");
    await page
      .locator(".editor-shell")
      .evaluate((el) => el.setAttribute("data-henosis", "full"));
    // The frame slides the sheet out to its Henosis place.
    await expect
      .poll(() =>
        page
          .locator(".editor-shell")
          .evaluate((el) => parseFloat(getComputedStyle(el, "::before").left)),
      )
      .toBe(gap);
    const sheet = await page.locator(".editor-shell").evaluate((el) => {
      const cs = getComputedStyle(el, "::before");
      return {
        top: parseFloat(cs.top),
        right: parseFloat(cs.right),
        bottom: parseFloat(cs.bottom),
        head: cs.borderTopLeftRadius,
        headRight: cs.borderTopRightRadius,
        shadow: cs.boxShadow,
      };
    });
    expect(sheet).toMatchObject({
      top: gap,
      right: gap,
      bottom: gap,
      head: "0px",
      headRight: "0px",
    });
    // One ring of the paper, not dropped, as wide as the gap.
    expect(sheet.shadow).toBe(
      `${await token(page, "--sheet")} 0px 0px 0px ${gap}px`,
    );
  });

  test(`a pressed tool stands on the raised chip (${variant})`, async ({
    page,
  }) => {
    await open(page, variant);
    const pressed = page
      .locator('.bar-stack .ui-bar-act[aria-pressed="true"]')
      .first();
    await expect(pressed).toBeVisible();
    const s = await pressed.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        background: cs.backgroundColor,
        color: cs.color,
        lift: cs.boxShadow,
      };
    });
    expect(s.background).toBe(
      await token(page, "--radiant-chip", "background-color"),
    );
    expect(s.color).toBe(await token(page, "--ink"));
    expect(s.lift).not.toBe("none");
  });

  test(`the prose is set as a book (${variant})`, async ({ page }) => {
    await open(page, variant);
    const set = await page.evaluate(() => {
      const look = (sel: string) => {
        const cs = getComputedStyle(document.querySelector(sel)!);
        return {
          color: cs.color,
          indent: parseFloat(cs.textIndent),
          size: parseFloat(cs.fontSize),
          margin: cs.marginTop,
        };
      };
      return {
        first: look(".editor > p:nth-of-type(1)"),
        second: look(".editor > p:nth-of-type(2)"),
        title: getComputedStyle(document.querySelector(".editor > h1")!)
          .textAlign,
      };
    });
    expect(set.first.color).toBe(await token(page, "--prose-ink"));
    // The first paragraph flush, the next indented 1.4em, with no gap.
    expect(set.first.indent).toBe(0);
    expect(set.second.indent).toBeCloseTo(set.second.size * 1.4, 1);
    expect(set.second.margin).toBe("0px");
    expect(set.title).toBe("center");

    // A paragraph that opens the text, or follows a title of either level,
    // is flush, as a book sets it. The chapter has no such shapes, so a
    // sibling of the editor, wearing its class, holds them under the same
    // sheet without touching the writer's text.
    const indents = await page.locator(".editor").evaluate((editor) => {
      const twin = document.createElement(editor.tagName);
      twin.className = editor.className;
      twin.append(
        ...["p", "p", "h2", "p", "p", "h1", "p"].map((tag) => {
          const block = document.createElement(tag);
          block.textContent = "Words.";
          return block;
        }),
      );
      editor.after(twin);
      const read = [...twin.querySelectorAll("p")].map((p) =>
        parseFloat(getComputedStyle(p).textIndent),
      );
      twin.remove();
      return read;
    });
    const indent = set.second.indent;
    expect(indents).toEqual([0, indent, 0, indent, 0]);
  });

  test(`the spine draws the open Part apart (${variant})`, async ({ page }) => {
    await open(page, variant);
    const fill = (current: boolean) =>
      page
        .locator(
          `.dt-spine .spine-bars > g${current ? '[data-current="1"]' : ":not([data-current])"} > g > rect`,
        )
        .first()
        .evaluate((el) => getComputedStyle(el).fill);
    expect(await fill(true)).toBe(
      await token(page, "--spine-current-odd", "fill"),
    );
    expect(await fill(false)).toBe(await token(page, "--spine-b", "fill"));
  });

  test(`the focus ring is the spark, 2px (${variant})`, async ({ page }) => {
    await open(page, variant);
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement as Element);
      return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
    });
    expect(ring).toBe(`solid 2px ${await token(page, "--spark")}`);
  });
}

test("a row keeps every mark the frame draws", async ({ page }) => {
  // A theme restyles a row's marks but hides none of them: the open row's
  // count, comments and ⋮, and a Section's page glyph.
  await open(page, "light");
  const open_ = page.locator(".dt-row.active").first();
  await expect(open_.locator(".dt-more")).toBeVisible();
  await expect(open_.locator(".dt-words")).toBeVisible();
  await expect(open_.locator(".cm-bubbles")).toBeVisible();
  await expect(
    page.locator(".dt-row.dt-section .dt-file-icon").first(),
  ).toBeVisible();
  await expect(page.locator(".titlebar-file .dt-file-icon")).toBeVisible();
});

test("a comment is a note in the margin, its name in the spark when open", async ({
  page,
}) => {
  await open(page, "light");
  const words = await page
    .locator(".editor > p")
    .nth(1)
    .evaluate((p) => (p.textContent ?? "").split(" ").slice(0, 3).join(" "));
  await commentOn(page, words, "Tighten this.");
  const card = page.locator(".cm-card").first();
  await expect(card).toBeVisible();
  const spark = await token(page, "--spark");
  await expect(async () => {
    const look = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      const name = el.querySelector(".cm-entry:first-child .cm-name");
      return {
        ground: cs.backgroundColor,
        image: cs.backgroundImage,
        shadow: cs.boxShadow,
        padding: cs.padding,
        border: cs.borderWidth,
        active: el.getAttribute("data-active"),
        name: name ? getComputedStyle(name).color : "",
      };
    });
    expect(look).toMatchObject({
      ground: "rgba(0, 0, 0, 0)",
      image: "none",
      shadow: "none",
      // No inset and no edge: the note's words stand on the margin's line.
      padding: "0px",
      border: "0px",
    });
    if (look.active === "1") expect(look.name).toBe(spark);
  }).toPass({ timeout: 5_000 });
});

// At rest a note's passage is untinted; the ‸ that ends it takes the hand, so
// hovering the mark tints the words the note is about.
test("a note's ‸ finds its passage under the hand", async ({ page }) => {
  await open(page, "light");
  const mark = page.locator(".cm-pmark").first();
  await expect(mark).toBeVisible();
  const hovered = () =>
    page.evaluate(() => CSS.highlights.get("comment-hover")?.size ?? 0);
  expect(await hovered()).toBe(0);
  // The pointer, not `hover()`, so a mark that lets the pointer through
  // fails on the tint rather than on Playwright's own hit test.
  const at = await stableBox(page, ".cm-pmark");
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await expect.poll(hovered).toBe(1);
  await page.mouse.move(600, 715);
  await expect.poll(hovered).toBe(0);
});
