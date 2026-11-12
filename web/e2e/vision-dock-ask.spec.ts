// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import {
  askForSearch,
  openDockFace,
  openFirstLight,
  openVisionProject,
} from "./visionProject";

// Vision's Assistant: Matte's layout, set in the book's type. The transcript
// runs to its end, where a proposed search waits 14 in from an ember rule,
// its answers words: the yes underlined in ink, the no in the second ink,
// with no frame or ground. The composer is an italic line over an ink rule.
// Matte keeps its Assistant, and the revision plan sets its groups as a
// column in every theme.

test.use({ timezoneId: "UTC", locale: "en-GB" });

async function open(page: Page, family?: "matte", variant = "light") {
  await page.setViewportSize({ width: 1198, height: 723 });
  await openVisionProject(page, {
    variant: variant as "light" | "dark",
    text: "section",
    family,
  });
  await openFirstLight(page);
  await openDockFace(page, "ask");
  await askForSearch(page);
  await expect(page.locator(".ai-ask")).toBeVisible({ timeout: 15_000 });
}

async function box(page: Page, selector: string, nth = 0) {
  const b = await page.locator(selector).nth(nth).boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  const r = (n: number) => Math.round(n * 100) / 100;
  return { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height) };
}

/** A token as the page computes it for one CSS property. */
function token(
  page: Page,
  property: "color" | "fontFamily",
  name: string,
): Promise<string> {
  return page.evaluate(
    ([p, t]) => {
      const probe = document.createElement("i");
      probe.style.position = "absolute";
      probe.style[p as "color"] = `var(${t})`;
      document.querySelector(".editor-shell")!.append(probe);
      const value = getComputedStyle(probe)[p as "color"];
      probe.remove();
      return value;
    },
    [property, name],
  );
}

const style = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontFamily: s.fontFamily,
      fontStyle: s.fontStyle,
      color: s.color,
      background: s.backgroundColor,
      shadow: s.boxShadow,
      outline: s.outlineWidth,
      borderLeft: s.borderLeft,
      paddingLeft: s.paddingLeft,
    };
  });

for (const variant of ["light", "dark"] as const) {
  test(`the chat is set in the book's type, its ask on an ember rule (${variant})`, async ({
    page,
  }) => {
    await open(page, undefined, variant);
    const prose = await token(page, "fontFamily", "--f-prose");
    const ink = await token(page, "color", "--ink");
    const ink2 = await token(page, "color", "--ink-2");
    const ember = await token(page, "color", "--attention");

    for (const selector of [
      ".ai-chathead",
      ".ai-messages",
      ".composer textarea",
      ".ai-chatbar",
    ])
      expect((await style(page, selector)).fontFamily).toBe(prose);
    await expect(page.locator(".ai-new-chat")).toHaveText("new chat");

    // The transcript runs to its end: the search is in full view.
    const scroll = await page
      .locator(".ai-messages")
      .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    expect(scroll).toBeLessThan(1);

    const ask = await style(page, ".ai-ask");
    expect(ask.borderLeft).toBe(`1px solid ${ember}`);
    expect(ask.paddingLeft).toBe("14px");

    // Its answers stay words: the yes underlined in ink, the no in the
    // second ink, neither drawn as a button.
    const yes = await style(page, ".ai-ask .ai-finding-actions .ui-btn-soft");
    expect(yes).toMatchObject({
      color: ink,
      background: "rgba(0, 0, 0, 0)",
      outline: "0px",
      shadow: `${ink} 0px -1px 0px 0px inset`,
    });
    const no = await style(page, ".ai-ask .ai-finding-actions .ui-btn-link");
    expect(no).toMatchObject({
      color: ink2,
      background: "rgba(0, 0, 0, 0)",
      shadow: "none",
    });

    // The composer: an italic line over an ink rule.
    const line = await style(page, ".composer textarea");
    expect(line.fontStyle).toBe("italic");
    expect(line.shadow).toBe(`${ink} 0px -1px 0px 0px inset`);
  });
}

test("the voice's face is a way to the voices", async ({ page }) => {
  await open(page);
  await page.locator(".ai-chathead .ai-face").click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the voices' card keeps a gutter beside the face, under a description as wide as the card", async ({
  page,
}) => {
  // The rows carry 8px of their own padding, so 14 off the face puts the
  // names 22 off it, the body's side padding. The description runs under
  // both columns, which gives the face a bottom edge and the hairline the
  // card's width.
  await open(page);
  await page.locator(".ai-chathead .ai-face").click();
  const card = page.locator(".ai-persona-card");
  await expect(card.locator(".ai-persona-portrait")).toBeVisible();
  // The dialog has an entrance, and a box read mid-entrance is scaled.
  await page
    .getByRole("dialog")
    .evaluate((el) =>
      Promise.all(
        el.getAnimations({ subtree: true }).map((a) => a.finished),
      ).then(() => undefined),
    );
  const read = await card.evaluate((el) => {
    const style = getComputedStyle(el);
    const box = (selector: string) =>
      el.querySelector(selector)!.getBoundingClientRect();
    return {
      room:
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
      face: box(".ai-persona-portrait"),
      list: box(".ai-persona-list"),
      description: box(".ai-persona-description"),
    };
  });
  expect(read.list.left - read.face.right).toBeCloseTo(14, 0);
  expect(read.description.width).toBeCloseTo(read.room, 0);
  expect(read.description.top).toBeGreaterThanOrEqual(read.face.bottom);

  // Each list of choices is a column: its names start at one x, whatever
  // else a row carries, and the tick marking one stands after its name, at
  // the row's far edge.
  const lists = await page.getByRole("dialog").evaluate((dialog) =>
    [...dialog.querySelectorAll(".ai-persona-list")].map((list) =>
      [...list.querySelectorAll(".ai-persona-option")].map((row) => {
        const name = row.querySelector(".ai-persona-name")!;
        const tick = row.querySelector(".ai-persona-mark")!;
        return {
          name: name.getBoundingClientRect().toJSON() as DOMRect,
          tick: tick.getBoundingClientRect().toJSON() as DOMRect,
        };
      }),
    ),
  );
  expect(lists.length).toBeGreaterThan(0);
  for (const rows of lists) {
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(row.name.left).toBeCloseTo(rows[0].name.left, 1);
      expect(row.tick.left).toBeGreaterThanOrEqual(row.name.right);
      expect(row.tick.left).toBeCloseTo(rows[0].tick.left, 1);
    }
  }
});

test("Matte keeps its Assistant, and its plan's groups", async ({ page }) => {
  await open(page, "matte");
  await expect(page.locator(".msg-who")).toHaveCount(0);
  expect((await box(page, ".ai-chathead")).height).toBeLessThan(50);

  // The chat's head is one line with no rule of its own: the tab strip's
  // hairline is just above it. The persona's pill stands under the tabs'
  // pills, its left edge the first tab's, and the new-chat pill ends where
  // the composer below it does. The persona and the chat's title are one
  // height, so neither reads as less of a control.
  const head = await page.locator(".ai-chathead").evaluate((el) => {
    const css = getComputedStyle(el);
    return `${css.borderTopWidth} ${css.borderBottomWidth}`;
  });
  expect(head).toBe("0px 0px");
  const tab = await box(page, ".dock-head .ui-bar-track button");
  const persona = await box(page, ".ai-chathead .ai-persona");
  const title = await box(page, ".ai-chathead .ai-chat-title");
  const add = await box(page, ".ai-new-chat");
  const composer = await box(page, ".composer");
  expect(persona.x).toBeCloseTo(tab.x, 0);
  expect(add.x + add.width).toBeCloseTo(composer.x + composer.width, 0);
  expect(title.height).toBe(persona.height);
  expect(title.y).toBe(persona.y);
  // Every part of the head stands on one centre line, the small label too.
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  const label = await box(page, ".ai-chathead-label");
  for (const part of [label, title, add])
    expect(centre(part)).toBeCloseTo(centre(persona), 0);
  // The head splits in two: the voice at the left, and from the label on,
  // which chat and the button for a new one at the right. At the dock's floor
  // the head has no room to spare, so the split shows on a wider dock.
  const grip = await box(page, ".dock-resize");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(1198 - 600, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await box(page, ".ed-dock")).width)
    .toBeGreaterThan(560);
  await expect
    .poll(async () => {
      const [p, l, t, a, c] = await Promise.all(
        [
          ".ai-chathead .ai-persona",
          ".ai-chathead-label",
          ".ai-chathead .ai-chat-title",
          ".ai-new-chat",
          ".composer",
        ].map((s) => box(page, s)),
      );
      return [
        l.x - (p.x + p.width) > 40,
        Math.round(t.x - (l.x + l.width)),
        Math.round(a.x + a.width - (c.x + c.width)),
      ];
    })
    .toEqual([true, 8, 0]);
  await page.locator(".ai-messages").evaluate((el) => (el.scrollTop = 0));
  await page.locator(".ai-plan > summary").click();
  const group = await box(page, ".ai-plan-group");
  expect(group.width).toBeGreaterThan(200);
});
