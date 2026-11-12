// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { GHOST_COMMENTS_PER_SECTION } from "./limits";
import {
  EMPTY_FILE,
  openThread,
  remove,
  resolve,
  type CommentsFile,
} from "./model";
import { admit, type Proposal } from "./proposals";

const proposal = (
  quote: string,
  weight: Proposal["weight"] = "minor",
): Proposal => ({
  anchor: quote ? { quote, prefix: "", suffix: "" } : null,
  body: `About ${quote || "the chapter"}.`,
  weight,
});

function ghost(
  file: CommentsFile,
  id: string,
  quote: string,
  persona = "spark",
) {
  return openThread(file, {
    id,
    anchor: { quote, prefix: "", suffix: "" },
    entry: {
      id: `${id}e`,
      author: { kind: "persona", id: persona },
      at: "t",
      body: `About ${quote}.`,
    },
    state: "proposed",
  });
}

describe("admit", () => {
  it("takes the heaviest first, in the persona's own order inside a weight", () => {
    const { admitted } = admit(EMPTY_FILE, "spark", [
      proposal("a", "observation"),
      proposal("b", "major"),
      proposal("c", "minor"),
      proposal("d", "major"),
    ]);
    expect(admitted.map((p) => p.anchor?.quote)).toEqual(["b", "d", "c", "a"]);
  });

  it("never lets one persona have more than the cap waiting in a chapter", () => {
    let file = EMPTY_FILE;
    for (let i = 0; i < GHOST_COMMENTS_PER_SECTION - 2; i++)
      file = ghost(file, `t${i}`, `waiting ${i}`);
    // Another persona's ghosts take none of Spark's room.
    file = ghost(file, "n1", "hers", "nova");
    const { admitted, refused } = admit(file, "spark", [
      proposal("x"),
      proposal("y"),
      proposal("z", "observation"),
    ]);
    expect(admitted.map((p) => p.anchor?.quote)).toEqual(["x", "y"]);
    expect(refused).toEqual([
      { proposal: proposal("z", "observation"), reason: "cap" },
    ]);
    expect(admit(file, "spark", [proposal("q")], 0).admitted).toEqual([]);
  });

  it("does not raise again what the writer dismissed, settled, or already has", () => {
    let file = ghost(EMPTY_FILE, "t1", "the storm arrives");
    file = remove(file, "t1", "t");
    file = ghost(file, "t2", "she was twenty-two");
    file = resolve(file, "t2");
    file = ghost(file, "t3", "the harbour went grey");
    const { admitted, refused } = admit(file, "spark", [
      // A shorter quote inside the dismissed one is the same passage.
      proposal("storm arrives"),
      proposal("she was twenty-two"),
      proposal("the harbour went grey and cold"),
      proposal("Nobody spoke."),
      proposal("nobody spoke"),
    ]);
    expect(refused.map((r) => r.reason)).toEqual([
      "dismissed",
      "settled",
      "duplicate",
      "duplicate",
    ]);
    expect(admitted.map((p) => p.anchor?.quote)).toEqual(["Nobody spoke."]);
    // Another persona may still raise the passage Spark was turned away on.
    expect(
      admit(file, "nova", [proposal("the storm arrives")]).admitted,
    ).toHaveLength(1);
  });

  it("tells chapter-level proposals apart by their first line", () => {
    const { admitted, refused } = admit(EMPTY_FILE, "spark", [
      proposal(""),
      proposal(""),
      { ...proposal(""), body: "Something else." },
    ]);
    expect(admitted).toHaveLength(2);
    expect(refused.map((r) => r.reason)).toEqual(["duplicate"]);
  });
});
