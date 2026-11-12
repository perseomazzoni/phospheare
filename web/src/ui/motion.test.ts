// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { motionIsStill } from "./motion";

function lessMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduced-motion"),
    media: query,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("motionIsStill", () => {
  it("holds still for a writer who asked for less motion", () => {
    lessMotion(true);
    expect(motionIsStill()).toBe(true);
  });

  it("moves otherwise, under every theme", () => {
    lessMotion(false);
    expect(motionIsStill()).toBe(false);
  });
});
