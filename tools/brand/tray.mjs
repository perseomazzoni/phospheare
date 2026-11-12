// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Renders the desktop tray's icon sources from the traced mark: the whole
// figure on a transparent square, in the night pair for a dark taskbar and
// the day pair for a light one. `desktop/tools/winres` turns them into the
// tray's icons. Run from the repo root:
//   node tools/brand/tray.mjs
// Needs Playwright's Chromium (`npx playwright install chromium`, once).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mark = fs.readFileSync(path.join(here, "..", "..", "docs", "brand", "mark.svg"), "utf8");
const size = 512;

// The figure is taller than wide, so its height fills the square.
const figure = (ink, light) =>
  mark
    .replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')
    .replace('fill="currentColor"', `fill="${ink}"`)
    .replace("var(--spark, currentColor)", light);

const page = (ink, light) =>
  `<!doctype html><html><body style="margin:0;background:transparent;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">` +
  `<div style="width:${size}px;height:${size}px">${figure(ink, light)}</div></body></html>`;

const browser = await chromium.launch();
for (const [file, ink, light] of [
  ["tray-night.png", "#F2F4F7", "#3BE8E5"],
  ["tray-day.png", "#1D2126", "#0E6E73"],
]) {
  const p = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await p.setContent(page(ink, light));
  const to = path.join(here, "..", "..", "docs", "brand", file);
  await p.screenshot({ path: to, omitBackground: true });
  await p.close();
  console.log(file, fs.statSync(to).size);
}
await browser.close();
