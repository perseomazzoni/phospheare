// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { regexSearch } from "../adapters/regex";
import type { SearchProvider } from "./search";
import type { Doc, Paragraph } from "../domain/model";

// The search provider contract: literal queries, whole-word boundaries that
// never swallow their surroundings, matches that never overlap or escape the
// document, and one shape across the two entry points. The suite runs
// against every `SearchProvider` implementation.

const PLAIN = { bold: false, italic: false, monospace: false };
const para = (text = ""): Paragraph => ({
  runs: text ? [{ text, format: PLAIN }] : [],
  alignment: "left",
  blockType: "paragraph",
});

const providers: { name: string; provider: SearchProvider }[] = [
  { name: "regex", provider: regexSearch },
];

describe.each(providers)("$name search contract", ({ provider }) => {
  describe("buildRegex", () => {
    it("returns null for an empty query", () => {
      expect(
        provider.buildRegex("", { caseSensitive: false, wholeWord: false }),
      ).toBeNull();
    });

    it("treats the query as literal text — metacharacters match themselves", () => {
      const doc: Doc = [para("a.b (c) [d] e*f")];
      const matches = provider.findMatches(doc, ".b", {
        caseSensitive: false,
        wholeWord: false,
      });
      expect(matches).toEqual([
        { para: 0, startOffset: 1, endPara: 0, endOffset: 3 },
      ]);
    });

    it("respects case sensitivity", () => {
      const doc: Doc = [para("Cat cat CAT")];
      expect(
        provider.findMatches(doc, "cat", {
          caseSensitive: false,
          wholeWord: false,
        }).length,
      ).toBe(3);
      expect(
        provider.findMatches(doc, "cat", {
          caseSensitive: true,
          wholeWord: false,
        }),
      ).toEqual([{ para: 0, startOffset: 4, endPara: 0, endOffset: 7 }]);
    });
  });

  describe("wholeWord", () => {
    it("matches only spans bordered by non-word characters", () => {
      const doc: Doc = [para("cat scratch, cat! scatter cat")];
      const matches = provider.findMatches(doc, "cat", {
        caseSensitive: false,
        wholeWord: true,
      });
      expect(matches).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 3 },
        { para: 0, startOffset: 13, endPara: 0, endOffset: 16 },
        { para: 0, startOffset: 26, endPara: 0, endOffset: 29 },
      ]);
    });

    it("matches at the start and end of the paragraph", () => {
      const doc: Doc = [para("cat cat")];
      const matches = provider.findMatches(doc, "cat", {
        caseSensitive: false,
        wholeWord: true,
      });
      expect(matches).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 3 },
        { para: 0, startOffset: 4, endPara: 0, endOffset: 7 },
      ]);
    });

    it("treats unicode letters and digits as word characters", () => {
      const doc: Doc = [para("café café-café")];
      const matches = provider.findMatches(doc, "café", {
        caseSensitive: false,
        wholeWord: true,
      });
      // A hyphen is a non-word character, so it separates words: all three
      // occurrences are whole words.
      expect(matches).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 4 },
        { para: 0, startOffset: 5, endPara: 0, endOffset: 9 },
        { para: 0, startOffset: 10, endPara: 0, endOffset: 14 },
      ]);
    });
  });

  describe("hyphensJoinWords", () => {
    const opts = (hyphensJoinWords: boolean) => ({
      caseSensitive: false,
      wholeWord: true,
      hyphensJoinWords,
    });

    it("defaults to false — hyphens separate words (current behavior)", () => {
      const doc: Doc = [para("café-café")];
      const matches = provider.findMatches(doc, "café", {
        caseSensitive: false,
        wholeWord: true,
      });
      expect(matches).toHaveLength(2);
      // The option is optional: a caller that omits it keeps the default
      // semantics.
      expect(
        provider.findMatches(doc, "café", {
          caseSensitive: false,
          wholeWord: true,
          hyphensJoinWords: false,
        }),
      ).toEqual(matches);
    });

    it("joins hyphenated compounds into one word: the parts no longer match", () => {
      const doc: Doc = [para("café-café")];
      expect(provider.findMatches(doc, "café", opts(true))).toEqual([]);
      expect(
        provider.findMatches(doc, "cat", {
          ...opts(true),
          caseSensitive: true,
        }),
      ).toEqual([]);
    });

    it("the compound itself matches as a single whole word", () => {
      const doc: Doc = [para("café café-café")];
      expect(provider.findMatches(doc, "café-café", opts(true))).toEqual([
        { para: 0, startOffset: 5, endPara: 0, endOffset: 14 },
      ]);
    });

    it("a standalone occurrence still matches among hyphenated ones", () => {
      const doc: Doc = [para("café café-café")];
      expect(provider.findMatches(doc, "café", opts(true))).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 4 },
      ]);
    });

    it("joins every hyphen in the class, not just hyphen-minus", () => {
      const doc: Doc = [para("e\u2010mail well\u2011known")];
      // U+2010 and U+2011 join, so their parts are not whole words…
      expect(provider.findMatches(doc, "e", opts(true))).toEqual([]);
      expect(provider.findMatches(doc, "well", opts(true))).toEqual([]);
      // …and the compound matches as one word when the query uses the same
      // hyphen character, since queries are literal text.
      expect(provider.findMatches(doc, "e\u2010mail", opts(true))).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 6 },
      ]);
    });

    it("en/em dashes stay separators — they are sentence punctuation, not joiners", () => {
      const doc: Doc = [para("she paused\u2014then spoke")];
      expect(provider.findMatches(doc, "paused", opts(true))).toEqual([
        { para: 0, startOffset: 4, endPara: 0, endOffset: 10 },
      ]);
      expect(provider.findMatches(doc, "spoke", opts(true))).toEqual([
        { para: 0, startOffset: 16, endPara: 0, endOffset: 21 },
      ]);
      expect(
        provider.findMatches(doc, "1990", {
          caseSensitive: false,
          wholeWord: true,
          hyphensJoinWords: true,
        }),
      ).toEqual([]);
    });

    it("a range with an en dash keeps its numbers as separate whole words", () => {
      const doc: Doc = [para("1990\u20132000")];
      expect(
        provider.findMatches(doc, "1990", {
          caseSensitive: false,
          wholeWord: true,
          hyphensJoinWords: true,
        }),
      ).toEqual([{ para: 0, startOffset: 0, endPara: 0, endOffset: 4 }]);
      expect(
        provider.findMatches(doc, "2000", {
          caseSensitive: false,
          wholeWord: true,
          hyphensJoinWords: true,
        }),
      ).toEqual([{ para: 0, startOffset: 5, endPara: 0, endOffset: 9 }]);
    });

    it("does not affect non-whole-word searches", () => {
      const doc: Doc = [para("well-known")];
      const loose = provider.findMatches(doc, "known", {
        caseSensitive: false,
        wholeWord: false,
        hyphensJoinWords: true,
      });
      expect(loose).toEqual([
        { para: 0, startOffset: 5, endPara: 0, endOffset: 10 },
      ]);
    });
  });

  describe("searchDoc", () => {
    it("finds spans across multiple paragraphs, in document order", () => {
      const doc: Doc = [para("the cat"), para("the dog"), para("the end")];
      const matches = provider.searchDoc(
        doc,
        provider.buildRegex("the", { caseSensitive: false, wholeWord: false }),
      );
      expect(matches).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 3 },
        { para: 1, startOffset: 0, endPara: 1, endOffset: 3 },
        { para: 2, startOffset: 0, endPara: 2, endOffset: 3 },
      ]);
    });

    it("returns nothing for a null regex", () => {
      expect(provider.searchDoc([para("text")], null)).toEqual([]);
    });

    it("never returns overlapping or out-of-range matches", () => {
      const doc: Doc = [para("aaaa")];
      const matches = provider.searchDoc(
        doc,
        provider.buildRegex("aa", { caseSensitive: false, wholeWord: false }),
      );
      // Left-to-right scan: [0,2), [2,4), never [1,3).
      expect(matches).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 2 },
        { para: 0, startOffset: 2, endPara: 0, endOffset: 4 },
      ]);
      for (const m of matches) {
        expect(m.para).toBeGreaterThanOrEqual(0);
        expect(m.para).toBeLessThan(doc.length);
        const len = doc[m.para].runs.reduce((sum, r) => sum + r.text.length, 0);
        expect(m.startOffset).toBeGreaterThanOrEqual(0);
        expect(m.endOffset).toBeLessThanOrEqual(len);
        expect(m.startOffset).toBeLessThan(m.endOffset);
      }
    });

    it("matches across run boundaries within a paragraph", () => {
      const doc: Doc = [
        {
          runs: [
            { text: "the ", format: PLAIN },
            { text: "cat", format: PLAIN },
          ],
          alignment: "left",
          blockType: "paragraph",
        },
      ];
      const matches = provider.searchDoc(
        doc,
        provider.buildRegex("cat", { caseSensitive: false, wholeWord: false }),
      );
      expect(matches).toEqual([
        { para: 0, startOffset: 4, endPara: 0, endOffset: 7 },
      ]);
    });

    // A query's line break is a paragraph break.
    it("finds a passage that runs across a paragraph break", () => {
      const doc: Doc = [para("It ended."), para("The door shut."), para("x")];
      const find = (query: string, wholeWord = false) =>
        provider.searchDoc(
          doc,
          provider.buildRegex(query, { caseSensitive: false, wholeWord }),
        );
      expect(find("ended.\nthe door")).toEqual([
        { para: 0, startOffset: 3, endPara: 1, endOffset: 8 },
      ]);
      // A break at either end belongs to the paragraphs it joins.
      expect(find("shut.\n")).toEqual([
        { para: 1, startOffset: 9, endPara: 2, endOffset: 0 },
      ]);
      expect(find("\nx")).toEqual([
        { para: 1, startOffset: 14, endPara: 2, endOffset: 1 },
      ]);
      expect(find("ended.\nthe", true)).toHaveLength(1);
      // Without a break, nothing runs across one.
      expect(find("ended.the door")).toEqual([]);
      expect(find("ended. the door")).toEqual([]);
    });

    it("never matches into, out of or through a page break", () => {
      const pagebreak: Paragraph = {
        runs: [],
        alignment: "left",
        blockType: "pagebreak",
      };
      const doc: Doc = [para("End."), pagebreak, para("Start.")];
      const find = (query: string) =>
        provider.searchDoc(
          doc,
          provider.buildRegex(query, {
            caseSensitive: false,
            wholeWord: false,
          }),
        );
      expect(find("End.\n\nStart.")).toEqual([]);
      expect(find("End.\n")).toEqual([]);
      expect(find("\nStart.")).toEqual([]);
      // Its mark is never something a query asks for.
      expect(
        provider.buildRegex("\u0000", {
          caseSensitive: false,
          wholeWord: false,
        }),
      ).toBeNull();
      expect(find("Start.")).toEqual([
        { para: 2, startOffset: 0, endPara: 2, endOffset: 6 },
      ]);
    });
  });

  describe("findTextOccurrences", () => {
    it("finds every case-insensitive occurrence of a literal text", () => {
      const doc: Doc = [para("The the THE"), para("unrelated")];
      expect(provider.findTextOccurrences(doc, "the")).toEqual([
        { para: 0, startOffset: 0, endPara: 0, endOffset: 3 },
        { para: 0, startOffset: 4, endPara: 0, endOffset: 7 },
        { para: 0, startOffset: 8, endPara: 0, endOffset: 11 },
      ]);
    });

    it("returns nothing for an empty text", () => {
      expect(provider.findTextOccurrences([para("x")], "")).toEqual([]);
    });
  });
});
