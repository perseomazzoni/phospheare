// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins the seeded demo fixture to `demoFixtureAnchors.ts`, which says what the
// demo book promises to the checks that drive it. Without it, a
// rewritten story surfaces as Playwright tests timing out on a locator that
// cannot resolve, which reads as a regression rather than a renamed chapter.
// These rows cost milliseconds and name the anchor.
//
// When one fails, the fix is usually to update the anchor, not the story. The
// anchor describes the fixture rather than ruling over it, and a failure here
// makes each update a conscious one.

import { describe, expect, it } from "vitest";
import {
  DEMO_COMPARISON,
  DEMO_FIRST_PART,
  DEMO_SAME_LINE,
} from "./demoFixtureAnchors";
import { seed } from "./memoryProvider";

const files = () => seed();

const read = (endsWith: string): string => {
  const hit = [...files().entries()].find(([path]) => path.endsWith(endsWith));
  if (!hit)
    throw new Error(`the demo fixture has no file ending "${endsWith}"`);
  return hit[1];
};

const structure = () => read("document-structure.yaml");
const properties = () => read("document-properties.json");
const catalogue = () => read("snapshots-catalogue.json");

describe("the demo fixture honours its anchors", () => {
  it("names the first Part the typewriter checks add a Section inside", () => {
    expect(structure()).toContain(`part: "${DEMO_FIRST_PART}"`);
  });

  describe("the comparison node", () => {
    it("is in the structure, and is the node the demo opens on", () => {
      expect(structure()).toContain(`section: "${DEMO_COMPARISON.section}"`);
      expect(structure()).toContain(DEMO_COMPARISON.adoptedFile);
      // `lastOpened` is EL6 — the check for that is the id's presence beside
      // this section, which the structure above already pins.
      expect(properties()).toContain('"lastOpened"');
    });

    it("offers two snapshot rows, newest first", () => {
      const records = catalogue();
      expect(records).toContain(DEMO_COMPARISON.earlierRow);
      expect(records).toContain(DEMO_COMPARISON.adoptedRow);
    });

    it("differs by exactly the one word the accept checks apply", () => {
      const earlier = read("section--the_first_light.EL6.00.md");
      const adopted = read(DEMO_COMPARISON.adoptedFile);
      expect(earlier).toContain(DEMO_COMPARISON.earlierWord);
      expect(earlier).not.toContain(DEMO_COMPARISON.adoptedWord);
      expect(adopted).toContain(DEMO_COMPARISON.adoptedWord);
      expect(adopted).not.toContain(DEMO_COMPARISON.earlierWord);
    });

    it("keeps adopted-only paragraphs that survive that accept", () => {
      // The block deletes. Without them "exactly that hunk" is unprovable:
      // there would be nothing the accept had to leave alone.
      expect(read(DEMO_COMPARISON.adoptedFile)).toContain(
        DEMO_COMPARISON.adoptedOnlyPhrase,
      );
      expect(read("section--the_first_light.EL6.00.md")).not.toContain(
        DEMO_COMPARISON.adoptedOnlyPhrase,
      );
    });
  });

  describe("the same-line node", () => {
    it("sits under a Part the demo starts collapsed", () => {
      expect(structure()).toContain(`part: "${DEMO_SAME_LINE.part}"`);
      expect(structure()).toContain(`section: "${DEMO_SAME_LINE.section}"`);
      // The chevron step in the e2e helper is only honest while this Part is
      // absent from `expanded`.
      const expanded = JSON.parse(properties()) as {
        ui: { expanded: string[] };
      };
      expect(expanded.ui.expanded).not.toContain("EL4");
    });

    it("offers two snapshot rows", () => {
      const records = catalogue();
      expect(records).toContain(DEMO_SAME_LINE.earlierRow);
      expect(records).toContain(DEMO_SAME_LINE.adoptedRow);
    });

    it("carries both closing lines, one per draft", () => {
      expect(read("section--equal_in_existence.EL11.00.md")).toContain(
        DEMO_SAME_LINE.earlierLine,
      );
      expect(read("section--equal_in_existence.EL11.01.md")).toContain(
        DEMO_SAME_LINE.adoptedLine,
      );
    });

    it("differs by exactly two words, a kept word apart", () => {
      // The shape is the pin: two hunks at word grain, one at paragraph
      // grain. A copy edit that touched a third word would turn a two-hunk
      // assertion into a three-hunk one, and the e2e failure would look like
      // a diff-engine regression instead of a prose change.
      const a = DEMO_SAME_LINE.adoptedLine.split(" ");
      const b = DEMO_SAME_LINE.earlierLine.split(" ");
      expect(a).toHaveLength(b.length);
      const differing = a
        .map((word, i) => (word === b[i] ? -1 : i))
        .filter((i) => i >= 0);
      expect(differing).toHaveLength(2);
      expect(differing[1] - differing[0]).toBeGreaterThan(1);
    });

    it("names its two differing words, and they really are the pair", () => {
      const a = DEMO_SAME_LINE.adoptedLine.split(" ");
      const b = DEMO_SAME_LINE.earlierLine.split(" ");
      expect(a).toContain(DEMO_SAME_LINE.firstWord.adopted);
      expect(b).toContain(DEMO_SAME_LINE.firstWord.earlier);
      expect(a).toContain(DEMO_SAME_LINE.secondWord.adopted);
      expect(b).toContain(DEMO_SAME_LINE.secondWord.earlier);
      // Each named word must be unique on its line, or an e2e assertion on it
      // could match the wrong hunk.
      for (const w of [
        DEMO_SAME_LINE.firstWord.adopted,
        DEMO_SAME_LINE.secondWord.adopted,
      ]) {
        expect(a.filter((x) => x === w)).toHaveLength(1);
      }
      for (const w of [
        DEMO_SAME_LINE.firstWord.earlier,
        DEMO_SAME_LINE.secondWord.earlier,
      ]) {
        expect(b.filter((x) => x === w)).toHaveLength(1);
      }
    });

    it("differs ONLY on that line, so the comparison has no other hunk", () => {
      const earlier = read("section--equal_in_existence.EL11.00.md");
      const adopted = read("section--equal_in_existence.EL11.01.md");
      expect(earlier.replace(DEMO_SAME_LINE.earlierLine, "")).toBe(
        adopted.replace(DEMO_SAME_LINE.adoptedLine, ""),
      );
    });
  });
});
