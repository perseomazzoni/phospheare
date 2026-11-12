// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { graphemeAfter, graphemeBefore } from "./graphemes";

// Each cluster is one character on screen and several code units in the text.
const CLUSTERS: [string, string][] = [
  ["a ZWJ sequence", "👩‍💻"],
  ["a flag", "🇮🇹"],
  ["a skin tone", "👍🏽"],
  ["a keycap", "1️⃣"],
  ["a combining accent", `e${String.fromCodePoint(0x301)}`],
  ["Hangul jamo", String.fromCodePoint(0x1100, 0x1161, 0x11a8)],
  ["a surrogate pair", "😀"],
];

describe("grapheme boundaries", () => {
  it.each(CLUSTERS)("steps over %s whole, in both directions", (_, cluster) => {
    const text = `a${cluster}b`;
    const end = 1 + cluster.length;
    expect(graphemeBefore(text, end)).toBe(1);
    expect(graphemeAfter(text, 1)).toBe(end);
  });

  it("steps one code unit over plain text", () => {
    expect(graphemeBefore("abc", 2)).toBe(1);
    expect(graphemeAfter("abc", 1)).toBe(2);
  });

  it("stops at the ends of the text", () => {
    expect(graphemeBefore("abc", 0)).toBe(0);
    expect(graphemeAfter("abc", 3)).toBe(3);
    expect(graphemeBefore("", 0)).toBe(0);
    expect(graphemeAfter("", 0)).toBe(0);
  });

  it("answers the boundaries next to a cluster, not inside it", () => {
    const text = "🇮🇹🇮🇹";
    expect(graphemeBefore(text, 8)).toBe(4);
    expect(graphemeBefore(text, 4)).toBe(0);
    expect(graphemeAfter(text, 4)).toBe(8);
  });
});

describe("grapheme boundaries without Intl.Segmenter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to code points, so a surrogate pair is never split", async () => {
    const { Segmenter: _, ...rest } = Intl as typeof Intl & {
      Segmenter?: unknown;
    };
    vi.stubGlobal("Intl", rest);
    vi.resetModules();
    const fallback = await import("./graphemes");
    expect(fallback.graphemeBefore("a😀", 3)).toBe(1);
    expect(fallback.graphemeAfter("😀b", 0)).toBe(2);
    expect(fallback.graphemeBefore("ab", 2)).toBe(1);
    expect(fallback.graphemeAfter("ab", 0)).toBe(1);
    // A joined sequence goes one code point at a time.
    expect(fallback.graphemeBefore("👩‍💻", 5)).toBe(3);
  });
});
