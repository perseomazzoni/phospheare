// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { plantWordsFor } from "./words";

// The planter's words. Number words are how the planter writes a
// changed number the way the book does.

describe("plantWordsFor", () => {
  it("has words for Italian and English, and none for any other language", () => {
    expect(plantWordsFor("it-IT")?.weekdays[1]).toBe("lunedì");
    expect(plantWordsFor("en")?.months[0]).toBe("january");
    expect(plantWordsFor("fr")).toBeNull();
    expect(plantWordsFor(undefined)).toBeNull();
  });

  it("reads Italian number words", () => {
    const number = plantWordsFor("it")?.number as (word: string) => number;
    for (const [word, value] of [
      ["tre", 3],
      ["dodici", 12],
      ["venti", 20],
      ["ventuno", 21],
      ["trentotto", 38],
      ["settantadue", 72],
      ["ottocento", 800],
      ["duecentoventi", 220],
      ["mille", 1000],
      ["duemila", 2000],
      ["tremilacinquecento", 3500],
      ["12,5", 12.5],
      ["", 0],
    ] as const)
      expect(number(word), word).toBe(value);
    for (const word of ["casa", "ventun", "trecentocasa", "casamila"])
      expect(number(word), word).toBeNull();
  });

  it("reads English number words", () => {
    const number = plantWordsFor("en")?.number as (word: string) => number;
    for (const [word, value] of [
      ["three", 3],
      ["twelve", 12],
      ["forty", 40],
      ["twenty-one", 21],
      ["4", 4],
    ] as const)
      expect(number(word), word).toBe(value);
    for (const word of ["house", "twenty-twelve", "forty-"])
      expect(number(word), word).toBeNull();
  });
});
