// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { RELOAD_WINDOW_MS, mayAutoReload } from "./reloadPolicy";

// Pins the reload limit: one automatic reload per window, so a chunk missing
// from the new build too cannot reload the tab forever.

describe("mayAutoReload", () => {
  const now = 1_000_000;

  it("allows the first reload", () => {
    expect(mayAutoReload(null, now)).toBe(true);
  });

  it("refuses a second reload inside the window", () => {
    expect(mayAutoReload(now - 1, now)).toBe(false);
    expect(mayAutoReload(now - RELOAD_WINDOW_MS + 1, now)).toBe(false);
  });

  it("allows one again once the window has passed", () => {
    expect(mayAutoReload(now - RELOAD_WINDOW_MS, now)).toBe(true);
  });

  it("treats a remembered time in the future as no reload", () => {
    expect(mayAutoReload(now + 5_000, now)).toBe(true);
  });
});
