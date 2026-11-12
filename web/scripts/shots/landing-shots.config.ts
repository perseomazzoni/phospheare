// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { defineConfig, devices } from "@playwright/test";

// The landing page's screenshots (`landing-shots.spec.ts`). Run from `web/`:
//
//   npm run shots:landing
//
// Against the dev server, which it starts when none is up, or against the one
// at SHOTS_BASE_URL when another checkout holds 5173. Outside the e2e run's
// `testDir`, so CI never takes these pictures.
const BASE = process.env.SHOTS_BASE_URL;
export default defineConfig({
  testDir: ".",
  testMatch: /landing-shots\.spec\.ts$/,
  outputDir: "../../test-results/shots",
  globalTeardown: "./manifest.ts",
  workers: 4,
  fullyParallel: true,
  retries: 1,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE ?? "http://localhost:5173",
    // Every compositor stage before each frame, on one thread, so frosted
    // panes and corners come out whole.
    launchOptions: {
      args: [
        "--run-all-compositor-stages-before-draw",
        "--disable-threaded-animation",
        "--disable-threaded-scrolling",
      ],
    },
    trace: "off",
  },
  webServer: BASE
    ? undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
