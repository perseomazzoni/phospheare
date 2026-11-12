// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  arcFileNameForCharacter,
  charactersWithArcs,
  groupReference,
  referenceCountOf,
  referenceDisplayTitle,
  referenceGroupOf,
  referenceTitle,
  sameReaderFace,
  summariesInFolder,
} from "./reference";
import type { DocumentStructure } from "./types";

// `reference/` stays open for the groups the writer names by hand. The two
// compiled groups (guidebook, world) are read through the catalogue: only
// catalogue ids are drawn, in catalogue order, and a hand-made file beside
// them stays on disk, untouched.

const AT = "2026-07-28T10:00:00.000Z";

// Nodes carry ids and the summary binding is id-based (`summary--EL2.md`), so
// this fixture gives the document-order tests nodes to point at.
const PROJECT: DocumentStructure = {
  version: 1,
  children: [
    {
      kind: "part",
      id: "EL1",
      title: "Act One",
      adopted: "part--act_one.EL1.00.md",
      snapshots: [
        { file: "part--act_one.EL1.00.md", title: "Act One 1", created: AT },
      ],
      children: [
        {
          kind: "section",
          id: "EL2",
          title: "Opening",
          adopted: "section--opening.EL2.00.md",
          snapshots: [
            {
              file: "section--opening.EL2.00.md",
              title: "Opening 1",
              created: AT,
            },
          ],
        },
        {
          kind: "section",
          id: "EL3",
          title: "The Storm",
          adopted: "section--the_storm.EL3.00.md",
          snapshots: [
            {
              file: "section--the_storm.EL3.00.md",
              title: "The Storm 1",
              created: AT,
            },
          ],
        },
      ],
    },
    {
      kind: "part",
      id: "EL4",
      title: "Act Two",
      adopted: "part--act_two.EL4.00.md",
      snapshots: [
        { file: "part--act_two.EL4.00.md", title: "Act Two 1", created: AT },
      ],
      children: [
        {
          kind: "section",
          id: "EL5",
          title: "Arrival",
          adopted: "section--arrival.EL5.00.md",
          snapshots: [
            {
              file: "section--arrival.EL5.00.md",
              title: "Arrival 1",
              created: AT,
            },
          ],
        },
      ],
    },
  ],
};

describe("referenceGroupOf", () => {
  it("reads the group from the prefix", () => {
    expect(referenceGroupOf("guidebook--the-ferry.md")).toBe("guidebook");
    expect(referenceGroupOf("character--maren.md")).toBe("characters");
    expect(referenceGroupOf("arc--maren.md")).toBe("arcs");
    expect(referenceGroupOf("summary--EL2.md")).toBe("summaries");
    expect(referenceGroupOf("world--nordkapp.md")).toBe("world");
    expect(referenceGroupOf("notes--research.md")).toBe("notes");
  });

  it("answers null for anything unprefixed rather than refusing it", () => {
    expect(referenceGroupOf("scrap.md")).toBeNull();
    expect(referenceGroupOf("Untitled 3.md")).toBeNull();
    // `other--` is not an owned prefix, so such a file has no group either.
    expect(referenceGroupOf("other--drafts.md")).toBeNull();
  });
});

describe("sameReaderFace", () => {
  // The Notes face is its own reader; everything else shares the Reference
  // face. The shell's dirty-draft guard uses this so a half-edited note is
  // never interrogated by opening a reference document, and vice versa.
  it("separates notes from every other reference document", () => {
    expect(sameReaderFace("notes--a.md", "character--maren.md")).toBe(false);
    expect(sameReaderFace("character--maren.md", "notes--a.md")).toBe(false);
    expect(sameReaderFace("summary--EL1.md", "notes--a.md")).toBe(false);
  });

  it("groups two documents of the same face together", () => {
    expect(sameReaderFace("notes--a.md", "notes--b.md")).toBe(true);
    expect(sameReaderFace("character--maren.md", "world--economy.md")).toBe(
      true,
    );
    expect(sameReaderFace("summary--EL1.md", "arc--maren.md")).toBe(true);
  });
});

describe("referenceTitle", () => {
  it("takes off the prefix and the extension", () => {
    expect(referenceTitle("guidebook--the-once-dark.md")).toBe("the-once-dark");
    expect(referenceTitle("character--otto-lindqvist.md")).toBe(
      "otto-lindqvist",
    );
    expect(referenceTitle("summary--EL2.md")).toBe("EL2");
  });

  it("leaves an unprefixed name as its own title", () => {
    expect(referenceTitle("scrap.md")).toBe("scrap");
    // An `other--` file reads literally, because the prefix is not owned.
    expect(referenceTitle("other--drafts.md")).toBe("other--drafts");
  });
});

describe("groupReference", () => {
  const files = [
    "notes--research.md",
    "character--otto.md",
    "guidebook--logline.md",
    "scrap.md",
    "character--maren.md",
    "world--economy.md",
    "arc--maren.md",
  ];

  it("draws the groups in a fixed, meaningful order", () => {
    expect(groupReference(files).map((g) => g.id)).toEqual([
      "guidebook",
      "characters",
      "arcs",
      "summaries",
      "world",
      "notes",
    ]);
  });

  // The sections are the interface: an empty group is a place to put
  // something, not an absence to hide. Every group comes back, full or not.
  it("renders every group, even one with nothing in it", () => {
    expect(groupReference(["guidebook--logline.md"]).map((g) => g.id)).toEqual([
      "guidebook",
      "characters",
      "arcs",
      "summaries",
      "world",
      "notes",
    ]);
    const summaries = groupReference(["guidebook--logline.md"]).find(
      (g) => g.id === "summaries",
    );
    expect(summaries?.docs).toEqual([]);
  });

  it("sorts within a group by title", () => {
    const characters = groupReference(files).find((g) => g.id === "characters");
    expect(characters?.docs.map((d) => d.title)).toEqual(["maren", "otto"]);
  });

  // A file that declares no group is not drawn: it stays on disk, untouched,
  // and the shelf reads only the named groups.
  it("leaves files that declare no group out of the drawing", () => {
    const groups = groupReference(["scrap.md", "other--drafts.md", "alpha.md"]);
    expect(groups).toHaveLength(6);
    expect(groups.every((g) => g.docs.length === 0)).toBe(true);
  });

  it("draws only the files that declare a group", () => {
    const all = groupReference(files).flatMap((g) => g.docs);
    expect(all.map((d) => d.fileName)).not.toContain("scrap.md");
    expect(all).toHaveLength(6);
  });

  // The compiled spaces are read through the catalogue: a hand-made file with
  // a valid prefix but an unrecognised stem is not drawn, and a catalogue id
  // not on disk has no document.
  it("draws only catalogue sections in the compiled groups", () => {
    const groups = groupReference([
      "world--nordkapp.md",
      "world--economy.md",
      "guidebook--my-bible.md",
      "guidebook--logline.md",
    ]);
    const world = groups.find((g) => g.id === "world");
    const guidebook = groups.find((g) => g.id === "guidebook");
    expect(world?.docs.map((d) => d.fileName)).toEqual(["world--economy.md"]);
    expect(guidebook?.docs.map((d) => d.fileName)).toEqual([
      "guidebook--logline.md",
    ]);
  });

  it("sorts compiled sections by catalogue order, not the alphabet", () => {
    // Alphabetically this would be cultures, ecology, economy; the catalogue
    // is the writer's build-out order, not the dictionary's.
    const groups = groupReference([
      "world--economy.md",
      "world--ecology.md",
      "world--cultures.md",
    ]);
    const world = groups.find((g) => g.id === "world");
    expect(world?.docs.map((d) => d.title)).toEqual([
      "cultures",
      "economy",
      "ecology",
    ]);
  });

  it("ignores anything that is not a document", () => {
    const groups = groupReference([
      ".DS_Store",
      "cover.png",
      "guidebook--logline.md",
    ]);
    expect(groups).toHaveLength(6);
    expect(groups[0].docs).toEqual([
      { fileName: "guidebook--logline.md", title: "logline" },
    ]);
    expect(
      groups
        .filter((g) => g.id !== "guidebook")
        .every((g) => g.docs.length === 0),
    ).toBe(true);
  });

  it("yields the six sections, each empty, for an empty folder", () => {
    const result = groupReference([]);
    expect(result.map((g) => g.id)).toEqual([
      "guidebook",
      "characters",
      "arcs",
      "summaries",
      "world",
      "notes",
    ]);
    expect(result.every((g) => g.docs.length === 0)).toBe(true);
  });

  // The one group where the alphabet is wrong: a reader of summaries is
  // reading the project, which has an order. The binding is by node id
  // (`summary--EL3.md` names the node `EL3`), so the order is the document's
  // own, EL2, EL3, EL5, however the files sort.
  it("puts summaries in the document order, not alphabetical order", () => {
    const summaries = groupReference(
      ["summary--EL3.md", "summary--EL5.md", "summary--EL2.md"],
      PROJECT,
    ).find((g) => g.id === "summaries");
    expect(summaries?.docs.map((d) => d.boundTo)).toEqual([
      "EL2",
      "EL3",
      "EL5",
    ]);
  });

  it("files a summary whose node is gone after the ones that remain", () => {
    const summaries = groupReference(
      ["summary--EL99.md", "summary--EL2.md"],
      PROJECT,
    ).find((g) => g.id === "summaries");
    expect(summaries?.docs.map((d) => d.boundTo)).toEqual(["EL2", "EL99"]);
  });

  it("falls back to the alphabet with no structure to order by", () => {
    // EL10 before EL2 proves it is the alphabet doing the sorting, not a
    // numeric reading of the ids.
    const summaries = groupReference([
      "summary--EL2.md",
      "summary--EL10.md",
    ]).find((g) => g.id === "summaries");
    expect(summaries?.docs.map((d) => d.title)).toEqual(["EL10", "EL2"]);
  });

  it("names the node a summary belongs to", () => {
    const summaries = groupReference(["summary--EL1.md"]).find(
      (g) => g.id === "summaries",
    );
    expect(summaries?.docs[0].boundTo).toBe("EL1");
  });

  it("leaves boundTo empty for everything that is not a summary", () => {
    const guidebook = groupReference(["guidebook--logline.md"]).find(
      (g) => g.id === "guidebook",
    );
    expect(guidebook?.docs[0].boundTo).toBeUndefined();
  });
});

describe("referenceCountOf", () => {
  it("sums the shelf's documents and never the notes", () => {
    expect(
      referenceCountOf([
        "guidebook--logline.md",
        "character--two.md",
        "arc--three.md",
        "summary--EL2.md",
        "world--economy.md",
        "notes--five.md",
      ]),
    ).toBe(5);
  });

  it("counts by the same reading the panel draws: unprefixed and non-document files stay out", () => {
    expect(referenceCountOf(["scrap.md", "cover.png", "notes--one.md"])).toBe(
      0,
    );
  });

  it("does not count a freeform file in a compiled group", () => {
    expect(
      referenceCountOf(["world--nordkapp.md", "guidebook--my-bible.md"]),
    ).toBe(0);
  });

  it("is zero for an empty folder", () => {
    expect(referenceCountOf([])).toBe(0);
  });
});

describe("summariesInFolder", () => {
  it("answers which node each summary on disk belongs to", () => {
    const found = summariesInFolder([
      "summary--EL2.md",
      "character--maren.md",
      "summary--EL1.md",
    ]);
    // Keyed by the node id, extension stripped: the key the structure file's
    // `summary:` binding compares against.
    expect(found.get("EL2")).toBe("summary--EL2.md");
    expect(found.get("EL1")).toBe("summary--EL1.md");
    expect(found.size).toBe(2);
  });

  it("is empty when the folder holds no summaries", () => {
    expect(summariesInFolder(["character--maren.md"]).size).toBe(0);
  });
});

describe("the character's arc, bound by stem", () => {
  it("derives the arc's file name from the character's", () => {
    expect(arcFileNameForCharacter("character--Maren Voss.md")).toBe(
      "arc--Maren Voss.md",
    );
    expect(arcFileNameForCharacter("character--maren.md")).toBe(
      "arc--maren.md",
    );
  });

  it("pairs each character with its arc, sorted by title", () => {
    const entries = charactersWithArcs([
      "character--otto.md",
      "character--maren.md",
      "arc--maren.md",
      "arc--otto.md",
    ]);
    expect(entries.map((e) => e.character.title)).toEqual(["maren", "otto"]);
    expect(entries[0].arc?.fileName).toBe("arc--maren.md");
    expect(entries[1].arc?.fileName).toBe("arc--otto.md");
  });

  it("leaves a character's arc null when there is none", () => {
    const entries = charactersWithArcs(["character--maren.md"]);
    expect(entries[0].arc).toBeNull();
  });

  it("does not return an arc whose character is gone — the card draws it for nobody", () => {
    const entries = charactersWithArcs([
      "character--maren.md",
      "arc--ghost.md",
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].arc).toBeNull();
  });

  it("matches the stem case-insensitively, because the platforms do", () => {
    const entries = charactersWithArcs([
      "character--Maren Voss.md",
      "arc--maren voss.md",
    ]);
    expect(entries[0].arc?.fileName).toBe("arc--maren voss.md");
  });

  it("keeps the first of a case-only duplicate arc", () => {
    const entries = charactersWithArcs([
      "character--maren.md",
      "arc--Maren.md",
      "arc--maren.md",
    ]);
    expect(entries[0].arc?.fileName).toBe("arc--Maren.md");
  });

  it("ignores files that are neither characters nor arcs", () => {
    const entries = charactersWithArcs([
      "scrap.md",
      "cover.png",
      "world--economy.md",
    ]);
    expect(entries).toEqual([]);
  });
});

// A summary's display name. The file is named by node id because the id is the
// binding, but a row shows the title of the node it summarises, not the id.

describe("a summary's display name", () => {
  const t = (key: string) => key;

  it("is the title of the Part or Section it summarises", () => {
    expect(referenceDisplayTitle("summary--EL2.md", t, PROJECT)).toBe(
      "Opening",
    );
    expect(referenceDisplayTitle("summary--EL1.md", t, PROJECT)).toBe(
      "Act One",
    );
  });

  it("falls back to the id only when the node is gone, or there is no structure", () => {
    expect(referenceDisplayTitle("summary--EL99.md", t, PROJECT)).toBe("EL99");
    expect(referenceDisplayTitle("summary--EL2.md", t)).toBe("EL2");
  });

  it("names the Summaries card's rows by title too", () => {
    const summaries = groupReference(
      ["summary--EL3.md", "summary--EL2.md"],
      PROJECT,
    ).find((group) => group.id === "summaries");
    expect(summaries?.docs.map((doc) => doc.title)).toEqual([
      "Opening",
      "The Storm",
    ]);
  });
});
