// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { factsOf, sameFacts, withFacts, type ProjectFacts } from "./facts";
import { defaultProperties } from "./properties";

// The book's facts as the Properties window reads and writes them:
// nine fields of the `document` block, each through the file reader's own
// guard, and nothing else in the file touched.

const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  title: "Once Dark",
  author: "M. Rossi",
  type: "Novel",
  goal: 80000,
  language: "it",
  structure: "threeact",
  genres: ["horror"],
  ageCategory: "adult",
  tropes: ["found family"],
  ...over,
});

describe("factsOf", () => {
  it("reads the nine facts from the document block", () => {
    const props = withFacts(defaultProperties("Draft"), facts());
    expect(factsOf(props)).toEqual(facts());
  });
});

describe("withFacts", () => {
  it("writes every fact and keeps the rest of the file", () => {
    const before = defaultProperties("Draft");
    before.ui.dockWidth = 420;
    before.stats.words = 1200;
    const after = withFacts(before, facts());

    expect(factsOf(after)).toEqual(facts());
    expect(after.document.id).toBe(before.document.id);
    expect(after.document.createdAt).toBe(before.document.createdAt);
    expect(after.ui).toEqual(before.ui);
    expect(after.stats).toEqual(before.stats);
    expect(after.snapshotHashes).toBe(before.snapshotHashes);
  });

  it("keeps the stored title and language when the answer is empty", () => {
    const before = withFacts(defaultProperties("Draft"), facts());
    const after = withFacts(before, facts({ title: "   ", language: "" }));
    expect(after.document.title).toBe("Once Dark");
    expect(after.document.language).toBe("it");
  });

  it("runs every answer through the file reader's guard", () => {
    const after = withFacts(
      defaultProperties("Draft"),
      facts({
        title: "  Once Dark  ",
        author: "  M.\nRossi ",
        type: "  ",
        goal: 0,
        structure: "empty",
        genres: ["horror", "horror", "nonsense" as never],
        ageCategory: "nobody" as never,
        tropes: ["  found family ", ""],
      }),
    );
    expect(after.document.title).toBe("Once Dark");
    expect(after.document.author).toBe("M. Rossi");
    // An empty type is nobody's choice, and falls back to the default.
    expect(after.document.type).toBe("Novel");
    // A goal of zero is not a goal.
    expect(after.document.goal).toBeNull();
    // "No structure" persists as null.
    expect(after.document.structure).toBeNull();
    expect(after.document.genres).toEqual(["horror"]);
    expect(after.document.ageCategory).toBeNull();
    expect(after.document.tropes).toEqual(["found family"]);
  });

  it("stores a custom type as the words typed", () => {
    const after = withFacts(
      defaultProperties("Draft"),
      facts({ type: " Screenplay " }),
    );
    expect(after.document.type).toBe("Screenplay");
  });
});

describe("sameFacts", () => {
  it("is true for answers the file would hold the same way", () => {
    expect(sameFacts(facts(), facts({ title: " Once Dark " }))).toBe(true);
  });

  it("is false when any fact changed", () => {
    expect(sameFacts(facts(), facts({ goal: 90000 }))).toBe(false);
    expect(sameFacts(facts(), facts({ genres: [] }))).toBe(false);
    expect(sameFacts(facts(), facts({ author: "Someone" }))).toBe(false);
  });
});
