// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  setHeading,
  toggleBold,
  toggleItalic,
  toggleList,
  type EditResult,
} from "./referenceEdit";

// The reference editor's verbs are pure selection arithmetic, settled in Node
// the way `reference.ts` and `dropTarget.ts` are. Each case is a (text, start,
// end) document with the expected selection after the op.

const bold = (t: string, s: number, e: number): EditResult => ({
  text: t,
  start: s,
  end: e,
});

describe("toggleBold", () => {
  it("wraps a selection in double asterisks", () => {
    expect(toggleBold("cat", 0, 3)).toEqual(bold("**cat**", 2, 5));
  });

  it("wraps a word inside a sentence", () => {
    expect(toggleBold("the cat sat", 4, 7)).toEqual(
      bold("the **cat** sat", 6, 9),
    );
  });

  it("unwraps a selection that is already bold", () => {
    expect(toggleBold("**cat**", 2, 5)).toEqual(bold("cat", 0, 3));
  });

  it("unwraps a bold pair when the whole inner word is selected", () => {
    expect(toggleBold("a **cat** sits", 4, 7)).toEqual(
      bold("a cat sits", 2, 5),
    );
  });

  it("plants the marker pair under a collapsed caret", () => {
    expect(toggleBold("ca", 2, 2)).toEqual(bold("ca****", 4, 4));
  });

  it("is its own inverse anywhere", () => {
    const once = toggleBold("the cat sat", 4, 7);
    expect(toggleBold(once.text, once.start, once.end).text).toBe(
      "the cat sat",
    );
  });
});

describe("toggleItalic", () => {
  it("wraps a selection in single asterisks", () => {
    expect(toggleItalic("cat", 0, 3)).toEqual(bold("*cat*", 1, 4));
  });

  it("unwraps a selection that is already italic", () => {
    expect(toggleItalic("*cat*", 1, 4)).toEqual(bold("cat", 0, 3));
  });

  it("turns a bold word into bold-italic rather than tearing the pair", () => {
    expect(toggleItalic("**cat**", 2, 5)).toEqual(bold("***cat***", 3, 6));
  });

  it("plants a marker pair under a collapsed caret", () => {
    expect(toggleItalic("ca", 2, 2)).toEqual(bold("ca**", 3, 3));
  });
});

describe("setHeading", () => {
  it("marks the line the collapsed caret is on", () => {
    expect(setHeading("Maren\nher eyes", 2, 2, 1)).toEqual(
      bold("# Maren\nher eyes", 0, 7),
    );
  });

  it("marks every line the selection touches, from the first line it starts on", () => {
    expect(setHeading("a\nb\nc", 2, 4, 2)).toEqual(
      bold("a\n## b\n## c", 2, 11),
    );
  });

  it("replaces one heading level with another", () => {
    expect(setHeading("# Maren", 3, 5, 2)).toEqual(bold("## Maren", 0, 8));
  });

  it("toggles off: H1 on an H1 returns it to a paragraph", () => {
    expect(setHeading("# Maren", 0, 3, 1)).toEqual(bold("Maren", 0, 5));
  });

  it("strips a heading prefix when asked for a paragraph", () => {
    expect(setHeading("# Maren\n- a note", 0, 2, null)).toEqual(
      bold("Maren\n- a note", 0, 5),
    );
  });

  it("acts on the empty document", () => {
    expect(setHeading("", 0, 0, 1)).toEqual(bold("# ", 0, 2));
  });
});

describe("toggleList", () => {
  it("prefixes the current line with a bullet", () => {
    expect(toggleList("a note", 2, 2)).toEqual(bold("- a note", 0, 8));
  });

  it("prefixes every line the selection touches", () => {
    expect(toggleList("one\ntwo", 4, 7)).toEqual(bold("one\n- two", 4, 9));
  });

  it("unlists lines that already carry the marker", () => {
    expect(toggleList("- one\n- two", 3, 8)).toEqual(bold("one\ntwo", 0, 7));
  });

  it("leaves a heading intact and becomes a legal list item of it", () => {
    expect(toggleList("# Maren", 1, 1)).toEqual(bold("- # Maren", 0, 9));
  });
});
