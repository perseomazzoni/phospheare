// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  isReviewReferences,
  isReviewScope,
  normaliseTyped,
  passageFor,
  scopeKindOf,
} from "./scope";
import { REVIEW_REFERENCES_MAX, REVIEW_REFERENCE_ID_MAX } from "./types";

describe("the scope words", () => {
  it("reads either language, in any case", () => {
    expect(scopeKindOf("Section")).toBe("section");
    expect(scopeKindOf(" SEZIONE ")).toBe("section");
    expect(scopeKindOf("struttura")).toBe("structure");
    // The retired words are not scopes.
    expect(scopeKindOf("full")).toBeNull();
    expect(scopeKindOf("focused")).toBeNull();
    // `part` is the review that crosses a Part's Sections.
    expect(scopeKindOf("part")).toBe("part");
    expect(scopeKindOf("Parte")).toBe("part");
    // Not a prefix: a sentence that begins with the word stays a question.
    expect(scopeKindOf("parts")).toBeNull();
  });

  it("compares typed text by what a writer sees, and nothing looser", () => {
    expect(normaliseTyped("  The   Harbour ")).toBe("the harbour");
    expect(normaliseTyped("Café")).toBe(normaliseTyped("Café"));
    expect(normaliseTyped("The Harbour.")).not.toBe(
      normaliseTyped("The Harbour"),
    );
  });

  it("accepts only a scope this app can run, read back from a file", () => {
    expect(isReviewScope({ kind: "current" })).toBe(true);
    expect(isReviewScope({ kind: "structure" })).toBe(true);
    expect(isReviewScope({ kind: "node", nodeId: "a" })).toBe(true);
    for (const value of [
      null,
      "structure",
      [],
      { kind: "full" },
      { kind: "node", nodeId: "" },
      { kind: "node", nodeId: 3 },
    ])
      expect(isReviewScope(value)).toBe(false);
  });
});

// The named reference a chat file or a plan may carry is only its shape here;
// which ids the review may still read is the run's.
describe("isReviewReferences", () => {
  it("takes a bounded, non-empty set of distinct reference ids and nothing else", () => {
    expect(isReviewReferences(["reference:character--Marta.md"])).toBe(true);
    expect(
      isReviewReferences(
        Array.from(
          { length: REVIEW_REFERENCES_MAX },
          (_, i) => `reference:${i}`,
        ),
      ),
    ).toBe(true);
    for (const value of [
      undefined,
      "reference:a.md",
      [],
      ["reference:a.md", "reference:a.md"],
      ["node:S1"],
      ["reference:"],
      [7],
      [`reference:${"x".repeat(REVIEW_REFERENCE_ID_MAX)}`],
      Array.from(
        { length: REVIEW_REFERENCES_MAX + 1 },
        (_, i) => `reference:${i}`,
      ),
    ])
      expect(isReviewReferences(value), JSON.stringify(value)).toBe(false);
  });
});

describe("passageFor", () => {
  it("gives the quote to the nearest scope only", () => {
    expect(passageFor({ kind: "current" }, "A line.")).toBe("A line.");
    for (const scope of [
      { kind: "section" },
      { kind: "part" },
      { kind: "structure" },
      { kind: "node", nodeId: "S1" },
    ] as const)
      expect(passageFor(scope, "A line.")).toBeUndefined();
  });
});
