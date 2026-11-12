// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  alignBlocks,
  buildMergedDoc,
  diffTokens,
  paragraphText,
  splitSentences,
} from "./index";
import { commonmarkCodec } from "../../adapters/commonmark";
import { validateDoc } from "../../domain/invariants";
import type { Doc } from "../../domain/model";
import { splitWords } from "../../domain/words";

// ── diffTokens ───────────────────────────────────────────────────────────────

describe("diffTokens", () => {
  it("keeps identical prose whole", () => {
    const ops = diffTokens(["the", "rain", "fell"], ["the", "rain", "fell"]);
    expect(ops).toEqual([
      { kind: "keep", target: 0 },
      { kind: "keep", target: 1 },
      { kind: "keep", target: 2 },
    ]);
  });

  it("splices a deleted word in at the position its context implies", () => {
    const ops = diffTokens(["the", "old", "house"], ["the", "house"]);
    expect(ops).toEqual([
      { kind: "keep", target: 0 },
      { kind: "delete", base: 1 },
      { kind: "keep", target: 1 },
    ]);
  });

  it("marks an inserted word between keeps", () => {
    const ops = diffTokens(["the", "house"], ["the", "old", "house"]);
    expect(ops).toEqual([
      { kind: "keep", target: 0 },
      { kind: "insert", target: 1 },
      { kind: "keep", target: 2 },
    ]);
  });

  it("walks a full replacement with the insertion leading", () => {
    const ops = diffTokens(["before"], ["after"]);
    expect(ops).toEqual([
      { kind: "insert", target: 0 },
      { kind: "delete", base: 0 },
    ]);
  });

  it("keeps the script in target order", () => {
    const ops = diffTokens(["a", "b", "c", "d"], ["x", "b", "c", "y"]);
    // The walk prefers an insert on a tie, which keeps the common words
    // aligned: `x` is emitted where `a` stood, before `a` is deleted.
    expect(ops).toEqual([
      { kind: "insert", target: 0 },
      { kind: "delete", base: 0 },
      { kind: "keep", target: 1 },
      { kind: "keep", target: 2 },
      { kind: "insert", target: 3 },
      { kind: "delete", base: 3 },
    ]);
  });
});

// ── alignBlocks ──────────────────────────────────────────────────────────────

const codec = commonmarkCodec;

function parse(md: string): Doc {
  return codec.parse(md);
}

describe("alignBlocks", () => {
  it("pairs identical blocks one-to-one, in order", () => {
    const pairs = alignBlocks(
      parse("one\n\ntwo\n\nthree"),
      parse("one\n\ntwo\n\nthree"),
    );
    expect(pairs.map((p) => [p.left, p.right, p.equal])).toEqual([
      [0, 0, true],
      [1, 1, true],
      [2, 2, true],
    ]);
  });

  it("finds the changed island between untouched spans", () => {
    const pairs = alignBlocks(
      parse("one\n\ntwo\n\nthree"),
      parse("one\n\ntwo changed\n\nthree"),
    );
    expect(pairs.map((p) => [p.left, p.right, p.equal])).toEqual([
      [0, 0, true],
      [1, 1, false],
      [2, 2, true],
    ]);
  });

  it("treats a paragraph that was rewritten as a paired edit, not a delete", () => {
    // Shared words plus additions: the overlap clears the threshold, so the
    // paragraph pairs and diffs at word level.
    const pairs = alignBlocks(
      parse("the house stood empty"),
      parse("the old house stood empty for a year"),
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ left: 0, right: 0, equal: false });
  });

  it("splices a left-only paragraph in at its position", () => {
    const pairs = alignBlocks(
      parse("one\n\nbetween\n\nthree"),
      parse("one\n\nthree"),
    );
    expect(pairs.map((p) => [p.left, p.right])).toEqual([
      [0, 0],
      [1, -1],
      [2, 1],
    ]);
  });

  it("emits a right-only paragraph as an insert", () => {
    const pairs = alignBlocks(
      parse("one\n\nthree"),
      parse("one\n\nnew\n\nthree"),
    );
    expect(pairs.map((p) => [p.left, p.right])).toEqual([
      [0, 0],
      [-1, 1],
      [1, 2],
    ]);
  });
});

// ── buildMergedDoc ───────────────────────────────────────────────────────────

function docOf(md: string): Doc {
  return parse(md);
}

function plain(doc: Doc): string[] {
  return doc.map(paragraphText);
}

describe("buildMergedDoc", () => {
  it("renders an unchanged document unchanged, with no decorations", () => {
    const merged = buildMergedDoc(docOf("one\n\ntwo"), docOf("one\n\ntwo"));
    expect(plain(merged.doc)).toEqual(["one", "two"]);
    expect(merged.decorations).toEqual([]);
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("splices a deleted word back in, marked as deleted, and marks insertions", () => {
    const adopted = docOf("the old house stood empty");
    const compared = docOf("the house stood empty");
    const merged = buildMergedDoc(adopted, compared);
    expect(plain(merged.doc)).toEqual(["the old house stood empty"]);
    // The deleted span carries the separator the word had in the adopted
    // text, so the merged sentence reads with its spacing intact.
    expect(merged.decorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "deleted" },
    ]);
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("a deleted first word carries its trailing separator — the next kept word must not glue onto it", () => {
    // Adopted "The cat sat", compared "cat sat": the deleted head word keeps
    // its separator ("The cat sat"), never "Thecat sat".
    const adopted = docOf("The cat sat");
    const compared = docOf("cat sat");
    const merged = buildMergedDoc(adopted, compared);
    expect(plain(merged.doc)).toEqual(["The cat sat"]);
    expect(merged.decorations).toEqual([
      { para: 0, from: 0, to: 4, kind: "deleted" },
    ]);
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("marks text only in the compared snapshot as inserted", () => {
    const adopted = docOf("the house stood empty");
    const compared = docOf("the old house stood empty");
    const merged = buildMergedDoc(adopted, compared);
    expect(plain(merged.doc)).toEqual(["the old house stood empty"]);
    expect(merged.decorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "inserted" },
    ]);
  });

  it("keeps the three states distinct in one paragraph", () => {
    // Adopted "a b c d e", compared "a x c y": b, d and e deleted, x and y
    // inserted.
    const adopted = docOf("a b c d e");
    const compared = docOf("a x c y");
    const merged = buildMergedDoc(adopted, compared);
    expect(merged.decorations.map((d) => d.kind)).toEqual([
      "inserted",
      "deleted",
      "inserted",
      "deleted",
      "deleted",
    ]);
    // The merged text holds every word, in a coherent order.
    const text = paragraphText(merged.doc[0]);
    expect(text).toContain("a");
    expect(text).toContain("x");
    expect(text).toContain("c");
    expect(text).toContain("y");
    expect(text).toContain("b");
    expect(text).toContain("e");
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("splices an adopted-only paragraph in with a whole-block deletion mark", () => {
    const merged = buildMergedDoc(
      docOf("one\n\nbetween\n\nthree"),
      docOf("one\n\nthree"),
    );
    expect(plain(merged.doc)).toEqual(["one", "between", "three"]);
    expect(merged.decorations).toEqual([
      { para: 1, from: 0, to: 7, kind: "deleted" },
    ]);
  });

  it("marks a compared-only paragraph as a whole-block insertion", () => {
    const merged = buildMergedDoc(
      docOf("one\n\nthree"),
      docOf("one\n\nnew\n\nthree"),
    );
    expect(plain(merged.doc)).toEqual(["one", "new", "three"]);
    expect(merged.decorations).toEqual([
      { para: 1, from: 0, to: 3, kind: "inserted" },
    ]);
  });

  it("preserves the compared paragraph's formatting for kept and inserted text", () => {
    const adopted = docOf("plain words");
    const compared = docOf("**bold** words");
    const merged = buildMergedDoc(adopted, compared);
    const runs = merged.doc[0].runs;
    // The inserted word wears the compared paragraph's bold; the kept word
    // after it stays plain (the deleted "plain" and the kept " words" merge
    // into one non-bold run once the marks are taken out of the runs).
    expect(runs.some((r) => r.format.bold && r.text.includes("bold"))).toBe(
      true,
    );
    expect(runs.some((r) => !r.format.bold && r.text.includes("words"))).toBe(
      true,
    );
  });

  it("keeps runs minimally merged (the engine invariant)", () => {
    const merged = buildMergedDoc(docOf("a b c"), docOf("a b c"));
    expect(merged.doc[0].runs).toHaveLength(1);
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("survives an empty paragraph on either side", () => {
    const merged = buildMergedDoc(docOf(""), docOf(""));
    expect(merged.doc).toHaveLength(1);
    expect(merged.doc[0].runs.length).toBeGreaterThanOrEqual(1);
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("produces a document the codec round-trips", () => {
    const merged = buildMergedDoc(
      docOf("the old house\n\nstood empty"),
      docOf("the new house\n\nstood empty for a year"),
    );
    const again = codec.parse(codec.serialize(merged.doc));
    expect(again).toEqual(merged.doc);
  });
});

// ── Grain edge cases ─────────────────────────────────────────────────────────

describe("— paragraph grain sees a moved pagebreak", () => {
  it("a moved {pagebreak} emits block hunks, never a silent equal pair", () => {
    const merged = buildMergedDoc(
      parse("one\n\n{pagebreak}\n\nthree"),
      parse("one\n\nthree\n\n{pagebreak}"),
      "paragraph",
    );
    // The paragraph grain exists to show block changes, so a moved break
    // surfaces as a change, never hidden behind a crossed empty-text pairing:
    // a whole-block delete at its old seat and an insert at the new one.
    expect(merged.hunks.map((h) => [h.block, h.kind])).toEqual([
      [true, "delete"],
      [true, "insert"],
    ]);
    expect(merged.hunks[0].left).toEqual({ para: 1, from: 0, to: 0 });
    expect(merged.hunks[0].right).toEqual({ para: 1, from: 0, to: 0 });
    expect(merged.hunks[1].left.para).toBe(3);
    expect(merged.hunks[1].right.para).toBe(2);
  });

  it("a break↔empty-paragraph swap and a heading↔paragraph swap surface as hunks", () => {
    const breakSwap = buildMergedDoc(
      parse("one\n\n\n\nthree"),
      parse("one\n\n{pagebreak}\n\nthree"),
      "paragraph",
    );
    expect(breakSwap.hunks.map((h) => [h.block, h.kind])).toEqual([
      [true, "insert"],
      [true, "delete"],
    ]);
    const headingSwap = buildMergedDoc(
      parse("One\n\ntext"),
      parse("# One\n\ntext"),
      "paragraph",
    );
    expect(headingSwap.hunks.map((h) => [h.block, h.kind])).toEqual([
      [true, "replace"],
    ]);
    // The whole-paragraph swap carries both full paragraphs: the compared
    // heading on the right, the adopted paragraph on the left.
    expect(headingSwap.hunks[0].left).toEqual({ para: 0, from: 0, to: 3 });
    expect(headingSwap.hunks[0].right).toEqual({ para: 0, from: 0, to: 3 });
  });
});

describe("— the sentence splitter never self-replaces", () => {
  it("split-sensitive prose degrades to word grain, and a punctuation-only difference still gets an honest, minimal mark", () => {
    const merged = buildMergedDoc(
      parse("Mr. Smith left."),
      parse("Mr Smith left."),
      "sentence",
    );
    // "Mr." ends a sentence on the left only, but word tokens carry no
    // punctuation, so both sides hold the same word multiset and
    // `regroupOnly` degrades the pair to word grain with no sentence-count
    // check. At word grain every token keeps, so the pair
    // degrades again to character grain: the mark is the one
    // character that differs, the deleted period, not the whole paragraph.
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(false);
    expect(merged.hunks[0].kind).toBe("delete");
    const deleted = paragraphText(docOf("Mr. Smith left.")[0]).slice(
      merged.hunks[0].left.from,
      merged.hunks[0].left.to,
    );
    expect(deleted).toBe(".");
    // No hunk strikes and greens the same text.
    for (const h of merged.hunks) {
      if (h.right.para === -1 || h.left.para === -1) continue;
      const del = paragraphText(docOf("Mr. Smith left.")[h.left.para]).slice(
        h.left.from,
        h.left.to,
      );
      const inserted = paragraphText(
        docOf("Mr Smith left.")[h.right.para],
      ).slice(h.right.from, h.right.to);
      expect(del).not.toBe(inserted);
    }
  });

  it("a paragraph with equal sentence counts pairs sentences monotonically", () => {
    const merged = buildMergedDoc(
      parse("She hesitated… then spoke."),
      parse("She hesitated. Then spoke."),
      "sentence",
    );
    // One replace hunk over the changed sentence pair, with the same offsets
    // on both sides: the pairing is monotone and never crosses into an
    // unrelated sentence.
    expect(merged.hunks.map((h) => [h.block, h.kind])).toEqual([
      [false, "replace"],
    ]);
    expect(merged.hunks[0].left).toEqual(merged.hunks[0].right);
    expect(merged.hunks[0].right.para).toBe(0);
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("an equal-count boundary shift degrades to word grain, never marks every word twice", () => {
    // "A B. C D." against "A B C. D.": two sentences on each side, the period
    // moved and the sentences regrouped. A regrouped pair degrades to word
    // grain, where the moved period is a small mark or none, never every
    // word struck and greened at once.
    const merged = buildMergedDoc(
      parse("A B. C D."),
      parse("A B C. D."),
      "sentence",
    );
    // No word is both struck and green.
    const struck = merged.decorations.filter((d) => d.kind === "deleted");
    const green = merged.decorations.filter((d) => d.kind === "inserted");
    for (const d of struck) {
      const text = paragraphText(merged.doc[d.para]).slice(d.from, d.to);
      for (const g of green) {
        const gtext = paragraphText(merged.doc[g.para]).slice(g.from, g.to);
        for (const w of splitWords(text).map((t) => t.text)) {
          expect(gtext.split(/\s+/)).not.toContain(w);
        }
      }
    }
    expect(validateDoc(merged.doc)).toEqual([]);
  });
});

describe("— paragraph grain never welds a marginal pair", () => {
  it("a marginal overlap stays delete+insert blocks, never one whole-paragraph replace", () => {
    const merged = buildMergedDoc(
      parse("The dog barked loudly"),
      parse("The dog barked all night long"),
      "paragraph",
    );
    expect(merged.hunks.map((h) => [h.block, h.kind])).toEqual([
      [true, "insert"],
      [true, "delete"],
    ]);
  });
});

// ── Formatting-only changes ──────────────────────────────────────────────────
// A step that changes only a paragraph's block face (heading level,
// alignment) is a change, never an equal pair, at every grain. The token
// merge sees no words differ, so an equal pair would render the new face
// unmarked and the step would vanish from the rail walk and the snapshot
// compare. The block face is part of the block identity,
// and a text-identical, format-different pair merges as one whole-paragraph
// replace. A moved pagebreak stays a delete and an insert at word grain.

describe("— the word grain surfaces formatting-only changes", () => {
  it("a heading↔paragraph swap is a change, never an equal pair", () => {
    const pairs = alignBlocks(parse("One\n\ntext"), parse("# One\n\ntext"));
    expect(pairs.map((p) => [p.left, p.right, p.equal])).toEqual([
      [0, 0, false],
      [1, 1, true],
    ]);
  });

  it("an alignment-only change is a change, never an equal pair", () => {
    const pairs = alignBlocks(
      parse("One\n\ntext"),
      parse("{align:center}One\n\ntext"),
    );
    expect(pairs.map((p) => [p.left, p.right, p.equal])).toEqual([
      [0, 0, false],
      [1, 1, true],
    ]);
  });

  it("a formatting-only swap in the middle of a document surfaces as one whole-paragraph replace", () => {
    // Between untouched spans, the LCS and similarity passes pair the
    // paragraph (identical words) and mark it non-equal, never folding it
    // into the unchanged islands.
    const merged = buildMergedDoc(
      parse("one\n\nplain words\n\nthree"),
      parse("one\n\n## plain words\n\nthree"),
    );
    expect(merged.hunks.map((h) => [h.block, h.kind])).toEqual([
      [true, "replace"],
    ]);
    expect(merged.hunks[0].left).toEqual({ para: 1, from: 0, to: 11 });
    expect(merged.hunks[0].right).toEqual({ para: 1, from: 0, to: 11 });
    expect(merged.decorations).toEqual([
      { para: 1, from: 0, to: 11, kind: "inserted" },
    ]);
    expect(validateDoc(merged.doc)).toEqual([]);
  });

  it("an alignment-only change surfaces as a whole-paragraph replace", () => {
    const merged = buildMergedDoc(
      parse("One\n\ntext"),
      parse("{align:center}One\n\ntext"),
    );
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0]).toMatchObject({ kind: "replace", block: true });
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 0, to: 3 });
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 0, to: 3 });
  });

  it("a moved pagebreak stays delete+insert at word grain — never a silent equal pair", () => {
    const merged = buildMergedDoc(
      parse("one\n\n{pagebreak}\n\nthree"),
      parse("one\n\nthree\n\n{pagebreak}"),
    );
    expect(merged.hunks.map((h) => [h.block, h.kind])).toEqual([
      [true, "delete"],
      [true, "insert"],
    ]);
    expect(merged.hunks[0].left.para).toBe(1);
    expect(merged.hunks[1].right.para).toBe(2);
  });
});

// ── Grain shaping ────────────────────────────────────────────────────────────

describe("the sentence grain", () => {
  it("a change inside a sentence marks the whole sentence as one hunk", () => {
    const merged = buildMergedDoc(
      parse("She walked slowly to the door. Then she knocked."),
      parse("She crept quietly to the door. Then she knocked."),
      "sentence",
    );
    // The first sentence changed as a unit; the second is untouched.
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].kind).toBe("replace");
    expect(merged.hunks[0].block).toBe(false);
    // The hunk's compared span is the first sentence and never takes in the
    // kept second one.
    expect(merged.hunks[0].right.from).toBe(0);
    expect(merged.hunks[0].right.to).toBeLessThan(40);
  });

  it("two changes inside one sentence are one hunk", () => {
    const merged = buildMergedDoc(
      parse("She walked slowly to the door. Then she knocked."),
      parse("She crept quietly to the window. Then she knocked."),
      "sentence",
    );
    expect(merged.hunks).toHaveLength(1);
  });

  it("word grain stays the native resolution — a word change marks the word, not the sentence", () => {
    const merged = buildMergedDoc(
      parse("She walked slowly to the door. Then she knocked."),
      parse("She walked quickly to the door. Then she knocked."),
      "word",
    );
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].right.from).toBeGreaterThan(5);
    expect(merged.hunks[0].right.to).toBeLessThan(40);
  });
});

describe("the paragraph grain", () => {
  it("a one-word change in a long paragraph is one whole-paragraph replace", () => {
    const merged = buildMergedDoc(
      parse("The quick brown fox jumps over the lazy dog"),
      parse("The quick brown fox jumps over the lazy cat"),
      "paragraph",
    );
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0]).toMatchObject({ kind: "replace", block: true });
    // The whole left paragraph is the swap unit, both ranges whole.
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 0, to: 43 });
    expect(merged.hunks[0].right.para).toBe(0);
    expect(merged.hunks[0].right.from).toBe(0);
    // The merged slot shows the compared voice, washed as a full insertion.
    expect(merged.doc).toHaveLength(1);
    expect(merged.decorations).toEqual([
      { para: 0, from: 0, to: 43, kind: "inserted" },
    ]);
    expect(validateDoc(merged.doc)).toEqual([]);
  });
});

// ── The splitter's shape contract ────────────────────────────────────────────
// The sentence splitter's properties over a prose corpus. Downstream depends
// on two: the walk is monotone (a token never crosses an earlier one, so the
// merge's pair walk stays in bounds), and tokens plus the whitespace gaps
// between them rebuild the text exactly (a dropped character would be a lost
// run).

describe("splitSentences — the shape contract", () => {
  const corpus = [
    "She hesitated… then spoke.",
    "Wait—what did you say? No, really!",
    "Mr. Smith left. E.g. the dog ran.",
    "One. Two! Three? Four… Five",
    "Hello",
    "",
    "  leading spaces and trailing spaces  ",
    'She said, "Go!" and he went. (Really?)',
    "a?!b...c…d",
    "No period at all",
  ];

  it("tokens are non-empty and in-bounds", () => {
    for (const text of corpus) {
      const tokens = splitSentences(text);
      for (const t of tokens) {
        expect(t.text.length).toBeGreaterThan(0);
        expect(t.start).toBeGreaterThanOrEqual(0);
        expect(t.end).toBeLessThanOrEqual(text.length);
        expect(t.end).toBeGreaterThan(t.start);
      }
    }
  });

  it("the walk is monotone — a token never crosses an earlier one", () => {
    for (const text of corpus) {
      const tokens = splitSentences(text);
      for (let i = 1; i < tokens.length; i++) {
        expect(tokens[i].start).toBeGreaterThanOrEqual(tokens[i - 1].end);
      }
    }
  });

  it("tokens plus the whitespace gaps between them rebuild the text exactly", () => {
    for (const text of corpus) {
      const tokens = splitSentences(text);
      let rebuilt = "";
      let pos = 0;
      for (const t of tokens) {
        rebuilt += text.slice(pos, t.start);
        rebuilt += t.text;
        pos = t.end;
      }
      rebuilt += text.slice(pos);
      expect(rebuilt).toBe(text);
    }
  });

  it("a token is content plus its terminal marks, never bare punctuation", () => {
    for (const text of corpus) {
      for (const t of splitSentences(text)) {
        expect(t.text.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ── Merge and alignment defects ──────────────────────────────────────────────

describe("audit findings", () => {
  it("— the merged doc drops trailing text after the last word token", () => {
    // `splitWords` never tokenizes punctuation, so the final period sits
    // after the last word token; `mergeParagraph` appends the target's tail
    // after its op walk.
    const merged = buildMergedDoc(parse("The cat sat."), parse("The dog sat."));
    // Only the trailing punctuation is pinned, not the word order the
    // delete and insert tie-break produces.
    expect(paragraphText(merged.doc[0]).endsWith(".")).toBe(true);
  });

  // The base-side mirror of the trailing-text drop above: when the left's
  // last word is deleted and the right has no tail, the left's period goes
  // with the deleted word, marked as deleted.
  it("— the merged doc keeps a left-only tail", () => {
    const merged = buildMergedDoc(parse("Hello world."), parse("Hello there"));
    const text = paragraphText(merged.doc[0]);
    expect(text).toBe("Hello there world.");
    const struck = merged.decorations
      .filter((d) => d.kind === "deleted")
      .map((d) => text.slice(d.from, d.to));
    expect(struck).toEqual([" world."]);
  });

  it("— a tail both sides share appears once, kept", () => {
    const merged = buildMergedDoc(parse("Hello world."), parse("Hello there."));
    expect(paragraphText(merged.doc[0])).toBe("Hello there world.");
  });

  it("— a punctuation-only difference produces zero hunks", () => {
    // "Hello, world." and "Hello world!" tokenize identically under
    // `splitWords`, but `alignBlocks` has decided the paragraphs differ, so
    // the merge produces a hunk. Zero hunks would show the writer no mark and
    // no Accept for a real change.
    const merged = buildMergedDoc(
      parse("Hello, world."),
      parse("Hello world!"),
    );
    expect(merged.hunks.length).toBeGreaterThan(0);
  });

  it("— an oversized paragraph pair degrades to a whole-paragraph replace instead of running the full token diff", () => {
    // `lcsTable` allocates `(n+1)*(m+1)` cells, which is slow at tens of
    // thousands of tokens a side and can exceed what a typed array holds.
    // `MAX_DIFF_TOKENS` in `merge.ts` keeps a pair this large from reaching
    // `lcsTable`. The guard is pinned by its observable effect, a fast
    // whole-paragraph replace, because a direct `lcsTable` call at a size
    // that risks the crash is too slow for a unit test.
    const n = 6000; // exceeds MAX_DIFF_TOKENS (5000)
    const words = Array.from({ length: n }, (_, i) => `word${i}`);
    const leftWords = [...words];
    const rightWords = [...words];
    // 5999 of 6000 words shared, so the paragraphs pair as an edited pair at
    // block alignment. Disjoint vocabularies would show as a whole-block
    // delete and insert that never reach `mergeParagraph`, and the test
    // would pass for the wrong reason.
    rightWords[0] = "changed";
    const merged = buildMergedDoc(
      parse(leftWords.join(" ")),
      parse(rightWords.join(" ")),
    );
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("replace");
  });

  it("— two paragraphs each individually under the per-side cap still degrade if their PRODUCT is too large", () => {
    // A per-side cap alone admits two paragraphs just under
    // `MAX_DIFF_TOKENS` whose product is a 25,000,000-cell `lcsTable`, re-run
    // on every grain switch and every rail wheel notch. `exceedsDiffBudget`
    // also caps the product at `MAX_DIFF_CELLS`. This fixture is under the
    // per-side cap and over the cell cap.
    const n = 4000; // under MAX_DIFF_TOKENS (5000) on its own
    const words = Array.from({ length: n }, (_, i) => `word${i}`);
    const leftWords = [...words];
    const rightWords = [...words];
    rightWords[0] = "changed";
    const merged = buildMergedDoc(
      parse(leftWords.join(" ")),
      parse(rightWords.join(" ")),
    );
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("replace");
  });

  it("— two different punctuation-only paragraphs pair and collapse into a blank line", () => {
    // Two word-free paragraphs ("..." and "!!!") never count as identical by
    // word overlap. Paired, `mergeParagraph` would get zero tokens on both
    // sides and the merged view would show one blank line for two different
    // paragraphs.
    const merged = buildMergedDoc(parse("..."), parse("!!!"));
    expect(paragraphText(merged.doc[0]).trim().length).toBeGreaterThan(0);
  });

  it("— a combining mark is excluded from the word-character definition", () => {
    // `WORD_CHARS` includes `\p{M}`, so a decomposed (NFD) accented letter
    // keeps its combining mark inside the word. Without it, NFC and NFD
    // spellings of one word diff as an invisible change, and a decoration
    // boundary can split a grapheme cluster.
    const decomposed = "café"; // NFD "café": e + combining acute accent
    const tokens = splitWords(decomposed);
    expect(tokens[0]?.text).toBe(decomposed);
  });

  it("— a word split across a format boundary loses its formatting in the merged view", () => {
    // "unbelievable" is one word token across two runs ("un" plain,
    // "believable" bold). The merged view keeps each run's format inside the
    // token; formatting from the token's start offset alone would drop the
    // bold half from the review surface. Accept re-slices the source runs, so
    // the defect is display-only.
    //
    // The paragraphs differ in text ("news" to "update"): `paragraphKey`
    // ignores inline format, so an identical-text pair is equal at block
    // alignment and never reaches the token merge. "unbelievable" lands as a
    // `keep` token whose formatting differs in the target.
    const adopted = parse("unbelievable news");
    const compared = parse("un**believable** update");
    const merged = buildMergedDoc(adopted, compared);
    const boldRun = merged.doc[0].runs.find((r) => r.format.bold);
    expect(boldRun?.text ?? "").toContain("believable");
  });

  it("— an unrelated insertion desyncs an unmoved page break, producing a spurious hunk", () => {
    // `paragraphKey` keys an empty block by its ordinal among the empty
    // blocks of its document, so a moved break diffs as a change. An absolute
    // paragraph index would shift when an ordinary paragraph is inserted
    // before an unmoved break, and since similarity pairing excludes
    // empty-text blocks, that break would produce a spurious hunk.
    const before = "one\n\n{pagebreak}\n\ntwo";
    const after = "one\n\ninserted\n\n{pagebreak}\n\ntwo";
    const merged = buildMergedDoc(parse(before), parse(after));
    const spuriousBreakDeletes = merged.hunks.filter(
      (h) => h.block && h.kind === "delete",
    );
    expect(spuriousBreakDeletes.length).toBe(0);
  });

  it("— a reference-identical pair (the rail's walk at Now) short-circuits to a trivial 1:1 alignment", () => {
    // At depth 0 the rail's walk hands back the same array as `historyTip`,
    // and `pairBlocks` returns at once instead of re-running the three-pass
    // alignment on every wheel notch. The fixture passes the same `doc`
    // reference, and the result is cross-checked against the general path on
    // an equal-content copy, so the shortcut cannot diverge from it.
    const doc = docOf("one\n\ntwo\n\nthree");
    const viaShortcut = alignBlocks(doc, doc);
    const viaGeneralPath = alignBlocks(doc, [...doc]);
    expect(viaShortcut).toEqual(viaGeneralPath);
    expect(viaShortcut).toEqual([
      { left: 0, right: 0, equal: true },
      { left: 1, right: 1, equal: true },
      { left: 2, right: 2, equal: true },
    ]);
  });

  it("— the similarity pass still pairs correctly with pre-tokenized word sets and a reverse-lookup emit", () => {
    // The similarity pass tokenizes each paragraph once (`wordSetOf`) and
    // emits through a reverse `byTarget` map. A grid of unrelated pairs
    // beside genuine edits exercises the greedy best-first consumption
    // across several candidates, where wrong bookkeeping would pair the
    // wrong blocks.
    const before = [
      "The quick brown fox jumps",
      "Alpha beta gamma delta",
      "Completely unrelated wording here",
      "One two three four five",
    ].join("\n\n");
    const after = [
      "The quick brown fox leaps", // one word changed — should pair with #1
      "Something else entirely different",
      "Alpha beta gamma epsilon", // one word changed — should pair with #2
      "One two three four six", // one word changed — should pair with #4
    ].join("\n\n");
    const pairs = alignBlocks(docOf(before), docOf(after));
    const byLeft = new Map(pairs.map((p) => [p.left, p]));
    expect(byLeft.get(0)).toMatchObject({ right: 0, equal: false });
    expect(byLeft.get(1)).toMatchObject({ right: 2, equal: false });
    expect(byLeft.get(3)).toMatchObject({ right: 3, equal: false });
    // "Completely unrelated wording here" shares no words with anything on
    // the right, so it is never forced into a pairing.
    expect(pairs.some((p) => p.left === 2 && p.right !== -1)).toBe(false);
  });
});

describe("— a one-sided EMPTY block still emits a real hunk", () => {
  it("an inserted blank paragraph gets a real block hunk, not a silent equal pair", () => {
    // `walkBlockPairs` pushes a one-sided empty block with a real `insert`
    // or `delete` hunk; only its decoration needs text. `applyDiffMarks`
    // marks such a hunk at paragraph level (pinned in `highlights.test.ts`),
    // so the hunk itself must exist and carry its kind, or an inserted or
    // deleted blank line renders unmarked.
    const merged = buildMergedDoc(parse("one\n\ntwo"), parse("one\n\n\n\ntwo"));
    expect(plain(merged.doc)).toEqual(["one", "", "two"]);
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("insert");
    expect(merged.hunks[0].para).toBe(1);
    // The empty merged span is the signature `applyDiffMarks` keys its
    // paragraph-level path on, since there is no range to wrap.
    expect(merged.hunks[0].merged).toEqual({ from: 0, to: 0 });
  });

  it("a deleted blank paragraph gets a real block hunk too", () => {
    const merged = buildMergedDoc(parse("one\n\n\n\ntwo"), parse("one\n\ntwo"));
    expect(plain(merged.doc)).toEqual(["one", "", "two"]);
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("delete");
    expect(merged.hunks[0].merged).toEqual({ from: 0, to: 0 });
  });
});

describe("— a punctuation-only difference marks the minimal change, not the whole paragraph", () => {
  // When the token diff is all `keep`, word and sentence grain degrade to
  // character grain and mark only the characters that differ. A fallback to
  // `wholeParagraphReplace` would wash the whole paragraph at every grain,
  // so a small change would highlight the paragraph and the three lenses
  // would look identical.
  const base = "Hello, world. Bye.";
  const target = "Hello world! Bye.";

  it("word grain marks only the changed punctuation, never the untouched second sentence", () => {
    const merged = buildMergedDoc(parse(base), parse(target), "word");
    // Small hunks (the deleted comma, the "." to "!" swap), never one hunk
    // spanning the whole paragraph.
    expect(merged.hunks.length).toBeGreaterThan(0);
    for (const h of merged.hunks) {
      expect(h.block).toBe(false);
      expect(h.merged.to - h.merged.from).toBeLessThanOrEqual(2);
    }
    // "Bye." never appears in a decoration; the untouched sentence stays
    // plain.
    const text = paragraphText(merged.doc[0]);
    for (const d of merged.decorations) {
      expect(text.slice(d.from, d.to)).not.toContain("Bye");
    }
  });

  it("sentence grain marks the same minimal change (via its own degrade to word, then character, grain)", () => {
    const merged = buildMergedDoc(parse(base), parse(target), "sentence");
    for (const h of merged.hunks) {
      expect(h.block).toBe(false);
      expect(h.merged.to - h.merged.from).toBeLessThanOrEqual(2);
    }
  });

  it("paragraph grain still washes the whole paragraph — and now visibly DIFFERS from the other two lenses", () => {
    // Paragraph grain is the coarse lens and the only one that
    // washes the whole paragraph for a punctuation-only change, so the three
    // lenses stay distinguishable for the most common edit.
    const merged = buildMergedDoc(parse(base), parse(target), "paragraph");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("replace");
  });

  it("a plain deleted comma still marks only the comma, not the whole sentence", () => {
    const merged = buildMergedDoc(
      parse("Mr. Smith left."),
      parse("Mr Smith left."),
    );
    expect(merged.hunks).toHaveLength(1);
    const deleted = paragraphText(parse("Mr. Smith left.")[0]).slice(
      merged.hunks[0].left.from,
      merged.hunks[0].left.to,
    );
    expect(deleted).toBe(".");
  });
});

describe("— sentence grain survives an added or removed sentence", () => {
  it("adding a sentence keeps the OTHER sentences at sentence grain, never degrading the whole pair to word grain", () => {
    // A sentence-count mismatch does not degrade the pair, because adding or
    // removing a sentence is the most ordinary sentence-level edit.
    // `regroupOnly` alone decides: the added sentence has no deleted sentence
    // to regroup with, so it stays a sentence-level insert and the untouched
    // sentences are never re-diffed at word grain.
    const merged = buildMergedDoc(
      parse("The cat sat. The dog ran."),
      parse("The cat sat. A new sentence. The dog ran."),
      "sentence",
    );
    // One insert hunk that never touches the sentences on either side.
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].kind).toBe("insert");
    const text = paragraphText(merged.doc[0]);
    expect(text).toContain("The cat sat.");
    expect(text).toContain("A new sentence.");
    expect(text).toContain("The dog ran.");
    // A clean insertion produces the same hunk at either grain; the
    // decoration count tells them apart. Sentence grain marks the added
    // sentence as one decoration, while word grain gives one per word even
    // though `groupHunks` folds them into one hunk.
    expect(merged.decorations).toHaveLength(1);
  });

  it("removing a sentence stays at sentence grain too", () => {
    const merged = buildMergedDoc(
      parse("The cat sat. A doomed sentence. The dog ran."),
      parse("The cat sat. The dog ran."),
      "sentence",
    );
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].kind).toBe("delete");
    expect(merged.decorations).toHaveLength(1);
  });

  it("own fixture still degrades — regroupOnly alone is enough, with no raw count check", () => {
    // "Mr." splits where "Mr" does not, giving sentence lists of different
    // lengths; `regroupOnly` catches the pair without a count check, because
    // the word multisets are equal.
    const merged = buildMergedDoc(
      parse("Mr. Smith left."),
      parse("Mr Smith left."),
      "sentence",
    );
    // Degrades to the minimal character-level mark, never a
    // sentence-level double mark.
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(false);
  });
});

describe("— word-free text pairs with itself across a block-face change", () => {
  it("the same punctuation-only text pairs across a heading swap, instead of showing as delete+insert", () => {
    // Word-free text gets a pseudo-token, its own trimmed content, so
    // identical word-free text pairs with itself across a block-face change
    // while two different word-free paragraphs stay apart.
    const merged = buildMergedDoc(parse("..."), parse("# ..."), "word");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("replace");
  });

  it("still keeps two DIFFERENT word-free paragraphs apart", () => {
    const merged = buildMergedDoc(parse("..."), parse("!!!"), "word");
    // Two different paragraphs stay a delete and an insert, never one pair
    // shown as a blank line.
    expect(merged.hunks.map((h) => h.kind).sort()).toEqual([
      "delete",
      "insert",
    ]);
  });
});
