// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { SHAPE_IDS, partKeysFor, startingShape } from "./startingShape";
import { STRUCTURE_VERSION } from "./types";
import { validateAgainstDisk } from "./structure";

describe("startingShape", () => {
  it("makes nothing at all from no titles", () => {
    const shape = startingShape([]);
    expect(shape.structure).toEqual({
      version: STRUCTURE_VERSION,
      children: [],
    });
    expect(shape.files).toEqual([]);
  });

  it("makes one Part", () => {
    // A fixed clock: the scaffold's `at` becomes the snapshot's `created`,
    // which the validator holds to an ISO string.
    const shape = startingShape(["Part One"], "2026-07-28T10:00:00.000Z");
    expect(shape.structure.children).toEqual([
      {
        kind: "part",
        id: "EL1",
        title: "Part One",
        adopted: "part--part_one.EL1.00.md",
        snapshots: [
          {
            file: "part--part_one.EL1.00.md",
            title: "Part One 1",
            created: "2026-07-28T10:00:00.000Z",
            contentHash:
              "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        ],
        children: [],
      },
    ]);
    expect(shape.files).toEqual([
      { fileName: "part--part_one.EL1.00.md", content: "" },
    ]);
  });

  it("makes three, in the order given", () => {
    const shape = startingShape(["Part One", "Part Two", "Part Three"]);
    expect(shape.structure.children.map((n) => n.title)).toEqual([
      "Part One",
      "Part Two",
      "Part Three",
    ]);
  });

  // Every shape on offer is Parts holding nothing, so no sequence of clicks in
  // the dialog produces a Part holding both kinds.
  it("never produces a Part that holds anything yet", () => {
    const shape = startingShape(["Part One", "Part Two"]);
    for (const node of shape.structure.children) {
      if (node.kind !== "part")
        throw new Error("a starting shape is Parts only");
      expect(node.children).toEqual([]);
    }
  });

  it("drops a repeated title rather than writing the same file twice", () => {
    const shape = startingShape(["Part One", "Part One", "part one"]);
    expect(shape.structure.children).toHaveLength(1);
    expect(shape.files).toHaveLength(1);
  });

  it("ignores a blank title", () => {
    expect(
      startingShape(["Part One", "  ", ""]).structure.children,
    ).toHaveLength(1);
  });

  // The pair agrees, or the folder fails its own disk check on first open.
  it("names exactly the files it writes", () => {
    const shape = startingShape(["Part One", "Part Two", "Part Three"]);
    const onDisk = shape.files.map((f) => f.fileName);
    expect(validateAgainstDisk(shape.structure, onDisk)).toEqual([]);
  });
});

describe("the shape catalogue", () => {
  // The ids are written into `document-properties.json`
  // (`document.structure`), so they are part of the file contract: full names
  // a human can read back, never abbreviations.
  it("offers exactly the five structures, under full names, in dialog order", () => {
    expect([...SHAPE_IDS]).toEqual([
      "empty",
      "threeact",
      "kishotenketsu",
      "freytagspyramid",
      "herosjourney",
    ]);
  });

  it("offers Empty first, because that is what the dialog opens on", () => {
    expect(SHAPE_IDS[0]).toBe("empty");
  });

  it("starts Empty with no Parts at all", () => {
    expect(partKeysFor("empty")).toEqual([]);
  });

  it("gives every other shape at least one Part", () => {
    for (const id of SHAPE_IDS.filter((s) => s !== "empty")) {
      expect(partKeysFor(id).length).toBeGreaterThan(0);
    }
  });

  // `startingShape` drops a duplicate title rather than inventing a suffix, so
  // a key repeated inside one shape would write a four-Part scaffold for a
  // writer who chose a five-Part structure, and nothing would fail.
  it("never repeats a key within one shape", () => {
    for (const id of SHAPE_IDS) {
      const keys = partKeysFor(id);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("builds a real structure from every shape in the catalogue", () => {
    for (const id of SHAPE_IDS) {
      // Stands in for the translator: the keys are distinct, so the words are.
      const shape = startingShape(
        partKeysFor(id).map((key) => {
          // Keys are `create.partX`, pinned by the catalogue test below, so a
          // key without a plain tail is a catalogue bug, not a case to parse.
          const plain = key.split(".").pop();
          if (plain === undefined) throw new Error(`no plain key in ${key}`);
          return plain;
        }),
      );
      expect(shape.structure.children).toHaveLength(partKeysFor(id).length);
      expect(
        validateAgainstDisk(
          shape.structure,
          shape.files.map((f) => f.fileName),
        ),
      ).toEqual([]);
    }
  });

  // What lands in the writer's folder, spelled out once. A real creation's
  // picker needs a user gesture and cannot be driven, so the file names are
  // checked here. Every Part starts with its `.00` snapshot, one file per
  // title, slugged and numbered.
  it("writes the four Kishotenketsu Parts as plain file names", () => {
    const shape = startingShape(["Ki", "Sho", "Ten", "Ketsu"]);
    expect(shape.files.map((f) => f.fileName)).toEqual([
      "part--ki.EL1.00.md",
      "part--sho.EL2.00.md",
      "part--ten.EL3.00.md",
      "part--ketsu.EL4.00.md",
    ]);
  });

  // These keys stand in for the translator's words: the catalogue test above
  // uses each key's plain tail as a Part title, so a decorated key would make
  // the test decide the translated title. Decorated forms belong in the
  // option labels, which nothing writes to disk.
  it("keeps every Part title reachable as a plain-ASCII key", () => {
    for (const id of SHAPE_IDS) {
      for (const key of partKeysFor(id))
        expect(key).toMatch(/^create\.part[A-Za-z]+$/);
    }
  });
});
