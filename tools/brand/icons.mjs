// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Renders the app icons from the traced mark: the whole figure with its chest
// spark, never cropped, on the night ground. Run from the repo root:
//   node tools/brand/icons.mjs
// Needs Playwright's Chromium (`npx playwright install chromium`, once).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mark = fs.readFileSync(path.join(here, "..", "..", "docs", "brand", "mark.svg"), "utf8");
const out = path.join(here, "..", "..", "web", "public");

const figure = (ink, light) =>
  mark
    .replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')
    .replace('fill="currentColor"', `fill="${ink}"`)
    .replace("var(--spark, currentColor)", light);

const page = (size, inset) =>
  `<!doctype html><html><body style="margin:0;background:#07090D;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">` +
  `<div style="width:${Math.round(size * inset)}px;height:${Math.round(size * inset)}px">${figure("#F2F4F7", "#3BE8E5")}</div></body></html>`;

const browser = await chromium.launch();
// apple-touch-icon: iOS rounds it itself. icon-192/512 are maskable, so the
// figure sits inside the safe circle, 80% of the side across. The raised
// hand reaches the corner of the figure's box, so the box is at most 60% of
// the side: its corner is then 0.66 × 60% ≈ 40% from the centre.
for (const [file, size, inset] of [
  ["apple-touch-icon.png", 180, 0.78],
  ["icon-192.png", 192, 0.6],
  ["icon-512.png", 512, 0.6],
]) {
  const p = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await p.setContent(page(size, inset));
  await p.screenshot({ path: path.join(out, file) });
  await p.close();
  console.log(file, fs.statSync(path.join(out, file)).size);
}
await browser.close();
