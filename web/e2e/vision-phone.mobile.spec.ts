// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { expect, test, type Page } from "@playwright/test";
import { openVisionProject } from "./visionProject";

// Vision on a touch screen. The text keeps the screen's width with the folio
// under it; off the phone the running head stands over the same measure, and
// the phone, with no band above the text, draws none. The phone's bar floats
// over the prose on the page's plaster paper under a firm hairline; the Desk
// and its head keep to the screen; and a thread opened from its mark is set
// as a note on a slip of the page, with no box and no shadow.

// The book is seeded through OPFS, which Playwright's WebKit does not offer,
// so every project runs this on Chromium at its own size and touch.
test.use({ timezoneId: "UTC", locale: "en-GB", browserName: "chromium" });

const PASSAGE = "Some called it softness.";

async function resume(page: Page) {
  await openVisionProject(page, { variant: "light", text: "section" });
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(
    page.locator(".editor").getByText(PASSAGE, { exact: false }),
  ).toBeVisible({ timeout: 15_000 });
}

const onPhone = (page: Page) =>
  page
    .locator('.editor-shell[data-phone="1"]')
    .count()
    .then((n) => n > 0);

/** A colour token as the shell resolves it. */
const color = (page: Page, name: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    document.querySelector(".editor-shell")!.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

const within = (width: number, r: { x: number; width: number }) => {
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.x + r.width).toBeLessThanOrEqual(width + 0.5);
};

test("the text keeps the screen's width, the folio under it and the head over it off the phone", async ({
  page,
}) => {
  await resume(page);
  const width = page.viewportSize()!.width;
  const text = (await page.locator(".editor").boundingBox())!;
  expect(text.width).toBeGreaterThan(Math.min(width - 48, 500));
  within(width, text);
  const folio = (await page.locator(".ed-folio").boundingBox())!;
  within(width, folio);
  expect(folio.y).toBeGreaterThan(text.y);

  const head = page.locator(".ed-runhead");
  if (await onPhone(page)) {
    await expect(head).toBeHidden();
    return;
  }
  const over = (await head.boundingBox())!;
  expect(over.y).toBeLessThan(text.y);
  expect(over.x).toBe(text.x);
  expect(over.width).toBe(text.width);
});

test("the phone's bar stands on the plaster paper under a hairline", async ({
  page,
}) => {
  await resume(page);
  test.skip(!(await onPhone(page)), "the bar floats only on the phone");
  const bar = await page.locator('.ui-bar[data-phone="1"]').evaluate((el) => {
    const c = getComputedStyle(el);
    return { ground: c.backgroundColor, edge: c.boxShadow };
  });
  expect(bar.ground).toBe(await color(page, "--paper"));
  expect(bar.edge).toBe(`${await color(page, "--hair-firm")} 0px 0px 0px 1px`);
});

test("the Desk and its head keep to the screen", async ({ page }) => {
  await openVisionProject(page, { variant: "light", text: "section" });
  await expect(page.locator(".desk")).toBeVisible();
  const width = page.viewportSize()!.width;
  // The Desk's own head, where the writer left off, and every piece under it.
  await expect(page.locator(".desk-eyebrow").first()).toContainText(
    "Where you left off",
  );
  const boxes = await page
    .locator(".desk, .desk > section > *, .desk > p")
    .evaluateAll((all) =>
      all.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, width: r.width };
      }),
    );
  expect(boxes.length).toBeGreaterThan(4);
  for (const r of boxes) within(width, r);
  // Off the phone the running head stands over the Desk's measure.
  if (!(await onPhone(page))) {
    const desk = (await page.locator(".desk").boundingBox())!;
    const head = (await page.locator(".ed-runhead").boundingBox())!;
    expect(head.x).toBe(desk.x);
    expect(head.width).toBe(desk.width);
  }
});

test("a thread opened from its mark is a note on a slip", async ({ page }) => {
  await resume(page);
  test.skip(
    !(await onPhone(page)),
    "the margin stands beside the text off the phone",
  );
  await page.locator(".cm-marker:not(.cm-marker-chapter)").last().click();
  const card = page.locator(".cm-float .cm-card");
  await expect(card).toBeVisible();
  const look = await card.evaluate((el) => {
    const slip = getComputedStyle(el.closest(".cm-float")!);
    return {
      edge: getComputedStyle(el).borderTopWidth,
      body: getComputedStyle(el.querySelector(".cm-body")!).fontStyle,
      face: getComputedStyle(el.querySelector(".app-avatar")!).display,
      ground: slip.backgroundColor,
      rule: slip.borderTop,
      shadow: slip.boxShadow,
    };
  });
  expect(look).toMatchObject({
    edge: "0px",
    body: "italic",
    face: "none",
    ground: await color(page, "--paper"),
    rule: `1px solid ${await color(page, "--hair-firm")}`,
  });
  // No shadow: none at all, or a clear one of no extent.
  expect(look.shadow).toMatch(/^(none|rgba\(0, 0, 0, 0\) 0px 0px 0px 0px)$/);
});
