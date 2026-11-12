// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { applyHunk, buildMergedDoc, sameHunk, type Hunk } from "./index";
import type { DiffAim } from "./merge";
import { commonmarkCodec } from "../../adapters/commonmark";
import { validateDoc } from "../../domain/invariants";
import type { Cursor, Doc } from "../../domain/model";

// Pins the two pure contracts of the accept seam, including the aim.
//
// `buildMergedDoc(leftSide, rightSide)` emits hunks beside its decorations:
// one maximal run of touching changed spans per paragraph, of any kind, so a
// replacement is one hunk, one Accept and one undo step. Block paths emit
// whole paragraphs. Each hunk carries separator-aware ranges in each side's
// own text, and an empty range holds the restore point where its side's text
// would land: a pure deletion's right range is zero-length at the end of the
// kept word before it, and a left-only block's right range is zero-length at
// the right side's paragraph count.
//
// `applyHunk(leftSide, rightSide, hunk, aim)` rewrites the aimed side with one
// hunk's change. At aim "left" it applies replacements, deletions and
// insertions as units; at aim "right" (D2) a left-only passage is restored
// into the right side and a right-only passage is removed from it. It never
// assumes original positions survive an earlier accept, and in both aims it
// refuses a stale hunk rather than clamping it.
//
// Every output is validated and codec round-tripped, so an accept produces
// the same class of document the engine's own operations produce.

const codec = commonmarkCodec;
const parse = (md: string): Doc => codec.parse(md);
const serialize = (d: Doc): string => codec.serialize(d);

/** `applyHunk` that throws on a refusal: a fresh hunk from the current recalc
 * always applies, so a null is an emission defect. */
function accept(
  leftSide: Doc,
  rightSide: Doc,
  hunk: Hunk,
  aim: DiffAim = "left",
): { doc: Doc; cursor: Cursor } {
  const r = applyHunk(leftSide, rightSide, hunk, aim);
  if (!r) throw new Error("a fresh hunk was refused");
  return r;
}

/** Accepts the current first hunk until the diff empties, at word grain.
 * Accepting everything aimed at the left yields the right document, and
 * every accept uses the current recalc's hunks, never a cached position. */
function acceptAll(adoptedMd: string, comparedMd: string): string {
  return acceptAllAt(adoptedMd, comparedMd, "word");
}

/** `acceptAll` at a grain: whole-paragraph and whole-sentence hunks compose to
 * the compared document like any other accept order. */
function acceptAllAt(
  adoptedMd: string,
  comparedMd: string,
  grain: "word" | "sentence" | "paragraph",
): string {
  let doc = parse(adoptedMd);
  const compared = parse(comparedMd);
  for (let guard = 0; guard < 50; guard++) {
    const m = buildMergedDoc(doc, compared, grain);
    if (m.hunks.length === 0) return serialize(doc);
    doc = accept(doc, compared, m.hunks[0]).doc;
  }
  throw new Error("the accept loop did not converge");
}

/** The D2 loop at word grain: the merged doc is (snapshot, adopted) and every
 * hunk is aimed at the right. Left-only passages restore into the adopted,
 * right-only ones leave it, and the adopted converges to the snapshot. */
function acceptAllD2(snapshotMd: string, adoptedMd: string): string {
  return acceptAllD2At(snapshotMd, adoptedMd, "word");
}

/** The D2 convergence helper at a grain. */
function acceptAllD2At(
  snapshotMd: string,
  adoptedMd: string,
  grain: "word" | "sentence" | "paragraph",
): string {
  let adopted = parse(adoptedMd);
  const snapshot = parse(snapshotMd);
  for (let guard = 0; guard < 50; guard++) {
    const m = buildMergedDoc(snapshot, adopted, grain);
    if (m.hunks.length === 0) return serialize(adopted);
    adopted = accept(snapshot, adopted, m.hunks[0], "right").doc;
  }
  throw new Error("the D2 accept loop did not converge");
}

const checkValid = (d: Doc) => {
  expect(validateDoc(d)).toEqual([]);
  expect(codec.parse(serialize(d))).toEqual(d);
};

function pair(adoptedMd: string, comparedMd: string) {
  const left = parse(adoptedMd);
  const right = parse(comparedMd);
  return { left, right, merged: buildMergedDoc(left, right) };
}

// ── Hunk emission ────────────────────────────────────────────────────────────

describe("buildMergedDoc hunks", () => {
  it("groups an adjacent deleted+inserted pair into ONE replacement hunk", () => {
    // "quick" to "fast" is one Accept and one undo step, so it is one hunk
    // with separator-aware spans.
    const { merged } = pair("The quick brown fox", "The fast brown fox");
    expect(merged.hunks).toHaveLength(1);
    const h = merged.hunks[0];
    expect(h.kind).toBe("replace");
    expect(h.block).toBe(false);
    // Left " quick": from the end of the kept "The" to the start of the kept
    // "brown", separators included.
    expect(h.left).toEqual({ para: 0, from: 3, to: 10 });
    // Right " fast ": the right text with its own separators.
    expect(h.right).toEqual({ para: 0, from: 3, to: 9 });
    // The merged span the wash paints: inserted [3,8) + deleted [8,14).
    expect(h.merged).toEqual({ from: 3, to: 14 });
    checkValid(merged.doc);
  });

  it("emits a deletion as one hunk with an empty right span at the restore point", () => {
    const { merged } = pair("The quick brown fox jumps", "The quick brown fox");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].kind).toBe("delete");
    // " jumps": from the end of the kept "fox" to the paragraph end.
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 19, to: 25 });
    // The right span is empty but carries the restore point, where the
    // deleted text belongs in the right side: after the kept "fox". The D1
    // accept never reads it; the D2 accept inserts there.
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 19, to: 19 });
  });

  it("emits an insertion as one hunk whose left range is the separator it replaces", () => {
    const { merged } = pair("The quick brown fox", "The quick very brown fox");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].kind).toBe("insert");
    // The left " " between quick and brown is deleted; the right " very "
    // takes its place.
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 9, to: 10 });
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 9, to: 15 });
  });

  it("emits an insertion at the paragraph head with a zero-length left range", () => {
    const { merged } = pair("cat sat", "black cat sat");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].kind).toBe("insert");
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 0, to: 0 });
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 0, to: 6 });
  });

  it("keeps non-adjacent changes as separate hunks", () => {
    const { merged } = pair("a b c d e", "a x c y");
    expect(merged.hunks.map((h) => h.kind)).toEqual(["replace", "replace"]);
    // The second hunk's right range carries its own leading separator.
    expect(merged.hunks[1].right).toEqual({ para: 0, from: 5, to: 7 });
  });

  it("groups an interleaved insert-delete-insert script into one replace hunk", () => {
    // The LCS keeps only "the", and the rest of the script interleaves
    // inserts and deletes in one touching run.
    const { merged } = pair("the old house", "the new hut");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].kind).toBe("replace");
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 3, to: 13 });
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 3, to: 11 });
  });

  it("treats paragraphs with no word overlap as block changes, not inline replacements", () => {
    // "a b" and "x y" share no words, so the block aligner pairs nothing and
    // the change is a whole-paragraph delete plus a whole-paragraph insert.
    const { merged } = pair("a b", "x y");
    expect(merged.hunks.map((h) => [h.block, h.kind])).toEqual([
      [true, "insert"],
      [true, "delete"],
    ]);
  });

  it("emits a whole left-only paragraph as a block delete hunk with the restore landing", () => {
    const { merged } = pair("one\n\nbetween\n\nthree", "one\n\nthree");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("delete");
    expect(merged.hunks[0].left.para).toBe(1);
    // The empty right range names the restore landing in the right doc, the
    // count of right paragraphs emitted before this pair: "between" belongs
    // between "one" (index 0) and "three" (index 1).
    expect(merged.hunks[0].right).toEqual({ para: 1, from: 0, to: 0 });
  });

  it("emits a whole right-only paragraph as a block insert hunk", () => {
    const { merged } = pair("one\n\nthree", "one\n\nnew\n\nthree");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    expect(merged.hunks[0].kind).toBe("insert");
    // The landing index: after the one left paragraph that precedes it.
    expect(merged.hunks[0].left.para).toBe(1);
    expect(merged.hunks[0].right.para).toBe(1);
  });

  it("emits a page-break paragraph insertion as a block hunk of its own", () => {
    // A block-level difference with no text is still adoptable.
    // The break paragraph has no text decoration, but it has a block hunk,
    // and so does the "two" paragraph after it.
    const { merged } = pair("one", "one\n\n{pagebreak}\n\ntwo");
    expect(
      merged.decorations.filter((d) => d.kind === "inserted"),
    ).toHaveLength(1);
    const blockInserts = merged.hunks.filter(
      (h) => h.block && h.kind === "insert",
    );
    expect(blockInserts).toHaveLength(2);
    expect(blockInserts[0].right.para).toBe(1); // the break paragraph
    checkValid(merged.doc);
  });

  it("emits no hunks for identical documents", () => {
    const { merged } = pair("the same\n\ntext", "the same\n\ntext");
    expect(merged.hunks).toHaveLength(0);
  });
});

// ── Worked accept examples ───────────────────────────────────────────────────

describe("applyHunk — the spec's examples", () => {
  it("replacement: accepting the hunk swaps the word in one step", () => {
    const { left, right, merged } = pair(
      "The quick brown fox",
      "The fast brown fox",
    );
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("The fast brown fox");
    checkValid(r.doc);
  });

  it("deletion: accepting the hunk removes the left-only word", () => {
    const { left, right, merged } = pair(
      "The quick brown fox jumps",
      "The quick brown fox",
    );
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("The quick brown fox");
    checkValid(r.doc);
  });

  it("insertion: accepting the hunk splices the right word in", () => {
    const { left, right, merged } = pair(
      "The quick brown fox",
      "The quick very brown fox",
    );
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("The quick very brown fox");
    checkValid(r.doc);
  });

  it("a replacement whose deleted word is the left first word maps right", () => {
    // The synthetic-space separator: "The" leaves the doc exactly, and
    // "black " arrives without eating or duplicating a space.
    const { left, right, merged } = pair("The cat sat", "black cat sat");
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("black cat sat");
    checkValid(r.doc);
  });

  it("adjacent deleted words share one separator and both go", () => {
    const { left, right, merged } = pair("the quick brown fox", "brown fox");
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("brown fox");
    checkValid(r.doc);
  });

  it("a deletion between kept words keeps exactly one separator", () => {
    // The deleted " old" never eats the space that keeps "the" and "house"
    // apart.
    const { left, right, merged } = pair(
      "the old house stood empty",
      "the house stood empty",
    );
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 3, to: 7 });
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("the house stood empty");
    checkValid(r.doc);
  });

  it("an accepted replacement wears the right paragraph's format", () => {
    const { left, right, merged } = pair(
      "The quick brown",
      "The **fast** brown",
    );
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("The **fast** brown");
    expect(
      r.doc[0].runs.some((run) => run.format.bold && run.text.includes("fast")),
    ).toBe(true);
    checkValid(r.doc);
  });

  it("accepted surrounding kept text keeps its own format", () => {
    const { left, right, merged } = pair(
      "**The** quick brown",
      "**The** fast brown",
    );
    const r = accept(left, right, merged.hunks[0]);
    expect(
      r.doc[0].runs.some((run) => run.format.bold && run.text.includes("The")),
    ).toBe(true);
    checkValid(r.doc);
  });
});

// ── Composition, positions and refusal ───────────────────────────────────────

describe("applyHunk composition", () => {
  it("accepting two of five hunks applies exactly those two", () => {
    // Five separate changes; the first two are accepted and the rest stay
    // unapplied.
    let doc = parse("a b c d e f g h i j");
    const compared = parse("x b y d z f w h v j");
    for (let n = 0; n < 2; n++) {
      const m = buildMergedDoc(doc, compared);
      doc = accept(doc, compared, m.hunks[0]).doc;
    }
    const text = serialize(doc);
    expect(text).toContain("x");
    expect(text).toContain("y");
    expect(text).not.toContain("z");
    expect(text).not.toContain("w");
    expect(text).not.toContain("v");
    checkValid(doc);
  });

  it("a whole-paragraph deletion hunk accepts as one block", () => {
    const { left, right, merged } = pair(
      "one\n\nbetween\n\nthree",
      "one\n\nthree",
    );
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("one\n\nthree");
    checkValid(r.doc);
  });

  it("a whole-paragraph insertion hunk accepts as one block", () => {
    const { left, right, merged } = pair("one\n\nthree", "one\n\nnew\n\nthree");
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("one\n\nnew\n\nthree");
    checkValid(r.doc);
  });

  it("a page-break block insertion lands as a real break paragraph", () => {
    const { left, right, merged } = pair("one", "one\n\n{pagebreak}\n\ntwo");
    // The first block insert is the break.
    const r = accept(left, right, merged.hunks[0]);
    expect(r.doc[1].blockType).toBe("pagebreak");
    expect(r.doc[1].runs).toHaveLength(0);
    checkValid(r.doc);
  });

  it("accepting a left-only page break removes it, never a foreign paragraph", () => {
    // A textless block's hunk carries zero-length ranges on both sides. The
    // accept removes the break from the aimed side and never takes the
    // restore branch, which would splice the other side's paragraph at its
    // landing index (one / three / {break} / three).
    const { left, right, merged } = pair(
      "one\n\n{pagebreak}\n\nthree",
      "one\n\nthree",
    );
    expect(merged.hunks[0].kind).toBe("delete");
    expect(merged.hunks[0].left).toEqual({ para: 1, from: 0, to: 0 });
    expect(merged.hunks[0].right).toEqual({ para: 1, from: 0, to: 0 });
    const r = accept(left, right, merged.hunks[0], "left");
    expect(serialize(r.doc)).toBe("one\n\nthree");
    checkValid(r.doc);
  });

  it("an emptied paragraph is removed, never swapped for a foreign one", () => {
    const { left, right, merged } = pair("one\n\n\n\nthree", "one\n\nthree");
    expect(merged.hunks[0].kind).toBe("delete");
    const r = accept(left, right, merged.hunks[0], "left");
    expect(serialize(r.doc)).toBe("one\n\nthree");
    checkValid(r.doc);
  });

  it("a moved page break accepts as delete+insert and converges", () => {
    // The position-locked empty-block rule makes a moved break a delete and
    // an insert; accepting both textless hunks converges to the
    // compared doc with no stray paragraph left behind.
    expect(
      acceptAll("one\n\n{pagebreak}\n\nthree", "one\n\nthree\n\n{pagebreak}"),
    ).toBe("one\n\nthree\n\n{pagebreak}");
  });

  it("accepts hunks in any order and converges to the right document", () => {
    // Whole-paragraph deletes and an insert compose, including the order
    // where the deletes leave the one-paragraph placeholder and the insert
    // takes it.
    expect(acceptAll("x\ny", "z")).toBe("z");
    expect(acceptAll("one\n\nbetween\n\nthree", "one\n\nthree")).toBe(
      "one\n\nthree",
    );
    expect(acceptAll("a b c d e", "a x c y")).toBe("a x c y");
    expect(acceptAll("The quick brown fox", "The fast brown fox")).toBe(
      "The fast brown fox",
    );
  });

  it("never assumes original positions survive an earlier accept", () => {
    // The first accept changes the paragraph length before the second hunk,
    // so only fresh coordinates land it correctly.
    expect(acceptAll("the quick brown fox", "the fast big brown fox")).toBe(
      "the fast big brown fox",
    );
  });

  it("a stale or out-of-range hunk is refused with null — never clamped, in either aim", () => {
    const { left, right } = pair("The quick brown fox", "The fast brown fox");
    const stale = {
      id: 99,
      kind: "replace" as const,
      block: false,
      para: 5, // no such merged paragraph
      merged: { from: 0, to: 10 },
      left: { para: 7, from: 0, to: 5 }, // no such left paragraph
      right: { para: 0, from: 0, to: 5 },
    };
    expect(applyHunk(left, right, stale, "left")).toBeNull();
    expect(applyHunk(left, right, stale, "right")).toBeNull();
    // An out-of-range span inside a real paragraph is refused too.
    const badSpan = {
      id: 0,
      kind: "replace" as const,
      block: false,
      para: 0,
      merged: { from: 0, to: 10 },
      left: { para: 0, from: 0, to: 999 },
      right: { para: 0, from: 0, to: 5 },
    };
    expect(applyHunk(left, right, badSpan, "left")).toBeNull();
    expect(applyHunk(left, right, badSpan, "right")).toBeNull();
    // A restore aimed at the right refuses a target paragraph the right side
    // does not hold.
    const badRestore = {
      id: 0,
      kind: "delete" as const,
      block: false,
      para: 0,
      merged: { from: 0, to: 10 },
      left: { para: 0, from: 3, to: 7 },
      right: { para: 4, from: 3, to: 3 }, // no such right paragraph
    };
    expect(applyHunk(left, right, badRestore, "right")).toBeNull();
  });

  it("sameHunk distinguishes identical coordinates from anything shifted", () => {
    const { merged } = pair("The quick brown fox", "The fast brown fox");
    const h = merged.hunks[0];
    expect(sameHunk(h, { ...h })).toBe(true);
    expect(sameHunk(h, { ...h, left: { para: 0, from: 4, to: 10 } })).toBe(
      false,
    );
    expect(sameHunk(h, { ...h, right: { para: 0, from: 3, to: 8 } })).toBe(
      false,
    );
    expect(sameHunk(h, { ...h, merged: { from: 3, to: 13 } })).toBe(false);
  });
});

// ── The D2 aim ───────────────────────────────────────────────────────────────
//
// `buildMergedDoc(snapshot, adopted)` makes the snapshot the left side and
// the adopted the right side: the chronological reading, where the adopted
// manuscript is the spine, the snapshot's removed passages are struck, and
// the adopted's additions are green. An accept with aim "right" mutates only
// the adopted; the snapshot stays byte-identical in both aims.

describe("the aim — D2 semantics", () => {
  it("the D2 display strikes the left-only text and greens the right-only text", () => {
    // "old" exists only in the snapshot (struck) and "new" only in the
    // adopted (green), the mirror of D1. The tie walk emits the insert before
    // the delete, so the merged text reads "the new old house stood empty".
    const merged = buildMergedDoc(
      parse("the old house stood empty"),
      parse("the new house stood empty"),
    );
    expect(merged.decorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "inserted" },
      { para: 0, from: 7, to: 11, kind: "deleted" },
    ]);
    checkValid(merged.doc);
  });

  it("accepting a D2 delete hunk restores the struck passage into the right side", () => {
    // Accepting the struck "old" restores it at the restore point after the
    // kept word before it, never at the paragraph head.
    const snapshot = parse("the old house stood empty");
    const adopted = parse("the house stood empty");
    const merged = buildMergedDoc(snapshot, adopted);
    expect(merged.hunks[0].kind).toBe("delete");
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 3, to: 3 });
    const r = accept(snapshot, adopted, merged.hunks[0], "right");
    expect(serialize(r.doc)).toBe("the old house stood empty");
    checkValid(r.doc);
  });

  it("accepting a D2 delete hunk at the paragraph head restores at offset 0", () => {
    // The deleted first word carries its trailing separator, so restoring at
    // 0 rebuilds the sentence exactly.
    const snapshot = parse("The cat sat");
    const adopted = parse("cat sat");
    const merged = buildMergedDoc(snapshot, adopted);
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 0, to: 0 });
    const r = accept(snapshot, adopted, merged.hunks[0], "right");
    expect(serialize(r.doc)).toBe("The cat sat");
    checkValid(r.doc);
  });

  it("accepting a D2 insert hunk removes the addition from the right side", () => {
    // Accepting the green "new" deletes it from the adopted.
    const snapshot = parse("the house stood empty");
    const adopted = parse("the new house stood empty");
    const merged = buildMergedDoc(snapshot, adopted);
    expect(merged.hunks[0].kind).toBe("insert");
    const r = accept(snapshot, adopted, merged.hunks[0], "right");
    expect(serialize(r.doc)).toBe("the house stood empty");
    checkValid(r.doc);
  });

  it("accepting a D2 replace hunk swaps the addition back for the snapshot's text", () => {
    const snapshot = parse("the quick brown fox");
    const adopted = parse("the fast brown fox");
    const merged = buildMergedDoc(snapshot, adopted);
    expect(merged.hunks[0].kind).toBe("replace");
    const r = accept(snapshot, adopted, merged.hunks[0], "right");
    expect(serialize(r.doc)).toBe("the quick brown fox");
    checkValid(r.doc);
  });

  it("D2 block ops: a removed paragraph restores, an added paragraph leaves", () => {
    // A whole paragraph removed from the adopted restores.
    const snapshot = parse("one\n\nbetween\n\nthree");
    const adopted = parse("one\n\nthree");
    const restore = buildMergedDoc(snapshot, adopted);
    expect(restore.hunks[0]).toMatchObject({
      block: true,
      kind: "delete",
      right: { para: 1, from: 0, to: 0 },
    });
    const r = accept(snapshot, adopted, restore.hunks[0], "right");
    expect(serialize(r.doc)).toBe("one\n\nbetween\n\nthree");
    checkValid(r.doc);

    // A whole paragraph added to the adopted leaves.
    const snapshot2 = parse("one\n\nthree");
    const adopted2 = parse("one\n\nbetween\n\nthree");
    const remove = buildMergedDoc(snapshot2, adopted2);
    expect(remove.hunks[0]).toMatchObject({ block: true, kind: "insert" });
    const r2 = accept(snapshot2, adopted2, remove.hunks[0], "right");
    expect(serialize(r2.doc)).toBe("one\n\nthree");
    checkValid(r2.doc);
  });

  it("a D2 accept of a left-only page break restores the break into the adopted", () => {
    // Accepting the struck break restores it at the right side's empty
    // landing, never a foreign paragraph.
    const snapshot = parse("one\n\n{pagebreak}\n\nthree");
    const adopted = parse("one\n\nthree");
    const merged = buildMergedDoc(snapshot, adopted);
    expect(merged.hunks[0].kind).toBe("delete");
    const r = accept(snapshot, adopted, merged.hunks[0], "right");
    expect(serialize(r.doc)).toBe("one\n\n{pagebreak}\n\nthree");
    checkValid(r.doc);
  });

  it("a D2 accept of a right-only page break removes it from the adopted", () => {
    const snapshot = parse("one\n\nthree");
    const adopted = parse("one\n\n{pagebreak}\n\nthree");
    const merged = buildMergedDoc(snapshot, adopted);
    expect(merged.hunks[0].kind).toBe("insert");
    const r = accept(snapshot, adopted, merged.hunks[0], "right");
    expect(serialize(r.doc)).toBe("one\n\nthree");
    checkValid(r.doc);
  });

  it("D2 at paragraph grain: one whole-paragraph accept converges both ways", () => {
    // Aimed at the right, the coarse lens swaps the adopted paragraph for the
    // snapshot's.
    expect(acceptAllD2At("Hello", "Hello world", "paragraph")).toBe("Hello");
    expect(acceptAllD2At("Hello world", "Hello", "paragraph")).toBe(
      "Hello world",
    );
  });

  it("D2 accepts converge the adopted to the snapshot, in any composition", () => {
    expect(
      acceptAllD2("the old house stood empty", "the house stood empty"),
    ).toBe("the old house stood empty");
    expect(acceptAllD2("The quick brown fox", "The fast brown fox")).toBe(
      "The quick brown fox",
    );
    expect(acceptAllD2("one\n\nbetween\n\nthree", "one\n\nthree")).toBe(
      "one\n\nbetween\n\nthree",
    );
    expect(acceptAllD2("one\n\nthree", "one\n\nbetween\n\nthree")).toBe(
      "one\n\nthree",
    );
  });

  it("the source doc is byte-identical after every accept, in both aims", () => {
    // Only the aimed side changes. The other side is a read-only
    // source whose runs are only sliced for insertion.
    const snapshot = parse("the old house stood empty");
    const adopted = parse("the new house stood empty");
    const snapshotBefore = serialize(snapshot);
    const adoptedBefore = serialize(adopted);
    // D1 aims at the left (the adopted); the snapshot is untouched.
    const d1 = buildMergedDoc(adopted, snapshot);
    for (const h of d1.hunks) accept(adopted, snapshot, h, "left");
    expect(serialize(snapshot)).toBe(snapshotBefore);
    // D2 aims at the right (the adopted); the snapshot is untouched.
    const d2 = buildMergedDoc(snapshot, adopted);
    for (const h of d2.hunks) accept(snapshot, adopted, h, "right");
    expect(serialize(snapshot)).toBe(snapshotBefore);
    expect(serialize(adopted)).toBe(adoptedBefore);
  });

  it("the two arrangements are mirror images — same regions, swapped kinds", () => {
    // For a pair whose merged texts coincide, the D1 merge strikes the
    // left-only "old" and the D2 merge greens it. The hunks mirror too: D1's
    // delete hunk carries the D2 restore's landing, D2's insert hunk carries
    // D1's landing.
    const a = parse("the old house stood empty");
    const b = parse("the house stood empty");
    const d1 = buildMergedDoc(a, b);
    const d2 = buildMergedDoc(b, a);
    expect(d1.doc).toEqual(d2.doc);
    expect(d1.decorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "deleted" },
    ]);
    expect(d2.decorations).toEqual([
      { para: 0, from: 3, to: 7, kind: "inserted" },
    ]);
    expect(d1.hunks[0]).toMatchObject({
      kind: "delete",
      left: { para: 0, from: 3, to: 7 },
      right: { para: 0, from: 3, to: 3 },
    });
    // The D2 insert's right range carries the trailing separator (" old ",
    // [3,8)), as a D1 replacement's insert does, and its left range is the
    // snapshot's own separator (" ", [3,4)). The D2 accept removes " old "
    // and re-inserts the snapshot's space, so the spacing stays exact.
    expect(d2.hunks[0]).toMatchObject({
      kind: "insert",
      left: { para: 0, from: 3, to: 4 },
      right: { para: 0, from: 3, to: 8 },
    });
  });
});

// ── Accept at each grain ─────────────────────────────────────────────────────

describe("— paragraph-grain block replace", () => {
  it("emits one whole-paragraph replace and applies delete-then-insert at the one-paragraph doc", () => {
    const left = parse("Hello");
    const right = parse("Hello world");
    const merged = buildMergedDoc(left, right, "paragraph");
    expect(merged.hunks).toHaveLength(1);
    const h = merged.hunks[0];
    expect(h.kind).toBe("replace");
    expect(h.block).toBe(true);
    expect(h.left).toEqual({ para: 0, from: 0, to: 5 });
    expect(h.right).toEqual({ para: 0, from: 0, to: 11 });
    const r = applyHunk(left, right, h, "left");
    if (!r) throw new Error("the paragraph-grain hunk was refused");
    expect(serialize(r.doc)).toBe("Hello world");
    expect(r.doc).toHaveLength(1);
    checkValid(r.doc);
  });

  it("a whole-paragraph replace keeps the blank paragraph after it", () => {
    const blank: Doc[number] = {
      runs: [
        { text: "", format: { bold: false, italic: false, monospace: false } },
      ],
      alignment: "left",
      blockType: "paragraph",
    };
    const left: Doc = [parse("Hello")[0], blank, parse("tail")[0]];
    const right: Doc = [parse("Hello world")[0], blank, parse("tail")[0]];
    const merged = buildMergedDoc(left, right, "paragraph");
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0].block).toBe(true);
    const r = accept(left, right, merged.hunks[0]);
    expect(r.doc).toEqual(right);
    checkValid(r.doc);
  });

  it("paragraph grain: accepting every hunk converges to the right document", () => {
    expect(
      acceptAllAt(
        "one\n\nTwo quick foxes\n\nthree",
        "one\n\ntwo quick foxes\n\nthree",
        "paragraph",
      ),
    ).toBe("one\n\ntwo quick foxes\n\nthree");
  });
});

describe("accept at each grain", () => {
  it("sentence grain: accepting one sentence hunk applies exactly that sentence", () => {
    const left = parse("She walked slowly to the door. Then she knocked.");
    const right = parse("She crept quietly to the door. Then she knocked.");
    const merged = buildMergedDoc(left, right, "sentence");
    expect(merged.hunks).toHaveLength(1);
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe(
      "She crept quietly to the door. Then she knocked.",
    );
    checkValid(r.doc);
  });

  it("sentence grain: accepts compose in any order to the right document", () => {
    expect(
      acceptAllAt(
        "She walked slowly to the door. Then she knocked. It was late.",
        "She crept quietly to the window. Then she knocked. It was late.",
        "sentence",
      ),
    ).toBe("She crept quietly to the window. Then she knocked. It was late.");
  });
});

// A hunk's range extends to the paragraph's own end when its run reaches it,
// because the tail is the separator after the last word (`groupHunks` in
// `merge.ts`). A range stopping at `token.end` would drop the
// final period at aim "left" and duplicate it at aim "right". The merged
// view's base-side tail is a separate defect.
describe("a hunk's range at the paragraph's end", () => {
  it("an accept keeps the paragraph's trailing punctuation", () => {
    const left = parse("Hello world.");
    const right = parse("Hello there.");
    const merged = buildMergedDoc(left, right, "word");
    expect(merged.hunks[0].left).toEqual({ para: 0, from: 5, to: 12 });
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 5, to: 12 });
    const r = accept(left, right, merged.hunks[0]);
    expect(serialize(r.doc)).toBe("Hello there.");
    checkValid(r.doc);
  });

  it("the mirrored aim replaces the same span, never doubling the tail", () => {
    const left = parse("Hello world.");
    const right = parse("Hello there.");
    const merged = buildMergedDoc(left, right, "word");
    const r = accept(left, right, merged.hunks[0], "right");
    expect(serialize(r.doc)).toBe("Hello world.");
    checkValid(r.doc);
  });

  it("a differing tail travels with its own side in both aims", () => {
    const left = parse("Hello world.");
    const right = parse("Hello there!");
    const merged = buildMergedDoc(left, right, "word");
    expect(serialize(accept(left, right, merged.hunks[0]).doc)).toBe(
      "Hello there!",
    );
    expect(serialize(accept(left, right, merged.hunks[0], "right").doc)).toBe(
      "Hello world.",
    );
  });

  it("a side without a tail never invents one on the other", () => {
    // The right range reaches the paragraph end, so a right-aimed accept
    // replaces the period too and never leaves it beside the left's
    // tail-less "Hello world".
    const left = parse("Hello world");
    const right = parse("Hello there.");
    const merged = buildMergedDoc(left, right, "word");
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 5, to: 12 });
    expect(serialize(accept(left, right, merged.hunks[0]).doc)).toBe(
      "Hello there.",
    );
    expect(serialize(accept(left, right, merged.hunks[0], "right").doc)).toBe(
      "Hello world",
    );
  });

  it("a kept word after the run keeps the mid-paragraph right range", () => {
    const left = parse("Hello old world.");
    const right = parse("Hello new world.");
    const merged = buildMergedDoc(left, right, "word");
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 5, to: 10 });
    expect(serialize(accept(left, right, merged.hunks[0]).doc)).toBe(
      "Hello new world.",
    );
  });

  it("a delete-only run keeps its empty restore point and restores whole", () => {
    const left = parse("Hello world.");
    const right = parse("Hello.");
    const merged = buildMergedDoc(left, right, "word");
    expect(merged.hunks[0].right).toEqual({ para: 0, from: 5, to: 5 });
    expect(serialize(accept(left, right, merged.hunks[0], "right").doc)).toBe(
      "Hello world.",
    );
    expect(serialize(accept(left, right, merged.hunks[0]).doc)).toBe("Hello.");
  });

  it("the accepted tail wears the source's own format", () => {
    const left = parse("Hello world.");
    const right = parse("Hello **there.**");
    const merged = buildMergedDoc(left, right, "word");
    expect(serialize(accept(left, right, merged.hunks[0]).doc)).toBe(
      "Hello **there.**",
    );
  });
});
