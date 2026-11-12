// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";
import {
  DPR,
  MARGIN,
  WIDE,
  areaOf,
  section,
  type Crop,
  type Variant,
} from "./surfaces";
import { encode } from "./webp";

// ── The README's screenshots ─────────────────────────────────────────────────
//
// The one picture the README shows, reached by real clicks and written as
// WebP to `docs/images/readme-<id>.webp`. A shot keeps only the part of the
// window it is about, so the README can show it small and still be read.
// Run from `web/`:
//
//   npm run shots:readme
//
// SHOTS_PNG_DIR, when set, also receives a PNG of each, for review.

const OUT = fileURLToPath(new URL("../../../docs/images/", import.meta.url));
const PNG_DIR = process.env.SHOTS_PNG_DIR;

interface Shot {
  id: string;
  family: string;
  variant: Variant;
  crop: Crop;
  go: (page: Page, family: string, variant: Variant) => Promise<unknown>;
}

/** The editor's own caret, which a still picture would freeze mid-word. */
const NO_CARET = ".fake-cursor { visibility: hidden !important; }";

const SHOTS: Shot[] = [
  // The book's structure beside a chapter of real prose.
  {
    id: "workspace",
    family: "matte",
    variant: "dark",
    crop: [0, 0, 1, 1],
    go: (page, f, v) => section(page, f, v, MARGIN),
  },
];

mkdirSync(OUT, { recursive: true });
if (PNG_DIR) mkdirSync(PNG_DIR, { recursive: true });

for (const shot of SHOTS)
  test(`readme ${shot.id}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: WIDE,
      deviceScaleFactor: DPR,
      timezoneId: "UTC",
      locale: "en-US",
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    // The same "random" picks on every run: the greeting, the spark.
    await page.addInitScript(() => {
      let seed = 0x9e3779b9;
      Math.random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    await shot.go(page, shot.family, shot.variant);
    // The hand off every control, and no tip left open by a click.
    await page.mouse.move(WIDE.width / 2, WIDE.height - 2);
    await page.addStyleTag({
      content: `.ui-tip-portal { display: none !important; } ${NO_CARET}`,
    });
    await page.evaluate(() => {
      const a = document.activeElement;
      if (a instanceof HTMLButtonElement) a.blur();
    });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    await page.clock.runFor(10_000);
    await page.waitForTimeout(1000);

    // The whole window, cut afterwards, so the frosted Dock is blurred to
    // the crop's edge (`encode`).
    const png = await page.screenshot({ caret: "hide" });
    const css = areaOf({
      id: shot.id,
      viewport: WIDE,
      crop: shot.crop,
      go: shot.go,
    });
    const area = {
      x: css.x * DPR,
      y: css.y * DPR,
      width: css.width * DPR,
      height: css.height * DPR,
    };
    if (PNG_DIR)
      writeFileSync(
        `${PNG_DIR}/readme-${shot.id}.png`,
        await encode(page, png, { type: "image/png", area }),
      );
    writeFileSync(
      `${OUT}readme-${shot.id}.webp`,
      await encode(page, png, { area }),
    );
    await ctx.close();
  });
