// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  capsShare,
  isSceneGlyph,
  isSentenceLike,
  numberValue,
  romanValue,
  tidyText,
} from "./text";

describe("tidyText", () => {
  it("sweeps out what a word processor leaves and nobody typed", () => {
    expect(tidyText("a\u200Bb\u00ADc\uFEFFd")).toBe("abcd");
    expect(tidyText("one\ttwo   three")).toBe("one two three");
    expect(tidyText("bell\u0007")).toBe("bell");
  });

  it("composes accents, so one letter typed two ways is one letter", () => {
    expect(tidyText("e\u0300")).toBe("è");
  });

  it("keeps the joiners emoji are built with", () => {
    expect(tidyText("👩\u200D💻")).toBe("👩\u200D💻");
  });
});

describe("isSceneGlyph", () => {
  it.each(["* * *", "***", "#", "~", "⁂", "§", "———", "* * * * *", " ❦ "])(
    "reads %j as a scene break",
    (line) => expect(isSceneGlyph(line)).toBe(true),
  );

  it.each(["", "...", "x x x", "o O o", "Chapter", "3", "— she said"])(
    "does not read %j as one",
    (line) => expect(isSceneGlyph(line)).toBe(false),
  );
});

describe("numbers", () => {
  it("reads canonical Roman numerals and refuses words that look like them", () => {
    expect(romanValue("XII")).toBe(12);
    expect(romanValue("xliv")).toBe(44);
    expect(romanValue("IIII")).toBeNull();
    expect(romanValue("did")).toBeNull();
  });

  it("reads no Roman number past 300 as a chapter number, where they spell words", () => {
    expect(romanValue("mix")).toBe(1009);
    expect(numberValue("mix")).toBeNull();
    expect(numberValue("di")).toBeNull();
    expect(numberValue("CCC")).toBe(300);
  });

  it.each([
    ["12", 12],
    ["XIV", 14],
    ["twelve", 12],
    ["Twenty-One", 21],
    ["twenty one", 21],
    ["the First", 1],
    ["ventuno", 21],
    ["ventotto", 28],
    ["ventitré", 23],
    ["primo", 1],
    ["seconda", 2],
    ["primera", 1],
    ["première", 1],
    ["veintidós", 22],
    ["treinta y uno", 31],
    ["vinte e um", 21],
    ["einundzwanzig", 21],
    ["dreiundzwanzig", 23],
    ["vingt et un", 21],
    ["soixante-douze", 72],
    ["quatre-vingt-quinze", 95],
    ["quatre-vingts", 80],
    ["7.", 7],
  ])("reads %j as %i", (text, value) => expect(numberValue(text)).toBe(value));

  it("reads nothing into a word that is not a number", () => {
    expect(numberValue("storm")).toBeNull();
    expect(numberValue("")).toBeNull();
  });
});

describe("line shapes", () => {
  it("measures capitals among letters only", () => {
    expect(capsShare("CHAPTER ONE")).toBe(1);
    expect(capsShare("Chapter")).toBeCloseTo(1 / 7);
    expect(capsShare("1947")).toBe(0);
  });

  it("tells a sentence from a heading", () => {
    expect(isSentenceLike("She closed the door behind her.")).toBe(true);
    expect(isSentenceLike("The Storm")).toBe(false);
    expect(isSentenceLike("Mr. Darcy")).toBe(false);
  });
});
