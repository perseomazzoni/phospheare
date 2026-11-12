// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  editDistance,
  excerptAround,
  findTerms,
  fold,
  occurrences,
  typographic,
} from "./textMatch";

describe("the one text matcher", () => {
  it("folds marks, case and accents one unit for one", () => {
    expect(typographic("l’«eco» — sì\u00a0no")).toBe(`l'"eco" - sì no`);
    expect(fold("Perché È CAFFÈ")).toBe("perche e caffe");
    // Every fold keeps the length, so every offset survives.
    for (const text of ["Perché È", "İstanbul", "a😀b", "«Là»—’"])
      expect(fold(text)).toHaveLength(text.length);
    // A letter whose lower case is longer keeps its case; an astral
    // character stays whole.
    expect(fold("İ")).toHaveLength(1);
    expect(fold("a😀b")).toBe("a😀b");
  });

  it("finds every occurrence, and nothing for an empty needle", () => {
    expect(occurrences("abcabc", "bc")).toEqual([1, 4]);
    expect(occurrences("aaaa", "aa")).toEqual([0, 2]);
    expect(occurrences("abc", "")).toEqual([]);
  });

  it("finds terms in reading order, folded, whole words when asked", () => {
    const text = "Leo rise. Leonardo no. Poi LEÒ tornò, e leo dormì.";
    expect(
      findTerms(text, ["leo"], { wholeWord: true }).map((one) =>
        text.slice(one.start, one.end),
      ),
    ).toEqual(["Leo", "LEÒ", "leo"]);
    expect(findTerms(text, ["leo"])).toHaveLength(4);
    // Two terms over one passage are one match, the longer kept.
    const both = findTerms("il faro rosso", ["faro", "faro rosso", "rosso"]);
    expect(both.map((one) => one.term)).toEqual(["faro rosso"]);
    expect(findTerms("abc", ["  "])).toEqual([]);
  });

  it("cuts an excerpt at whole words, marked where the text goes on", () => {
    const text = "uno due tre quattro cinque sei sette";
    const at = text.indexOf("quattro");
    expect(excerptAround(text, at, at + 7, 6)).toBe("…tre quattro…");
    expect(excerptAround("a\nb", 0, 1, 10)).toBe("a b");
    expect(excerptAround(text, 0, 3, 100)).toBe(text);
  });

  it("counts a swap of neighbours as one edit", () => {
    expect(editDistance("Matrina", "Martina")).toBe(1);
    expect(editDistance("Leo", "Leone")).toBe(2);
    expect(editDistance("", "abc")).toBe(3);
  });
});
