// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { brokenMarkElement } from "./brokenMarkElement";
import { HOLE_PATH } from "./mark";
import { MARK_HEIGHT, MARK_WIDTH } from "./mark";

// Pins that the mark drawn before React runs is the broken `BrandMark`: the
// same classes, so one stylesheet animates both, and the same cut.

describe("the broken mark without React", () => {
  it("draws the figure cut by the spark's core, with the spark going out", () => {
    const svg = brokenMarkElement(56);

    expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(svg.getAttribute("class")).toBe("brand-mark brand-mark-out");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector(".brand-mark-hole")?.getAttribute("d")).toBe(
      HOLE_PATH,
    );
    expect(svg.querySelector(".brand-mark-figure")?.getAttribute("mask")).toBe(
      `url(#${svg.querySelector("mask")?.id})`,
    );
    expect(svg.querySelector(".brand-mark-spark")).not.toBeNull();
  });

  it("keeps the traced frame's proportions", () => {
    const svg = brokenMarkElement(56);
    expect(svg.getAttribute("height")).toBe("56");
    expect(Number(svg.getAttribute("width"))).toBeCloseTo(
      (56 * MARK_WIDTH) / MARK_HEIGHT,
    );
  });
});
