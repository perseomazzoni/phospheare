// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { faceOf, inkOn, type PersonaFace } from "./faces";

const PERSONAS: PersonaFace[] = [
  { id: "wren", name: "Wren", color: "#155393", avatar: "wren.png" },
];
const WORDS = { you: "You", unknown: "Someone" };

describe("faceOf", () => {
  it("draws the writer as you, an editor by name, a persona by its face", () => {
    expect(faceOf({ kind: "writer" }, PERSONAS, WORDS)).toEqual({
      name: "You",
      color: null,
      persona: false,
    });
    expect(
      faceOf({ kind: "editor", name: "M. Rossi" }, PERSONAS, WORDS).name,
    ).toBe("M. Rossi");
    expect(faceOf({ kind: "persona", id: "wren" }, PERSONAS, WORDS)).toEqual({
      name: "Wren",
      color: "#155393",
      avatar: "wren.png",
      persona: true,
    });
  });

  it("names nobody it cannot name: a nameless editor, a persona since removed", () => {
    expect(faceOf({ kind: "editor", name: "" }, PERSONAS, WORDS).name).toBe(
      "Someone",
    );
    expect(faceOf({ kind: "persona", id: "gone" }, PERSONAS, WORDS)).toEqual({
      name: "Someone",
      color: null,
      persona: true,
    });
  });
});

describe("inkOn", () => {
  it("writes white on a dark fill and near-black on a light one", () => {
    expect(inkOn("#155393")).toBe("#ffffff");
    expect(inkOn("#3B5842")).toBe("#ffffff");
    expect(inkOn("#D2A025")).toBe("#111614");
    expect(inkOn("#ffffff")).toBe("#111614");
  });

  it("falls back to white for anything that is not #rrggbb", () => {
    expect(inkOn("red")).toBe("#ffffff");
    expect(inkOn("#fff")).toBe("#ffffff");
  });
});
