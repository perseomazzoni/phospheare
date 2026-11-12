// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The kit's buttons as the whole cascade draws them: the frame, the shared
// paint and the theme the page wears, in their order, with every later rule
// that could override an earlier one. Each row writes the markup `Banner`
// and `Button` render onto a signed-in page and reads computed styles, so it
// holds however the stylesheets are written. A change to that markup is not
// followed here.

import { expect, test, type Page } from "@playwright/test";
import { settleTransitions } from "./probe";
import { signIn } from "./session";

async function openPage(page: Page) {
  await signIn(page);
  await page.goto("/app");
  await page.locator("#root > *").first().waitFor();
}

test("a cleared banner keeps its button's size as the button turns soft", async ({
  page,
}) => {
  // A failed answer whose key is ready again flips in place: the strip turns
  // quiet and its small ember button turns soft (`AiTurn.tsx`). `soft` has a
  // smaller box of its own, and a button that shrank as it changed colour
  // would move under the writer's pointer.
  await openPage(page);
  // Built node by node: the page enforces Trusted Types, so no innerHTML.
  await page.evaluate(() => {
    const element = (tag: string, className: string, text = "") => {
      const node = document.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };
    const strip = element("div", "ui-banner ui-banner-attention");
    strip.id = "e2e-strip";
    const failed = element("span", "ai-turn-failed");
    const button = element(
      "button",
      "ui-btn ui-btn-attention ui-btn-sm",
      "Try again",
    );
    button.setAttribute("type", "button");
    failed.append(button);
    strip.append(element("span", "ui-banner-text", "The key ran out."), failed);
    document.body.append(strip);
  });
  const read = () =>
    page.evaluate(() => {
      const strip = document.getElementById("e2e-strip")!;
      const button = strip.querySelector("button")!;
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { strip: box(strip), button: box(button) };
    });

  await settleTransitions(page);
  const before = await read();
  await page.evaluate(() => {
    const strip = document.getElementById("e2e-strip")!;
    strip.className = "ui-banner ui-banner-quiet";
    strip.querySelector("button")!.className = "ui-btn ui-btn-soft ui-btn-sm";
  });
  await settleTransitions(page);
  const after = await read();

  // The small size is the ember button's, the one the strip starts with.
  expect(after.button.height, "the soft button left the small size").toBe(
    before.button.height,
  );
  // Its width follows its label's face, which the variants paint differently,
  // so only the row it sits on is held.
  expect(after.button.y, "the button moved as it turned soft").toBe(
    before.button.y,
  );
  expect(after.strip, "the strip moved as it turned quiet").toEqual(
    before.strip,
  );
});

// One computed example of the guard `styles/kitStates.test.ts` holds over
// every sheet: a disabled or locked button does not answer the pointer. The
// enabled button is the control, so the hover is known to land.
test("a disabled or locked button does not answer the pointer", async ({
  page,
}) => {
  await openPage(page);
  await page.evaluate(() => {
    const row = document.createElement("div");
    row.id = "e2e-buttons";
    // Over everything, so the pointer reaches each button and nothing else.
    row.style.cssText =
      "position: fixed; inset: 40px auto auto 40px; z-index: 2147483647; display: flex; gap: 24px";
    for (const which of ["enabled", "disabled", "locked"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-btn ui-btn-soft";
      button.dataset.e2e = which;
      button.textContent = "Search";
      if (which === "disabled") button.disabled = true;
      if (which === "locked") button.setAttribute("aria-disabled", "true");
      row.append(button);
    }
    document.body.append(row);
  });
  const look = (which: string) =>
    page.locator(`[data-e2e="${which}"]`).evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        background: style.backgroundColor,
        color: style.color,
        shadow: style.boxShadow,
        transform: style.transform,
      };
    });

  const seen: Record<string, { rest: unknown; hover: unknown }> = {};
  for (const which of ["enabled", "disabled", "locked"]) {
    await page.mouse.move(0, 0);
    await settleTransitions(page);
    const rest = await look(which);
    const box = (await page.locator(`[data-e2e="${which}"]`).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await settleTransitions(page);
    seen[which] = { rest, hover: await look(which) };
  }

  expect(seen.enabled.hover, "the enabled button answers").not.toEqual(
    seen.enabled.rest,
  );
  expect(seen.disabled.hover, "the disabled button answers").toEqual(
    seen.disabled.rest,
  );
  expect(seen.locked.hover, "the locked button answers").toEqual(
    seen.locked.rest,
  );
});
