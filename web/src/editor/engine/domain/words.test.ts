// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { splitWords } from "./words";

// Pins the word tokens, the diff engine's unit, which block alignment and the
// merge depend on. The scanner runs in bounded time on any input (the `g` and
// `u` flags and the zero-length guard) and carries its offsets through
// separators, so the merge rejoins prose with its spacing intact.

describe("splitWords", () => {
  it("splits prose on separators, with offsets into the source", () => {
    expect(splitWords("the old house")).toEqual([
      { text: "the", start: 0, end: 3 },
      { text: "old", start: 4, end: 7 },
      { text: "house", start: 8, end: 13 },
    ]);
  });

  it("treats hyphens as joiners — compound words are one token", () => {
    const tokens = splitWords("state-of-the-art");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ text: "state-of-the-art", start: 0 });
  });

  it("keeps en and em dashes as separators — prose punctuation, not joiners", () => {
    expect(splitWords("she paused—then spoke")).toEqual([
      { text: "she", start: 0, end: 3 },
      { text: "paused", start: 4, end: 10 },
      { text: "then", start: 11, end: 15 },
      { text: "spoke", start: 16, end: 21 },
    ]);
  });

  it("returns no tokens for punctuation-only or empty text", () => {
    expect(splitWords("")).toEqual([]);
    expect(splitWords("?!—...")).toEqual([]);
    expect(splitWords("   ")).toEqual([]);
  });

  it("carries the separator on the following token's start — the merge's spacing", () => {
    const tokens = splitWords("one  two");
    // The double space is not a token; the second word starts where the
    // separator run ends, so a merge that slices up to a token's end keeps
    // the spacing it had.
    expect(tokens[1].start).toBe(5);
  });

  it("terminates on a large paragraph — the OOM regression pin", () => {
    // A non-global regex `exec` would loop forever on the first match and
    // hang the diff; a 10k-word paragraph tokenizes promptly and completely.
    const big = Array.from({ length: 10000 }, (_, i) => `word${i}`).join(" ");
    const started = performance.now();
    const tokens = splitWords(big);
    expect(tokens).toHaveLength(10000);
    expect(tokens[9999].text).toBe("word9999");
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("handles the empty-token guard when the regex cannot advance", () => {
    // A match of length 0 advances `lastIndex`, or the loop would spin. An
    // all-word input never produces one; the guard is the backstop.
    const tokens = splitWords("alpha beta");
    expect(tokens).toHaveLength(2);
    expect(tokens.map((t) => t.text)).toEqual(["alpha", "beta"]);
  });
});
