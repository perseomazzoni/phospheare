// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { evidenceFor, takenFolders } from "./cardEvidence";
import type { ProjectRef } from "../../storage";
import type { ProjectCard } from "./useProjects";

const t = ((key: string) => key) as unknown as TFunction;

const ref = (providerId: string, key: string, name = key): ProjectRef => ({
  providerId,
  key,
  name,
  openedAt: "2026-07-28T10:00:00.000Z",
});

const card = (over: Partial<ProjectCard> = {}): ProjectCard => ({
  id: "book-a",
  ref: ref("local", "a", "a"),
  state: "ready",
  content: null,
  fresh: true,
  problem: null,
  ...over,
});

describe("evidenceFor", () => {
  it("shows the folder name alone when the project was never read", () => {
    expect(evidenceFor(card(), t, "en")).toBe("a/");
  });

  it("adds words and shape once the project is readable", () => {
    const readable = card({
      ref: ref("drive", "once-dark", "Once Dark"),
      content: {
        id: "x",
        title: "Once Dark",
        type: "novel",
        words: 48210,
        parts: 3,
        sections: 21,
        goal: null,
        perNode: [],
        structure: { version: 1, children: [] },
        updatedAt: "2026-07-28T10:00:00.000Z",
        cachedAt: "2026-07-28T10:00:00.000Z",
      },
    });
    expect(evidenceFor(readable, t, "en")).toBe(
      "Once Dark/\n48,210 library.words · library.shape",
    );
  });

  it("formats the number in the reader language", () => {
    const readable = card({
      content: {
        id: "x",
        title: "T",
        type: "novel",
        words: 48210,
        parts: 3,
        sections: 21,
        goal: null,
        perNode: [],
        structure: { version: 1, children: [] },
        updatedAt: "2026-07-28T10:00:00.000Z",
        cachedAt: "2026-07-28T10:00:00.000Z",
      },
    });
    expect(evidenceFor(readable, t, "de")).toContain("48.210");
  });
});

describe("takenFolders", () => {
  it("collects the folder name of every card", () => {
    const cards = [
      card({ ref: ref("local", "a", "Once Dark") }),
      card({ ref: ref("drive", "b", "L'Isola Più Lontana") }),
    ];
    expect(takenFolders(cards)).toEqual(
      new Set(["once-dark", "lisola-più-lontana"]),
    );
  });

  it("keeps the renamed project out of its own way", () => {
    const target = card({ ref: ref("local", "a", "Once Dark") });
    const other = card({ ref: ref("drive", "b", "Once Dark") });
    expect(takenFolders([target, other], target.ref).has("once-dark")).toBe(
      true,
    );
    expect(takenFolders([target], target.ref).has("once-dark")).toBe(false);
  });

  it("ignores cards that are not the excepted ref, even with the same name", () => {
    const target = card({ ref: ref("local", "a", "Once Dark") });
    const twin = card({ ref: ref("drive", "a", "Once Dark") });
    expect(takenFolders([twin], target.ref)).toEqual(new Set(["once-dark"]));
  });
});
