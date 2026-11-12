// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { coversText, extractWord } from "./selectionWord";

describe("the word a selection holds", () => {
  it("is the word itself, with its punctuation and spaces stripped", () => {
    expect(extractWord("lighthouse")).toBe("lighthouse");
    expect(extractWord("  lighthouse, ")).toBe("lighthouse");
    expect(extractWord("«")).toBeNull();
    expect(extractWord("(lighthouse)…")).toBe("lighthouse");
  });

  it("keeps an apostrophe inside the word", () => {
    expect(extractWord("l'isola")).toBe("l'isola");
    expect(extractWord("keeper's")).toBe("keeper's");
  });

  it("is nothing for two words or none", () => {
    expect(extractWord("the light")).toBeNull();
    expect(extractWord("")).toBeNull();
    expect(extractWord(" ... ")).toBeNull();
  });
});

describe("whether the engine's selection covers text", () => {
  const at = (para: number, offset: number) => ({ para, offset });

  it("is false for a caret", () => {
    expect(coversText({ anchor: at(2, 5), focus: at(2, 5) })).toBe(false);
  });

  it("is true within a paragraph and across paragraphs, in either direction", () => {
    expect(coversText({ anchor: at(2, 5), focus: at(2, 9) })).toBe(true);
    expect(coversText({ anchor: at(3, 0), focus: at(2, 0) })).toBe(true);
  });
});
