// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { parseBarred, serializeBarred, withBarred } from "./barredSources";

describe("barred sources file", () => {
  it("carries the writer's barred sources through a round trip", () => {
    expect(
      parseBarred(serializeBarred(["reference:character--maren.md"])),
    ).toEqual(["reference:character--maren.md"]);
  });

  it("drops an entry that can name no source", () => {
    expect(
      parseBarred(JSON.stringify({ sourceIds: ["a", 7, "", null, "b", "a"] })),
    ).toEqual(["a", "b"]);
  });

  it("reads a damaged file as damaged, never as nothing barred", () => {
    for (const raw of [
      '{"sourceIds":["reference:a.md"',
      "not json",
      "7",
      "[]",
      "null",
      JSON.stringify({ sourceIds: "all of them" }),
      JSON.stringify({ ids: ["reference:a.md"] }),
      "{}",
    ])
      expect(parseBarred(raw)).toBeNull();
  });

  it("bars a source once, and lets it back in", () => {
    const barred = withBarred(withBarred([], "ref:a", true), "ref:a", true);
    expect(barred).toEqual(["ref:a"]);
    expect(withBarred(barred, "ref:a", false)).toEqual([]);
  });
});
