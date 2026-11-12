// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The caret bar and the type guide's chevrons are painted from rects read on
// caret moves and scrolls. A window resize or a panel toggle moves the
// surface, the station and the editor column without firing either, so a
// ResizeObserver on the surface and a MutationObserver on the shell's layout
// attributes drive a re-measure. jsdom has neither, so these rows read the
// `?debug=station` probe in a real browser.

import { expect, test } from "@playwright/test";
import { DOCK_BOUND, readoutEventually } from "./probe";
import { START_MS } from "./start";

test.beforeEach(async ({ page }) => {
  await page.goto("/app/editor/demo?debug=station");
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "scroll",
    { timeout: START_MS },
  );
  // The demo opens on the Desk, a resume prompt standing in for the prose, so
  // a section must be open before there is a caret to measure.
  await page.getByRole("button", { name: "Continue writing" }).click();
  await expect(page.locator(".editor p").first()).toBeVisible();
  await page.getByRole("button", { name: "Writing preferences" }).click();
  await page.getByRole("checkbox", { name: "Typewriter Mode" }).click();
  await expect(page.locator(".editor-surface")).toHaveAttribute(
    "data-view",
    "typewriter",
  );
});

test("a window resize re-docks the writing line to the moved station", async ({
  page,
}) => {
  await page.locator(".editor p").first().click();
  await page.keyboard.type("The storm came without warning. ");
  const r0 = await readoutEventually(
    page,
    (r) => Math.abs(r.delta) <= DOCK_BOUND,
  );
  expect(r0.clamp).toBe("free");

  // The station is the surface's centre, so it travels with the resize, and
  // the writing line must come home to it.
  await page.setViewportSize({ width: 1280, height: 560 });

  // The probe's readout updates only on caret moves, scrolls and the
  // re-measure, so the poll keys on the station moving: a stale pre-resize
  // readout also satisfies "delta within bound".
  const r = await readoutEventually(
    page,
    (c) =>
      Math.abs(c.station - r0.station) > 40 && Math.abs(c.delta) <= DOCK_BOUND,
  );
  expect(r.clamp).toBe("free");
  // The station moved, so the pass is not a no-op.
  expect(Math.abs(r.station - r0.station)).toBeGreaterThan(40);
});

test("the chevrons track the measure when the window runs short", async ({
  page,
}) => {
  await page.locator(".editor p").first().click();
  await page.keyboard.type("The storm came. ");
  await readoutEventually(page, (r) => Math.abs(r.delta) <= DOCK_BOUND);

  // The right chevron sits 41px outboard of the measure's right edge
  // (`updateGuide` in `EditorCore`). Both edges are compared as viewport
  // coordinates.
  const fingerX = () =>
    page
      .locator(".type-guide-finger-right")
      .boundingBox()
      .then((b) => b?.x ?? Number.NaN);
  const editorRight = () =>
    page
      .locator(".editor")
      .boundingBox()
      .then((b) => (b ? b.x + b.width : Number.NaN));
  const offset = async () =>
    Math.abs((await fingerX()) - ((await editorRight()) + 41));

  // Wide: the chevron already sits where the rule puts it.
  await expect.poll(offset, { timeout: 15_000 }).toBeLessThanOrEqual(3);

  // Below the plane's width (1008, derived) the column narrows, so the
  // editor's right edge moves and the chevron must travel with it. Without
  // the MutationObserver the finger keeps a stale x.
  await page.setViewportSize({ width: 900, height: 720 });
  await expect.poll(offset, { timeout: 15_000 }).toBeLessThanOrEqual(3);
});
