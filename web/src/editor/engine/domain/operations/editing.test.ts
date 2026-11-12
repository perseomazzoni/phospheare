// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { Doc, Format, Paragraph, Run, Selection } from "../model";
import { deleteBackward, deleteForward } from "./editing";

// Backspace and Delete remove one character as the writer sees it: a whole
// grapheme cluster, in UTF-16 code units on both sides of the offset.

const PLAIN: Format = { bold: false, italic: false, monospace: false };
const BOLD: Format = { ...PLAIN, bold: true };

const para = (runs: Run[]): Paragraph => ({
  runs,
  blockType: "paragraph",
  alignment: "left",
});
const plain = (...texts: string[]): Doc =>
  texts.map((text) => para([{ text, format: PLAIN }]));
const at = (p: number, offset: number): Selection => ({
  anchor: { para: p, offset },
  focus: { para: p, offset },
});
const text = (doc: Doc) => doc.map((p) => p.runs.map((r) => r.text).join(""));

const CLUSTERS: [string, string][] = [
  ["a ZWJ sequence", "👩‍💻"],
  ["a flag", "🇮🇹"],
  ["a skin tone", "👍🏽"],
  ["a keycap", "1️⃣"],
  ["a combining accent", `e${String.fromCodePoint(0x301)}`],
  ["Hangul jamo", String.fromCodePoint(0x1100, 0x1161, 0x11a8)],
];

describe("single-character deletes over grapheme clusters", () => {
  it.each(CLUSTERS)("Backspace after %s removes all of it", (_, cluster) => {
    const end = 1 + cluster.length;
    const result = deleteBackward(plain(`a${cluster}b`), at(0, end));
    expect(text(result.doc)).toEqual(["ab"]);
    expect(result.cursor).toEqual({ para: 0, offset: 1 });
  });

  it.each(CLUSTERS)("Delete before %s removes all of it", (_, cluster) => {
    const result = deleteForward(plain(`a${cluster}b`), at(0, 1));
    expect(text(result.doc)).toEqual(["ab"]);
    expect(result.cursor).toEqual({ para: 0, offset: 1 });
  });

  it("removes one cluster of two side by side", () => {
    const result = deleteBackward(plain("🇮🇹🇫🇷"), at(0, 8));
    expect(text(result.doc)).toEqual(["🇮🇹"]);
    expect(result.cursor).toEqual({ para: 0, offset: 4 });
  });

  it("leaves plain text one code unit at a time", () => {
    expect(text(deleteBackward(plain("abc"), at(0, 2)).doc)).toEqual(["ac"]);
    expect(text(deleteForward(plain("abc"), at(0, 1)).doc)).toEqual(["ac"]);
  });

  it("removes a cluster that spans two formatting runs, and keeps the runs around it", () => {
    // A bold `e` whose combining accent is in the plain run after it.
    const doc: Doc = [
      para([
        { text: "ab", format: PLAIN },
        { text: "e", format: BOLD },
        { text: `${String.fromCodePoint(0x301)}cd`, format: PLAIN },
      ]),
    ];
    const back = deleteBackward(doc, at(0, 4));
    expect(back.doc[0].runs).toEqual([{ text: "abcd", format: PLAIN }]);
    expect(back.cursor).toEqual({ para: 0, offset: 2 });
    const forward = deleteForward(doc, at(0, 2));
    expect(forward.doc[0].runs).toEqual([{ text: "abcd", format: PLAIN }]);
    expect(forward.cursor).toEqual({ para: 0, offset: 2 });
  });

  it("still joins paragraphs at their edges", () => {
    const back = deleteBackward(plain("a👩‍💻", "🇮🇹b"), at(1, 0));
    expect(text(back.doc)).toEqual(["a👩‍💻🇮🇹b"]);
    expect(back.cursor).toEqual({ para: 0, offset: 6 });
    const forward = deleteForward(plain("a👩‍💻", "🇮🇹b"), at(0, 6));
    expect(text(forward.doc)).toEqual(["a👩‍💻🇮🇹b"]);
    expect(forward.cursor).toEqual({ para: 0, offset: 6 });
  });
});
