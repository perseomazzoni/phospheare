// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { bookWordsIn } from "./bookWords";

const BOOK = [
  "The lantern went dark beside the old gate before the guide came back.",
  "Marta counted the coins twice and said nothing about the missing ring.",
];

describe("bookWordsIn", () => {
  const holds = bookWordsIn(BOOK, 6);

  it("flags a query that repeats six of the writer's words in a row", () => {
    expect(holds("lantern went dark beside the old gate")).toBe(true);
  });

  it("does not flag a paraphrase, or a run shorter than six", () => {
    expect(holds("lantern goes out near an old gate")).toBe(false);
    expect(holds("beside the old gate")).toBe(false);
    expect(holds("")).toBe(false);
  });

  it("never finds a run across the seam between two texts", () => {
    // The last words of one text and the first of the next are not adjacent
    // in any book.
    expect(holds("guide came back marta counted the")).toBe(false);
  });

  it("reads both sides alike: case, apostrophes, compatibility forms", () => {
    const curly = bookWordsIn(["She said it wasn’t the ﬁrst time at all."], 6);
    expect(curly("SHE SAID IT WASN'T THE FIRST")).toBe(true);
    const marked = bookWordsIn(["perché la città non dorme mai qui"], 6);
    expect(marked("perché la città non dorme mai")).toBe(true);
  });

  it("ignores invisible characters planted between words", () => {
    expect(holds("lantern​ went dark beside the old gate")).toBe(true);
  });
});
