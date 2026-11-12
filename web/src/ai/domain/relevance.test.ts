// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { RELEVANCE_TERMS_MAX, relevanceTerms } from "./relevance";

describe("what a request is about", () => {
  it("takes the request's longer words and the prose's names, most frequent first", () => {
    const prose = [
      "Marta walked to the harbour. The harbour was grey. Marta waited.",
      "The tide turned; the boats came in. Marta smiled at Luca.",
    ];
    const terms = relevanceTerms("Is the harbour timeline right?", prose);
    // "Marta" is a name (capitalised three times, never lower case), the
    // most said, so it leads; "The" opens sentences but is "the" elsewhere,
    // so it is no name; "Luca" is said once, so it is no name yet.
    expect(terms.slice(0, 2)).toEqual(["marta", "harbour"]);
    expect(terms).toContain("timeline");
    expect(terms).toContain("right");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("luca");
    expect(terms).not.toContain("is");
  });

  it("works in any language and folds what it matches on", () => {
    const terms = relevanceTerms("La cronologia di Màrta è giusta?", [
      "Màrta guardava il porto. Il porto era grigio. Màrta aspettò.",
    ]);
    expect(terms).toContain("marta");
    expect(terms).toContain("cronologia");
    expect(terms).toContain("giusta");
    expect(terms).not.toContain("il");
  });

  it("is empty with nothing to go on, and bounded otherwise", () => {
    expect(relevanceTerms("", [])).toEqual([]);
    expect(relevanceTerms("a an to", ["the a"])).toEqual([]);
    // Sixty distinct letter-only words: digits are not letters to the
    // matcher, so "word1".."word60" would fold to one term.
    const many = Array.from(
      { length: 60 },
      (_, n) =>
        "word" +
        String.fromCharCode(97 + Math.floor(n / 26)) +
        String.fromCharCode(97 + (n % 26)),
    ).join(" ");
    expect(relevanceTerms(many, []).length).toBe(RELEVANCE_TERMS_MAX);
  });
});
