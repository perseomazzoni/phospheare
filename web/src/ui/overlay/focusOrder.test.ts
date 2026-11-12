// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { FOCUSABLE, nextFocusIndex } from "./focusOrder";

describe("nextFocusIndex", () => {
  it("steps forward", () => {
    expect(nextFocusIndex(4, 0, false)).toBe(1);
    expect(nextFocusIndex(4, 2, false)).toBe(3);
  });

  it("steps back", () => {
    expect(nextFocusIndex(4, 3, true)).toBe(2);
    expect(nextFocusIndex(4, 1, true)).toBe(0);
  });

  it("wraps at the end", () => {
    expect(nextFocusIndex(4, 3, false)).toBe(0);
  });

  it("wraps at the start", () => {
    expect(nextFocusIndex(4, 0, true)).toBe(3);
  });

  // The first Tab after opening, and any click on something the browser will
  // not focus, both land here.
  it("enters at the start from outside, and at the end going back", () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0);
    expect(nextFocusIndex(4, -1, true)).toBe(3);
  });

  it("treats an index past the end as outside", () => {
    expect(nextFocusIndex(3, 9, false)).toBe(0);
    expect(nextFocusIndex(3, 9, true)).toBe(2);
  });

  it("goes nowhere in a single-element trap", () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });

  // -1 means "leave focus alone": moving focus to a target that does not
  // exist turns an empty trap into one that cannot be left.
  it("reports nowhere to go for an empty trap", () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
    expect(nextFocusIndex(-3, 0, false)).toBe(-1);
  });

  it("returns a real index for every starting point", () => {
    for (const count of [1, 2, 5]) {
      for (let cur = -2; cur <= count + 1; cur += 1) {
        for (const back of [false, true]) {
          const next = nextFocusIndex(count, cur, back);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        }
      }
    }
  });

  it("cycles the whole trap and comes home", () => {
    const count = 5;
    let at = 0;
    for (let i = 0; i < count; i += 1) at = nextFocusIndex(count, at, false);
    expect(at).toBe(0);
  });
});

describe("FOCUSABLE", () => {
  it("matches on the attribute, not the state", () => {
    // A detached or unpainted control carries the attribute; `:disabled` is a
    // state the selector may be evaluated before.
    expect(FOCUSABLE).toContain("button:not([disabled])");
    expect(FOCUSABLE).not.toContain(":disabled");
  });

  it('excludes tabindex="-1", which means script-only', () => {
    expect(FOCUSABLE).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it("is a single valid selector list", () => {
    expect(FOCUSABLE.split(",").length).toBeGreaterThan(5);
    expect(FOCUSABLE).not.toMatch(/,\s*$/);
    expect(FOCUSABLE).not.toMatch(/,,/);
  });
});
