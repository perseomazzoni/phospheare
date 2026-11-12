// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "@playwright/test";
import { DPR, SURFACES, areaOf, type Variant } from "./surfaces";
import { toWebp } from "./webp";

// ── The landing page's screenshots ───────────────────────────────────────────
//
// One picture per surface, theme family and variant, written as WebP to
// `public/landing/<family>-<variant>-<surface>.webp`, where the landing page
// reads the one the visitor is wearing. The families are the registered ones,
// in the order `theme/index.ts` registers them, so a new theme or a new
// default is pictured without editing this file.
//
// SHOTS_FAMILIES and SHOTS_SURFACES (comma-separated) narrow a run.

const OUT = fileURLToPath(new URL("../../public/landing/", import.meta.url));
const REGISTRY = fileURLToPath(
  new URL("../../src/theme/index.ts", import.meta.url),
);

function registeredFamilies(): string[] {
  const source = readFileSync(REGISTRY, "utf8");
  return [...source.matchAll(/^registerFamily\((\w+)\);/gm)].map((m) => m[1]);
}

const FAMILIES = process.env.SHOTS_FAMILIES?.split(",") ?? registeredFamilies();
const ONLY = process.env.SHOTS_SURFACES?.split(",");

mkdirSync(OUT, { recursive: true });

for (const family of FAMILIES)
  for (const variant of ["dark", "light"] as Variant[])
    for (const surface of SURFACES) {
      if (ONLY && !ONLY.includes(surface.id)) continue;
      test(`${family} ${variant} ${surface.id}`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport: surface.viewport,
          deviceScaleFactor: DPR,
          timezoneId: "UTC",
          locale: "en-US",
          reducedMotion: "reduce",
          ...(surface.phone ? { isMobile: true, hasTouch: true } : {}),
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
        await surface.go(page, family, variant);
        // The hand off every control, and no tip left open by a click. A
        // step of a sequence keeps its hand where `go` drew it.
        if (!surface.phone && !surface.pointing)
          await page.mouse.move(
            surface.viewport.width / 2,
            surface.viewport.height - 2,
          );
        await page.addStyleTag({
          content: ".ui-tip-portal { display: none !important; }",
        });
        // A blur would hand a hovered row back too (the persona list).
        if (!surface.pointing)
          await page.evaluate(() => {
            const a = document.activeElement;
            if (a instanceof HTMLButtonElement) a.blur();
          });
        await page.evaluate(() => document.fonts.ready);
        // Timed flourishes (the save's tick, the gutter) to their end.
        await page.waitForTimeout(1500);
        await page.clock.runFor(10_000);
        await page.waitForTimeout(1000);

        const png = await page.screenshot({
          caret: "hide",
          ...(surface.crop && { clip: areaOf(surface) }),
        });
        const webp = await toWebp(page, png);
        writeFileSync(`${OUT}${family}-${variant}-${surface.id}.webp`, webp);
        await ctx.close();
      });
    }
