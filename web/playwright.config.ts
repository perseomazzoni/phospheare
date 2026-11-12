// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { defineConfig, devices } from "@playwright/test";

// The real-browser checks. jsdom measures every rect as zero, so anything that
// depends on layout, such as the docked-station invariant and every mobile
// measurement, is verified only where layout is real.
//
// ── Desktop and mobile projects ──────────────────────────────────────────────
//
// `desktop` runs one Chromium with no emulation. Its specs assume desktop
// geometry (the editor's three columns, a layout of 1040px and up, a mouse),
// and several would fail at phone sizes for reasons that are not defects.
//
// The mobile projects match only `*.mobile.spec.ts`, and `desktop` ignores
// that pattern. The split is by file name rather than directory, so a spec's
// project is visible in its own name.
//
// ── Device presets over viewport sizes ───────────────────────────────────────
//
// Half the mobile layout keys on `(pointer: coarse)` and `(hover: none)`, and
// a config that only sets `viewport` tests none of it: a narrow desktop window
// still has a mouse. The presets carry `hasTouch`, `isMobile`, the device
// scale factor and the real user agent together, so a hover-gated control is
// unreachable in the test as it is on the device.
//
// `iPhone SE` is Playwright's first-generation 320px device. The narrow-screen
// layout is measured at 375×667, so that size gets its own profile rather than
// a preset 55px narrower.
//
// ── The server under test ────────────────────────────────────────────────────
//
// By default the suites run against the Vite dev server. `E2E_BUILD=1` runs
// them against the E2E build (`npm run build:e2e`) served by `vite preview`:
// bundled, under the CSP that ships, and built in development mode, so the
// test hooks and the invariant checks `import.meta.env.DEV` gates are kept.
// A page then loads a few bundles instead of every module compiled on
// request, which is most of a CI runner's time. The dev server still starts
// beside it for `cache-store.spec.ts`, which imports modules as the dev
// server serves them. `PLAYWRIGHT_BASE_URL` points the run at a server
// already up, and starts none.
//
// `E2E_DEMO=1` serves the demo site's build (`npm run build:demo`) instead,
// for the `demo-site` project alone (`demo-only.spec.ts`): the program the
// public site serves, which has none of the hooks the other suites use. It is
// served as GitHub Pages serves it (`tools/serve-site.mjs`), files only, so a
// page the build did not write fails here. `E2E_DEMO_DIR` names another
// folder to serve: the release points it at the unpacked site archive.
const external = process.env.PLAYWRIGHT_BASE_URL;
const build = process.env.E2E_BUILD === "1";
const demo = process.env.E2E_DEMO === "1";
const devPort = 5173;
const previewPort = 4173;
const demoPort = 4174;
const demoDir = process.env.E2E_DEMO_DIR ?? "dist/demo";
const DEMO_ONLY = /demo-only\.spec\.ts$/;
const devServer = {
  command: `npm run dev -- --port ${devPort} --strictPort`,
  url: `http://localhost:${devPort}`,
  reuseExistingServer: true,
  timeout: 60_000,
};

export default defineConfig({
  testDir: "./e2e",
  // Each worker has its own browser: the probe overlay is a singleton per
  // page, and the dev server serves them all. Two, the cores of a GitHub
  // runner; `--workers` changes it for one run.
  workers: 2,
  fullyParallel: false,
  timeout: 60_000,
  // In CI the HTML report is what the failure artifact uploads.
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: external ?? `http://localhost:${build ? previewPort : devPort}`,
    trace: "retain-on-failure",
  },
  projects: demo
    ? [
        {
          name: "demo-site",
          use: {
            ...devices["Desktop Chrome"],
            baseURL: external ?? `http://127.0.0.1:${demoPort}`,
          },
          testMatch: DEMO_ONLY,
        },
      ]
    : [
        {
          name: "desktop",
          use: { ...devices["Desktop Chrome"] },
          testIgnore: [/\.mobile\.spec\.ts$/, DEMO_ONLY],
        },
        {
          // The 375×667 narrow-screen size, on the engine that ships to iOS.
          name: "iphone-se-375",
          use: {
            ...devices["iPhone 14 Pro"],
            viewport: { width: 375, height: 667 },
          },
          testMatch: /\.mobile\.spec\.ts$/,
        },
        {
          // Safe-area insets and the WebKit engine at its shipped size.
          name: "iphone-14-pro",
          use: { ...devices["iPhone 14 Pro"] },
          testMatch: /\.mobile\.spec\.ts$/,
        },
        {
          // Android Chrome, where the soft keyboard resizes the viewport, unlike
          // iOS; that difference is why both engines are in the matrix.
          name: "pixel-7",
          use: { ...devices["Pixel 7"] },
          testMatch: /\.mobile\.spec\.ts$/,
        },
        {
          // The tablet case for which touch selection handles are deferred.
          name: "ipad-mini",
          use: { ...devices["iPad Mini"] },
          testMatch: /\.mobile\.spec\.ts$/,
        },
        {
          // Worst case for vertical room, against the editor's fixed 132px of top
          // padding.
          name: "phone-landscape",
          use: { ...devices["iPhone 14 Pro landscape"] },
          testMatch: /\.mobile\.spec\.ts$/,
        },
        {
          // A rotated phone. `phone-landscape` is 734px wide, above the 720px
          // plane threshold, so it takes every desk branch and tests a short
          // desk. A rotated iPhone SE is 667×375, below 720, so it takes every
          // phone branch in 375px of height rather than the 667 to 915 those
          // branches are designed for: the phone chrome, the sheets and the
          // keyboard inset in half their usual vertical room.
          name: "iphone-se-landscape",
          use: {
            ...devices["iPhone 14 Pro"],
            viewport: { width: 667, height: 375 },
          },
          testMatch: /\.mobile\.spec\.ts$/,
        },
      ],
  // `reuseExistingServer` lets a developer's own `npm run dev` serve the run:
  // the demo needs no backend, so a running instance is as good as a fresh
  // one. The preview is always the run's own, so it serves this build.
  webServer: external
    ? undefined
    : demo
      ? {
          command: `node ../tools/serve-site.mjs "${demoDir}" ${demoPort}`,
          url: `http://127.0.0.1:${demoPort}`,
          reuseExistingServer: false,
          timeout: 60_000,
        }
      : build
        ? [
            {
              command: `npm run preview:e2e -- --port ${previewPort}`,
              url: `http://localhost:${previewPort}`,
              reuseExistingServer: false,
              timeout: 60_000,
            },
            devServer,
          ]
        : devServer,
});
