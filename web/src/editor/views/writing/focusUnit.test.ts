// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { lineAt, paragraphAt, type TopOf } from "./focusUnit";

// A two-line wrap: "aaaa bbbb " (indices 0..9, including the trailing space
// the wrap leaves) then "cccc" (indices 10..13). No DOM and no layout:
// `topOf` is a stub returning one of two line tops by index, the shape
// `Editor.tsx`'s real one has once it asks a Range for its rect.
const TEXT = "aaaa bbbb cccc";
const LINE1_TOP = 100;
const LINE2_TOP = 140;

function twoLineTopOf(): TopOf {
  return (k: number) => (k < 10 ? LINE1_TOP : LINE2_TOP);
}

describe("lineAt", () => {
  it("finds both edges of the first line, trailing whitespace trimmed", () => {
    // Caret inside "aaaa": the visual line runs 0..9 in raw text, but the
    // trailing space at index 9 is trimmed so the lit region does not extend
    // into the margin at the wrap point.
    expect(lineAt(TEXT, 2, twoLineTopOf())).toEqual({ start: 0, end: 9 });
  });

  it("finds both edges of the last line", () => {
    expect(lineAt(TEXT, 12, twoLineTopOf())).toEqual({ start: 10, end: 14 });
  });

  it("attributes a caret exactly at a wrap point to the line it starts", () => {
    expect(lineAt(TEXT, 10, twoLineTopOf())).toEqual({ start: 10, end: 14 });
  });

  it("is stable at the very first and very last character", () => {
    expect(lineAt(TEXT, 0, twoLineTopOf())).toEqual({ start: 0, end: 9 });
    expect(lineAt(TEXT, 13, twoLineTopOf())).toEqual({ start: 10, end: 14 });
  });

  it("trims trailing whitespace even when it is more than one character", () => {
    const text = "ab   cd";
    // Only a trailing run of spaces at the unit's own end is trimmed, never
    // an interior run; a one-line text ending in spaces shows the first.
    const trailing = "hello   ";
    const topOf: TopOf = () => 0;
    expect(lineAt(trailing, 0, topOf)).toEqual({ start: 0, end: 5 });
    // An interior run of whitespace is untouched.
    expect(lineAt(text, 0, topOf)).toEqual({ start: 0, end: 7 });
  });

  it("returns an empty unit for an empty paragraph", () => {
    expect(lineAt("", 0, twoLineTopOf())).toEqual({ start: 0, end: 0 });
  });

  it("falls back to the whole paragraph when layout is not ready", () => {
    const topOf: TopOf = () => null;
    expect(lineAt(TEXT, 5, topOf)).toEqual({ start: 0, end: TEXT.length });
  });

  it("clamps an out-of-range caret index into the text", () => {
    expect(lineAt(TEXT, -5, twoLineTopOf())).toEqual({ start: 0, end: 9 });
    expect(lineAt(TEXT, 999, twoLineTopOf())).toEqual({ start: 10, end: 14 });
  });
});

describe("paragraphAt", () => {
  it("is the whole block, unconditionally — no layout query needed", () => {
    expect(paragraphAt(TEXT.length)).toEqual({ start: 0, end: TEXT.length });
    expect(paragraphAt(0)).toEqual({ start: 0, end: 0 });
  });
});
