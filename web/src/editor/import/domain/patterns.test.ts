// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  looksLikeTocEntry,
  matchBareNumber,
  matchHeading,
  matchMatter,
} from "./patterns";

describe("matchHeading", () => {
  it.each([
    ["Chapter 3", "chapter", 3, ""],
    ["CHAPTER ONE", "chapter", 1, ""],
    ["Chapter 3: The Storm", "chapter", 3, "The Storm"],
    ["Chapter Twenty-One — Home", "chapter", 21, "Home"],
    ["Capitolo primo", "chapter", 1, ""],
    ["Capitolo 4. La tempesta", "chapter", 4, "La tempesta"],
    ["CAPÍTULO XII", "chapter", 12, ""],
    ["Chapitre 2", "chapter", 2, ""],
    ["Kapitel 7", "chapter", 7, ""],
    ["Ch. 9", "chapter", 9, ""],
    ["Part One", "part", 1, ""],
    ["PART II: The Fall", "part", 2, "The Fall"],
    ["Book 3", "part", 3, ""],
    ["Parte seconda", "part", 2, ""],
    ["Partie 1", "part", 1, ""],
  ])("reads %j as a heading", (line, kind, number, subtitle) => {
    expect(matchHeading(line)).toMatchObject({ kind, number, subtitle });
  });

  it.each([
    "Chapter 3 was her favourite.",
    "Chapter 3 was her favourite",
    "Part of me wanted to stay",
    "Partridge 2",
    "Booker",
    "Act 3 now",
    "Chapter",
    "Chapters 3",
  ])("never reads %j as one", (line) => {
    expect(matchHeading(line)).toBeNull();
  });
});

describe("matchBareNumber", () => {
  it("reads a line that is only a number", () => {
    expect(matchBareNumber("7")).toBe(7);
    expect(matchBareNumber("VII")).toBe(7);
    expect(matchBareNumber("Seven")).toBe(7);
    expect(matchBareNumber("7.")).toBe(7);
    expect(matchBareNumber("7 dwarves")).toBeNull();
  });
});

describe("matchMatter", () => {
  it.each([
    ["Prologue", "prologue", ""],
    ["PROLOGO", "prologue", ""],
    ["Prologue: 1947", "prologue", "1947"],
    ["Epilogue", "epilogue", ""],
    ["Contents", "toc", ""],
    ["Table of Contents", "toc", ""],
    ["Indice", "toc", ""],
    ["Acknowledgements", "acknowledgments", ""],
    ["Ringraziamenti", "acknowledgments", ""],
    ["About the Author", "about", ""],
    ["Also by Ada Byron", "alsoBy", "Ada Byron"],
    ["Copyright", "copyright", ""],
    ["Dedica", "dedication", ""],
  ])("reads %j as matter", (line, kind, subtitle) => {
    expect(matchMatter(line)).toEqual({ kind, subtitle });
  });

  it.each(["Notes on a Scandal", "Dedicated to my mother", "Indicent", ""])(
    "leaves %j alone",
    (line) => expect(matchMatter(line)).toBeNull(),
  );
});

describe("looksLikeTocEntry", () => {
  it("knows a contents line by its page number", () => {
    expect(looksLikeTocEntry("Chapter One ........ 7")).toBe(true);
    expect(looksLikeTocEntry("The Storm\t23")).toBe(true);
    expect(looksLikeTocEntry("She was 23")).toBe(false);
  });
});
