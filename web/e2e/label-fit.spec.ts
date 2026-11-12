// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The settings sheet's nav column follows its labels and cannot be broken by
// one. A fixed column fits English and not Italian, where a
// button runs past the divider into the pane beside it. The text fits its
// button; the button escapes the column, so this measures each button against
// the column, which a label-against-its-own-box check cannot see.
//
// The column sizes to its content (`fit-content`), and two states are pinned:
//   1. ordinarily the track is the width the longest label needs, neither a
//      fixed number nor the cap;
//   2. a label longer than the cap is trimmed with an ellipsis inside its own
//      button rather than escaping: a truncated label is a bounded loss a
//      writer can see, and text across the divider is a broken interface.
// Neither assertion depends on a locale's words. Settings is behind a writer
// session, so each row signs in as a local writer first.

import { expect, test } from "@playwright/test";
import { signIn } from "./session";

/** Matches the `fit-content()` cap in `.sheet-cols` in `webapp.css`. */
const CAP = 240;

// No `locale` and no dependency on the writer's saved language:
// `detectLanguage` prefers the saved preference over `navigator.language`, so
// a declared locale is not guaranteed, and an assertion that fails only in one
// language depends on a translation staying long. The rows assert that the
// track follows the label, whatever the label says.

/** The nav's track, its labels, and any button escaping the column. */
async function readNav(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".sheet-nav")!;
    const box = nav.getBoundingClientRect();
    const style = getComputedStyle(nav);
    const inner =
      box.width -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    return {
      track: box.width,
      labels: [...nav.querySelectorAll<HTMLElement>(".sheet-nav-label")].map(
        (l) => ({
          text: l.textContent ?? "",
          ellipsised: l.scrollWidth > l.clientWidth,
        }),
      ),
      // Each button against the column, not against its own text.
      escaping: [...nav.querySelectorAll<HTMLElement>("button")]
        .map((b) => ({
          label: b.innerText.trim(),
          over: Math.round(b.getBoundingClientRect().width - inner),
        }))
        .filter((b) => b.over > 1),
    };
  });
}

test("the nav column follows its label rather than a constant", async ({
  page,
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/settings");
  await expect(page.locator(".sheet-nav")).toBeVisible();

  const start = await readNav(page);
  // A fixed width can happen to fit the current language, so the assertion
  // below is about movement, not fit.
  expect(start.escaping).toEqual([]);
  for (const label of start.labels) {
    expect(label.ellipsised, `"${label.text}" should not need trimming`).toBe(
      false,
    );
  }

  // The longest label gains a short word, which keeps it under the cap
  // whatever the platform's font metrics. A column sized by its content
  // grows; a fixed column does not move.
  await page.evaluate(() => {
    const labels = document.querySelectorAll<HTMLElement>(".sheet-nav-label");
    let widest = labels[0];
    labels.forEach((l) => {
      if (
        l.getBoundingClientRect().width > widest.getBoundingClientRect().width
      )
        widest = l;
    });
    widest.textContent = `${widest.textContent} so`;
  });
  const grown = await readNav(page);

  expect(grown.track).toBeGreaterThan(start.track);
  expect(grown.escaping).toEqual([]);
  // Still under the cap, so the growth is the content's and not the clamp's.
  expect(grown.track).toBeLessThan(CAP);
});

test("and a label longer than the cap is trimmed, not let loose", async ({
  page,
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/app/settings");
  await expect(page.locator(".sheet-nav")).toBeVisible();

  // Stands in for a translation not yet written. Injected into the DOM rather
  // than a locale file: the guarantee is about the layout, and a real locale
  // ties the assertion to a string that can be shortened.
  await page.evaluate(() => {
    const label = document.querySelectorAll<HTMLElement>(".sheet-nav-label")[1];
    label.textContent =
      "Dove stanno le parole in una lingua molto piu lunga di questa";
  });

  const nav = await readNav(page);
  expect(nav.escaping).toEqual([]);
  expect(Math.round(nav.track)).toBe(CAP);
  expect(nav.labels[1].ellipsised).toBe(true);
  // The cap is a ceiling for the one long label, not a new width for all of
  // them: the others must still read in full.
  expect(nav.labels[0].ellipsised).toBe(false);
  expect(nav.labels[2].ellipsised).toBe(false);
});
