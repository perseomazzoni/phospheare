// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DELTA_MODE_LINE,
  DELTA_MODE_PAGE,
  DELTA_MODE_PIXEL,
  LineRatchet,
  deltaToPixels,
} from "./ratchet";

const LINE = 36;

describe("deltaToPixels", () => {
  it("passes pixel-mode deltas through untouched", () => {
    expect(deltaToPixels(12, DELTA_MODE_PIXEL, LINE)).toBe(12);
    expect(deltaToPixels(-4, DELTA_MODE_PIXEL, LINE)).toBe(-4);
    expect(deltaToPixels(0, DELTA_MODE_PIXEL, LINE)).toBe(0);
  });

  it("treats a line-mode event as exactly one line, whatever its magnitude", () => {
    // Chromium reports ±3 per notch even though the writer asked for one line.
    expect(deltaToPixels(3, DELTA_MODE_LINE, LINE)).toBe(LINE);
    expect(deltaToPixels(-1, DELTA_MODE_LINE, LINE)).toBe(-LINE);
  });

  it("treats page mode as one line too — the typewriter steps in lines", () => {
    expect(deltaToPixels(1, DELTA_MODE_PAGE, LINE)).toBe(LINE);
    expect(deltaToPixels(-5, DELTA_MODE_PAGE, LINE)).toBe(-LINE);
  });
});

describe("LineRatchet", () => {
  it("fires exactly one step per full line-height", () => {
    const r = new LineRatchet();
    expect(r.feed(LINE, LINE)).toBe(1);
    expect(r.feed(-LINE, LINE)).toBe(-1);
  });

  it("carries the leftover fraction across events", () => {
    const r = new LineRatchet();
    expect(r.feed(LINE / 2, LINE)).toBe(0);
    expect(r.feed(LINE / 2, LINE)).toBe(1);
  });

  it("carries a negative leftover across events", () => {
    const r = new LineRatchet();
    expect(r.feed(-LINE / 2, LINE)).toBe(0);
    expect(r.feed(-LINE / 2, LINE)).toBe(-1);
  });

  it("emits multiple steps when a single event travels several lines", () => {
    const r = new LineRatchet();
    expect(r.feed(LINE * 2.5, LINE)).toBe(2);
    expect(r.feed(0, LINE)).toBe(0);
    expect(r.feed(LINE * 0.5, LINE)).toBe(1);
  });

  it("keeps the sign of the remainder", () => {
    const r = new LineRatchet();
    expect(r.feed(-LINE * 1.25, LINE)).toBe(-1);
    // The remaining -0.25 line completes the next negative step early.
    expect(r.feed(-LINE * 0.75, LINE)).toBe(-1);
    expect(r.feed(0, LINE)).toBe(0);
  });

  it("ignores a non-finite delta without disturbing the carried fraction", () => {
    const r = new LineRatchet();
    r.feed(LINE * 0.5, LINE);
    expect(r.feed(Number.NaN, LINE)).toBe(0);
    expect(r.feed(LINE * 0.5, LINE)).toBe(1);
  });

  it("refuses a line height that cannot divide", () => {
    const r = new LineRatchet();
    expect(r.feed(100, 0)).toBe(0);
    expect(r.feed(100, -10)).toBe(0);
  });

  it("reset drops the carried fraction, which was measured in the old size", () => {
    const r = new LineRatchet();
    r.feed(LINE * 0.75, LINE);
    r.reset();
    // The leftover never completes the next step early against a new unit.
    expect(r.feed(LINE * 0.75, LINE)).toBe(0);
    expect(r.feed(LINE * 0.25, LINE)).toBe(1);
  });
});
