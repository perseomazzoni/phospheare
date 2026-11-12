// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { typeDuration, typeSchedule } from "./typeSchedule";

describe("typeSchedule", () => {
  it("has nothing to say about an empty greeting", () => {
    expect(typeSchedule("")).toEqual([]);
    expect(typeDuration("")).toBe(0);
  });

  it("lands the first character immediately", () => {
    expect(typeSchedule("Hey")[0]).toBe(0);
  });

  it("never goes backwards", () => {
    const schedule = typeSchedule("Piacevole vederti, Muridivetro!");
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]).toBeGreaterThan(schedule[i - 1]);
    }
  });

  it("spaces plain characters evenly", () => {
    const [a, b, c] = typeSchedule("Hey");
    expect(b - a).toBe(c - b);
  });

  // The rhythm reads as someone pausing to think, not a metronome.
  it("holds after a comma, and only after it", () => {
    const withComma = typeSchedule("ab,cd");
    const without = typeSchedule("abxcd");
    const gapAtComma = withComma[3] - withComma[2];
    const gapAtLetter = without[3] - without[2];
    expect(gapAtComma).toBeGreaterThan(gapAtLetter);
    // Everything before the mark is untouched by it.
    expect(withComma.slice(0, 3)).toEqual(without.slice(0, 3));
  });

  it("carries the pause into every character after it", () => {
    const withComma = typeSchedule("ab,cd");
    const without = typeSchedule("abxcd");
    const shift = withComma[3] - without[3];
    expect(withComma[4] - without[4]).toBe(shift);
  });

  // A pause after the final mark delays nothing and holds the caret on screen
  // past the end of the sentence.
  it("adds nothing for a mark that ends the sentence", () => {
    expect(typeDuration("Hey!")).toBe(typeDuration("Heyx"));
  });

  it("schedules one delay per code point, not per UTF-16 unit", () => {
    // Italian greetings carry these, and `.split('')` would split them in two.
    const text = "Piacevole vederti, però!";
    expect(typeSchedule(text)).toHaveLength(Array.from(text).length);
  });

  it("finishes a real greeting inside a second", () => {
    // Long enough to read as writing, short enough that a writer who knows
    // which project they want never waits on it.
    expect(typeDuration("Hey Muridivetro, here's your library!")).toBeLessThan(
      1200,
    );
  });
});
