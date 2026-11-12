// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  byRecency,
  matchesQuery,
  matchesSource,
  normalize,
  shown,
  type Listing,
} from "./libraryFilter";

const listing = (over: Partial<Listing> = {}): Listing => ({
  providerId: "local",
  name: "once-dark",
  title: "Once Dark",
  editedAt: "2026-07-28T10:00:00.000Z",
  ...over,
});

describe("normalize", () => {
  it("folds case and strips accents", () => {
    expect(normalize("Perché")).toBe("perche");
    expect(normalize("L’Isola Più Lontana")).toBe("l’isola piu lontana");
  });
});

describe("matchesQuery", () => {
  it("shows everything when nothing has been typed", () => {
    expect(matchesQuery(listing(), "")).toBe(true);
    expect(matchesQuery(listing(), "   ")).toBe(true);
  });

  it("matches the document title", () => {
    expect(matchesQuery(listing(), "dark")).toBe(true);
    expect(matchesQuery(listing(), "DARK")).toBe(true);
  });

  // The two can differ, and a writer may remember either.
  it("matches the folder name too", () => {
    expect(
      matchesQuery(listing({ title: "Something Else" }), "once-dark"),
    ).toBe(true);
  });

  it("finds an accented title typed without the accent", () => {
    expect(matchesQuery(listing({ title: "Perché No" }), "perche")).toBe(true);
  });

  it("refuses what is genuinely not there", () => {
    expect(matchesQuery(listing(), "quarry")).toBe(false);
  });

  it("does not crash on a card whose title we never read", () => {
    expect(matchesQuery(listing({ title: null }), "dark")).toBe(true);
    expect(matchesQuery(listing({ title: null, name: "x" }), "dark")).toBe(
      false,
    );
  });
});

describe("matchesSource", () => {
  it('lets everything through on "all"', () => {
    expect(matchesSource(listing({ providerId: "drive" }), "all")).toBe(true);
  });

  it("keeps one provider", () => {
    expect(matchesSource(listing({ providerId: "drive" }), "drive")).toBe(true);
    expect(matchesSource(listing({ providerId: "local" }), "drive")).toBe(
      false,
    );
  });
});

describe("byRecency", () => {
  it("puts the most recently edited first", () => {
    const older = listing({ name: "a", editedAt: "2026-01-01T00:00:00.000Z" });
    const newer = listing({ name: "b", editedAt: "2026-07-01T00:00:00.000Z" });
    expect([older, newer].sort(byRecency).map((l) => l.name)).toEqual([
      "b",
      "a",
    ]);
  });

  // Unknown is not the beginning of time, and a locked folder does not
  // outrank a chapter closed ten minutes ago.
  it("sorts a project we have never read to the end, not the start", () => {
    const known = listing({
      name: "known",
      editedAt: "2020-01-01T00:00:00.000Z",
    });
    const unknown = listing({ name: "unknown", editedAt: "" });
    expect([unknown, known].sort(byRecency).map((l) => l.name)).toEqual([
      "known",
      "unknown",
    ]);
  });

  it("falls back to the name when two were edited at the same moment", () => {
    const b = listing({ name: "beta" });
    const a = listing({ name: "alpha" });
    expect([b, a].sort(byRecency).map((l) => l.name)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("orders two never-read projects by name rather than at random", () => {
    const b = listing({ name: "beta", editedAt: "" });
    const a = listing({ name: "alpha", editedAt: "" });
    expect([b, a].sort(byRecency).map((l) => l.name)).toEqual([
      "alpha",
      "beta",
    ]);
  });
});

describe("shown", () => {
  const all = [
    listing({
      name: "once-dark",
      title: "Once Dark",
      editedAt: "2026-07-28T10:00:00.000Z",
    }),
    listing({
      name: "hollow-water",
      title: "Hollow Water",
      providerId: "drive",
      editedAt: "2026-07-27T10:00:00.000Z",
    }),
    listing({
      name: "lantern-and-ash",
      title: "Lantern & Ash",
      editedAt: "2026-06-01T10:00:00.000Z",
    }),
  ];

  it("applies search and source together", () => {
    expect(shown(all, "", "drive").map((l) => l.name)).toEqual([
      "hollow-water",
    ]);
    expect(shown(all, "dark", "all").map((l) => l.name)).toEqual(["once-dark"]);
    expect(shown(all, "dark", "drive")).toEqual([]);
  });

  it("returns everything, newest first, when nothing is asked of it", () => {
    expect(shown(all, "", "all").map((l) => l.name)).toEqual([
      "once-dark",
      "hollow-water",
      "lantern-and-ash",
    ]);
  });

  it("leaves the list it was given alone", () => {
    const input = [...all].reverse();
    const copy = [...input];
    shown(input, "", "all");
    expect(input).toEqual(copy);
  });
});
