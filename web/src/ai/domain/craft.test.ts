// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { LENSES, LENS_LIMIT, lensesFor, parseLens } from "./craft";

describe("the craft lenses", () => {
  it("reads a lens file by its stem, strictly", () => {
    const lens = parseLens(
      "./craft/the-scene.md",
      "---\ntitle: The scene\n---\n\nA unit of change.",
    );
    expect(lens).toEqual({
      id: "the-scene",
      title: "The scene",
      body: "A unit of change.",
    });
    expect(() =>
      parseLens("./craft/Scene.md", "---\ntitle: x\n---\nbody"),
    ).toThrow(/kebab-case/);
    expect(() => parseLens("./craft/scene.md", "---\nx: y\n---\nbody")).toThrow(
      /missing title/,
    );
  });

  it("ships the lenses the catalogue names, each with a body", () => {
    for (const id of [
      "arc",
      "premise",
      "stakes",
      "scene",
      "motivation-reaction",
      "pov",
      "dialogue",
      "exposition",
      "empathy",
      "moral-decision",
      "authenticity",
    ]) {
      expect(LENSES.get(id)?.body.length).toBeGreaterThan(200);
    }
  });

  it("gives the first-named lenses, each once, up to the limit", () => {
    const got = lensesFor(["pov", undefined, "pov", "nope", "arc", "scene"]);
    expect(got.map((one) => one.id)).toEqual(["pov", "arc"]);
    expect(got.length).toBe(LENS_LIMIT);
    expect(lensesFor(["scene"], 5).map((one) => one.id)).toEqual(["scene"]);
    expect(lensesFor([])).toEqual([]);
  });
});
