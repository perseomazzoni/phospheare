// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  AUTHOR_MAX,
  asAuthor,
  defaultProperties,
  parseProperties,
  reconcileRecords,
  serializeProperties,
  validateProperties,
  withSummary,
  withUi,
  withoutLastOpened,
  withoutSummary,
} from "./properties";
import { parseStructure, serializeStructure, recordsOf } from "./structure";
import {
  emptyCatalogue,
  readCatalogue,
  serializeCatalogue,
  withRecords,
} from "./snapshotCatalogue";
import {
  SCHEMA_VERSION,
  type DocNode,
  type DocumentStructure,
  type Snapshot,
} from "./types";

// Two contracts. `validateProperties` is the gate that decides whether a
// folder is a project at all; `parseProperties` runs past that gate and never
// throws, because a corrupt UI preference is not worth refusing to open
// somebody's novel.

describe("validateProperties", () => {
  const good = JSON.stringify({ document: { title: "Once Dark" } });

  it("accepts a file with a title", () => {
    expect(validateProperties(good)).toEqual([]);
  });

  it("refuses a folder with no properties file", () => {
    expect(validateProperties(null)[0].code).toBe("missingProperties");
  });

  it("refuses a file that is not JSON", () => {
    expect(validateProperties("{ not json")[0].code).toBe("propertiesParse");
    expect(validateProperties("[]")[0].code).toBe("propertiesParse");
    expect(validateProperties('"a string"')[0].code).toBe("propertiesParse");
  });

  it("refuses a file from a newer format, and names both versions", () => {
    const newer = JSON.stringify({
      schemaVersion: SCHEMA_VERSION + 1,
      document: { title: "Once Dark" },
    });
    expect(validateProperties(newer)[0]).toEqual({
      code: "propertiesNewer",
      values: { version: SCHEMA_VERSION + 1, supported: SCHEMA_VERSION },
    });
    // Its own format and every older one still open.
    expect(
      validateProperties(
        JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          document: { title: "Once Dark" },
        }),
      ),
    ).toEqual([]);
    expect(
      validateProperties(
        JSON.stringify({ schemaVersion: 1, document: { title: "Once Dark" } }),
      ),
    ).toEqual([]);
  });

  it("names the field that is missing", () => {
    expect(validateProperties("{}")[0]).toMatchObject({
      code: "propertiesField",
      values: { field: "document" },
    });
    expect(validateProperties('{"document":{}}')[0]).toMatchObject({
      values: { field: "document.title" },
    });
    expect(validateProperties('{"document":{"title":"  "}}')[0]).toMatchObject({
      values: { field: "document.title" },
    });
  });
});

describe("parseProperties", () => {
  it("returns defaults when there is no file", () => {
    const props = parseProperties(null, "Once Dark");
    expect(props.document.title).toBe("Once Dark");
    expect(props.ui).toEqual({
      expanded: [],
      lastOpened: null,
      session: null,
      dockWidth: null,
      structureWidth: null,
      commentsHidden: null,
      snapshotSplit: null,
      proseSize: null,
      typewriter: null,
      focus: null,
      smoothCaret: null,
      autosave: null,
      autosaveDelay: null,
      henosis: null,
      henosisAfter: null,
      henosisFade: null,
      henosisPause: null,
    });
  });

  it("returns defaults for malformed JSON rather than throwing", () => {
    expect(() => parseProperties("{ not json", "Doc")).not.toThrow();
    expect(parseProperties("{ not json", "Doc").document.title).toBe("Doc");
    expect(parseProperties("[]", "Doc").ui.expanded).toEqual([]);
  });

  it("reads a well-formed file", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      document: { title: "Real Title", type: "technical", language: "it" },
      // Ids, not file names: a rename re-stems the files but cannot touch the
      // id, so the tree and the last-open point survive it.
      ui: { expanded: ["EL1"], lastOpened: "EL2" },
    });
    const props = parseProperties(raw, "Fallback");
    expect(props.document.title).toBe("Real Title");
    // The type is free text, so any value reads back as written.
    expect(props.document.type).toBe("technical");
    expect(props.ui.expanded).toEqual(["EL1"]);
    expect(props.ui.lastOpened).toBe("EL2");
  });

  it("drops junk inside otherwise valid structures", () => {
    const raw = JSON.stringify({
      document: { title: 42, type: "nonsense" },
      ui: { expanded: ["EL1", 7, "EL1"], lastOpened: [] },
    });
    const props = parseProperties(raw, "Fallback");
    expect(props.document.title).toBe("Fallback");
    // The type is free text: any non-empty string is somebody's choice, so
    // this reads back as written. Only an empty or non-string value costs the
    // default, as the structure-and-type block pins.
    expect(props.document.type).toBe("nonsense");
    expect(props.ui.expanded).toEqual(["EL1"]);
    expect(props.ui.lastOpened).toBeNull();
  });

  it("accepts the written settings when they are real, and defaults them when not", () => {
    const good = parseProperties(
      JSON.stringify({
        document: { title: "T" },
        ui: {
          proseSize: 21,
          typewriter: true,
          focus: "line",
          autosave: true,
          autosaveDelay: 120,
        },
      }),
      "T",
    );
    expect(good.ui.proseSize).toBe(21);
    expect(good.ui.typewriter).toBe(true);
    expect(good.ui.focus).toBe("line");
    expect(good.ui.autosave).toBe(true);
    expect(good.ui.autosaveDelay).toBe(120);

    const bad = parseProperties(
      JSON.stringify({
        document: { title: "T" },
        ui: {
          proseSize: 22.5,
          typewriter: "yes",
          focus: "sentence",
          autosave: "yes",
          autosaveDelay: 0,
        },
      }),
      "T",
    );
    expect(bad.ui).toEqual({
      expanded: [],
      lastOpened: null,
      session: null,
      dockWidth: null,
      structureWidth: null,
      commentsHidden: null,
      snapshotSplit: null,
      proseSize: null,
      typewriter: null,
      focus: null,
      smoothCaret: null,
      autosave: null,
      autosaveDelay: null,
      henosis: null,
      henosisAfter: null,
      henosisFade: null,
      henosisPause: null,
    });
  });

  it("refuses an autosave delay outside the six preset steps", () => {
    const parse = (autosaveDelay: unknown) =>
      parseProperties(
        JSON.stringify({ document: { title: "T" }, ui: { autosaveDelay } }),
        "T",
      ).ui.autosaveDelay;

    // The presets are the whole vocabulary, the select's own steps; a delay
    // the select cannot express is nobody's choice.
    expect(parse(5)).toBe(5);
    expect(parse(300)).toBe(300);
    expect(parse(1)).toBeNull();
    expect(parse(90)).toBeNull();
    expect(parse(0)).toBeNull();
    expect(parse(-5)).toBeNull();
    expect(parse(3600)).toBeNull();
    expect(parse(120.9)).toBeNull();
    expect(parse("60")).toBeNull();
    expect(parse(Number.NaN)).toBeNull();
    expect(parse(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("keeps Henosis's switch and its two steps only as named", () => {
    const ui = (raw: Record<string, unknown>) =>
      parseProperties(
        JSON.stringify({ document: { title: "T" }, ui: raw }),
        "T",
      ).ui;

    const good = ui({ henosis: true, henosisAfter: 0, henosisFade: 10 });
    expect(good.henosis).toBe(true);
    expect(good.henosisAfter).toBe(0);
    expect(good.henosisFade).toBe(10);
    // Whole seconds from 0 to 10; anything else is a hand-edit, no step.
    const bad = ui({ henosis: "on", henosisAfter: 11, henosisFade: -1 });
    expect(bad.henosis).toBeNull();
    expect(bad.henosisAfter).toBeNull();
    expect(bad.henosisFade).toBeNull();
    expect(ui({ henosisAfter: 2.5 }).henosisAfter).toBeNull();
    expect(ui({ henosisFade: "10" }).henosisFade).toBeNull();
  });

  it("drops an order map, which the yaml owns", () => {
    const raw = JSON.stringify({
      document: { title: "Old" },
      order: { "/": ["Part Two", "Part One"] },
    });
    expect(parseProperties(raw, "Doc")).not.toHaveProperty("order");
  });

  it("reads the snapshot hashes leniently and round-trips them", () => {
    // Each file's hash, keyed by its name. Anything but 64 lower-case hex
    // characters is not yet computed, and dropped rather than thrown.
    const good = "a".repeat(64);
    const raw = JSON.stringify({
      document: { title: "Doc" },
      snapshotHashes: {
        "section--a.EL1.00.md": good,
        "section--a.EL1.01.md": "A".repeat(64),
        "section--a.EL1.02.md": 12,
      },
    });
    const props = parseProperties(raw, "fallback");
    expect(props.snapshotHashes).toEqual({ "section--a.EL1.00.md": good });

    const back = parseProperties(serializeProperties(props), "Other");
    expect(back.snapshotHashes).toEqual(props.snapshotHashes);
  });

  it("round-trips through serialize", () => {
    const original = parseProperties(null, "Doc");
    original.ui = {
      expanded: ["EL1"],
      lastOpened: "EL2",
      session: { startedAt: "2026-03-10T09:00:00.000Z", words: 120 },
      dockWidth: 480,
      structureWidth: 320,
      commentsHidden: true,
      snapshotSplit: 0.4,
      proseSize: 21,
      typewriter: true,
      focus: "paragraph",
      smoothCaret: true,
      autosave: false,
      autosaveDelay: null,
      henosis: true,
      henosisAfter: 0,
      henosisFade: 8,
      henosisPause: 0,
    };
    const reparsed = parseProperties(serializeProperties(original), "Other");
    expect(reparsed.ui).toEqual({
      expanded: ["EL1"],
      lastOpened: "EL2",
      session: { startedAt: "2026-03-10T09:00:00.000Z", words: 120 },
      dockWidth: 480,
      structureWidth: 320,
      commentsHidden: true,
      snapshotSplit: 0.4,
      proseSize: 21,
      typewriter: true,
      focus: "paragraph",
      smoothCaret: true,
      autosave: false,
      autosaveDelay: null,
      henosis: true,
      henosisAfter: 0,
      henosisFade: 8,
      henosisPause: 0,
    });
    expect(reparsed.document.title).toBe("Doc");
    expect(reparsed.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("keeps the comments put away only as a yes or a no", () => {
    const read = (value: unknown) =>
      parseProperties(JSON.stringify({ ui: { commentsHidden: value } }), "D").ui
        .commentsHidden;
    expect(read(true)).toBe(true);
    expect(read(false)).toBe(false);
    expect(read("yes")).toBeNull();
    expect(parseProperties(null, "D").ui.commentsHidden).toBeNull();
  });

  // The dock width is the project's memory of its own panel. Any finite
  // positive number is a plausible width; nonsense costs a default, never an
  // open.
  it("reads the dock width when it is real, and defaults it when not", () => {
    const good = parseProperties(
      JSON.stringify({ document: { title: "T" }, ui: { dockWidth: 520 } }),
      "T",
    );
    expect(good.ui.dockWidth).toBe(520);

    const parse = (dockWidth: unknown) =>
      parseProperties(
        JSON.stringify({ document: { title: "T" }, ui: { dockWidth } }),
        "T",
      ).ui.dockWidth;
    expect(parse("520")).toBeNull();
    expect(parse(0)).toBeNull();
    expect(parse(-100)).toBeNull();
    expect(parse(Number.NaN)).toBeNull();
    expect(parse(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
  });

  // The structure panel's width goes through the dock's parser on the same
  // terms: a hand-edit that is not a width is nobody's width, and the panel
  // opens at its default rather than refusing.
  it("reads the structure width when it is real, and defaults it when not", () => {
    const good = parseProperties(
      JSON.stringify({ document: { title: "T" }, ui: { structureWidth: 320 } }),
      "T",
    );
    expect(good.ui.structureWidth).toBe(320);

    const parse = (structureWidth: unknown) =>
      parseProperties(
        JSON.stringify({ document: { title: "T" }, ui: { structureWidth } }),
        "T",
      ).ui.structureWidth;
    expect(parse("320")).toBeNull();
    expect(parse(0)).toBeNull();
    expect(parse(-100)).toBeNull();
    expect(parse(Number.NaN)).toBeNull();
    expect(parse(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parse(null)).toBeNull();
    expect(parse(undefined)).toBeNull();
  });
});

// ── Structure and type ───────────────────────────────────────────────────────
// The creation dialog's choices, persisted. The structure is real only when it
// names a shape in the catalogue; the type is the writer's own words and reads
// back verbatim, because it lands in their file.

// The author is hand-editable and travels into an export's metadata and
// running head, so the file hands the app one bounded line.
describe("the author", () => {
  it("is empty when the file never named one", () => {
    expect(defaultProperties("Doc").document.author).toBe("");
    const raw = JSON.stringify({ document: {} });
    expect(parseProperties(raw, "Doc").document.author).toBe("");
  });

  it("reads back what was written", () => {
    const props = defaultProperties("Doc");
    props.document.author = "Ada Lovelace";
    const raw = serializeProperties(props);
    expect(parseProperties(raw, "Doc").document.author).toBe("Ada Lovelace");
  });

  it("folds a hand-edited name onto one trimmed line", () => {
    const tab = String.fromCharCode(9);
    const newline = String.fromCharCode(10);
    expect(asAuthor(`  Ada${newline}${tab}Lovelace  `)).toBe("Ada Lovelace");
  });

  it("drops anything that is not a string", () => {
    expect(asAuthor(42)).toBe("");
    expect(asAuthor(null)).toBe("");
    expect(asAuthor(["Ada"])).toBe("");
  });

  it("caps a name at a byline's length without splitting a character", () => {
    expect(asAuthor("a".repeat(AUTHOR_MAX + 50))).toHaveLength(AUTHOR_MAX);
    // An astral character is two UTF-16 units; the cap counts characters.
    const astral = String.fromCodePoint(0x1d4d0).repeat(AUTHOR_MAX + 1);
    expect(Array.from(asAuthor(astral))).toHaveLength(AUTHOR_MAX);
  });
});

describe("structure and type", () => {
  it("a new document has no structure and the default type", () => {
    const props = defaultProperties("Doc");
    expect(props.document.structure).toBeNull();
    expect(props.document.type).toBe("Novel");
  });

  it("keeps a known structure id", () => {
    const props = parseProperties(
      JSON.stringify({
        document: { title: "Doc", structure: "threeact" },
      }),
      "fallback",
    );
    expect(props.document.structure).toBe("threeact");
  });

  // "empty" means no structure was chosen, which is null.
  it('reads "empty" as null', () => {
    const props = parseProperties(
      JSON.stringify({ document: { title: "Doc", structure: "empty" } }),
      "fallback",
    );
    expect(props.document.structure).toBeNull();
  });

  it("drops an unknown structure id rather than guessing", () => {
    const props = parseProperties(
      JSON.stringify({ document: { title: "Doc", structure: "snowflake" } }),
      "fallback",
    );
    expect(props.document.structure).toBeNull();
  });

  it("stores the writer's own words for type, verbatim", () => {
    const raw = JSON.stringify({
      document: { title: "Doc", type: "Epic Novel" },
    });
    expect(parseProperties(raw, "fallback").document.type).toBe("Epic Novel");

    const custom = JSON.stringify({
      document: { title: "Doc", type: "Screenplay" },
    });
    expect(parseProperties(custom, "fallback").document.type).toBe(
      "Screenplay",
    );
  });

  it("falls back to the default type when empty or not a string", () => {
    const parse = (type: unknown) =>
      parseProperties(JSON.stringify({ document: { title: "T", type } }), "T")
        .document.type;
    expect(parse("")).toBe("Novel");
    expect(parse(42)).toBe("Novel");
    expect(parse(null)).toBe("Novel");
    expect(parse(undefined)).toBe("Novel");
  });

  it("a structure survives a parse -> serialize -> parse round trip", () => {
    const original = parseProperties(null, "Doc");
    original.document.structure = "herosjourney";
    original.document.goal = 4800;
    const back = parseProperties(serializeProperties(original), "Other");
    expect(back.document.structure).toBe("herosjourney");
    expect(back.document.goal).toBe(4800);
  });

  it("keeps a declared genre and age through a round trip, and reads a bad one as unsaid", () => {
    const original = parseProperties(null, "Doc");
    expect(original.document.genres).toEqual([]);
    expect(original.document.ageCategory).toBeNull();
    original.document.genres = ["historical", "mystery"];
    original.document.ageCategory = "adult";
    const back = parseProperties(serializeProperties(original), "Other");
    expect(back.document.genres).toEqual(["historical", "mystery"]);
    expect(back.document.ageCategory).toBe("adult");
    // A hand-edited or shared file: unknown ids cost themselves, a repeat
    // counts once, a third genre is dropped, and nothing refuses the open.
    const parse = (genres: unknown, ageCategory: unknown) =>
      parseProperties(
        JSON.stringify({ document: { title: "T", genres, ageCategory } }),
        "T",
      ).document;
    expect(
      parse(["horror", "cosy", "horror", "romance", "fantasy"], "toddler"),
    ).toMatchObject({ genres: ["horror", "romance"], ageCategory: null });
    expect(parse("horror", 3)).toMatchObject({ genres: [], ageCategory: null });
  });
});

// ── The sync block ───────────────────────────────────────────────────────────
// A file with no `sync` key reads as unpaired, not broken. The round trip is
// pinned because `parseProperties` builds a fresh object from a fixed field
// list, so an unhandled key would be dropped by the first save.

describe("sync", () => {
  it("a file with no sync key reads as unpaired", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      document: { title: "Doc" },
    });
    expect(parseProperties(raw, "fallback").sync).toBeNull();
  });

  it("a new document defaults to unpaired", () => {
    expect(defaultProperties("Doc").sync).toBeNull();
  });

  it("a file with sync survives a parse -> serialize -> parse round trip", () => {
    const original = parseProperties(null, "Doc");
    original.sync = { remote: { providerId: "drive", key: "1AbCdEf" } };
    const reparsed = parseProperties(serializeProperties(original), "Other");
    expect(reparsed.sync).toEqual({
      remote: { providerId: "drive", key: "1AbCdEf" },
    });
    expect(reparsed.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("a malformed sync block degrades to null without failing validateProperties", () => {
    const raw = JSON.stringify({
      document: { title: "Doc" },
      sync: "nonsense",
    });
    expect(validateProperties(raw)).toEqual([]);
    expect(parseProperties(raw, "fallback").sync).toBeNull();
  });

  it("drops a sync block missing its remote", () => {
    const raw = JSON.stringify({ document: { title: "Doc" }, sync: {} });
    expect(parseProperties(raw, "fallback").sync).toBeNull();
  });

  it("drops a sync block whose remote key is not a string", () => {
    const raw = JSON.stringify({
      document: { title: "Doc" },
      sync: { remote: { providerId: "drive", key: 42 } },
    });
    expect(parseProperties(raw, "fallback").sync).toBeNull();
  });

  // Every other way the block can be wrong. `remote` reaches this parser from
  // a file on the writer's disk that another program, another version of the
  // app or a merge conflict may have touched. Each shape degrades to not
  // paired, which costs a re-pair and never data.
  it.each([
    ["a string where the target should be", "not-an-object"],
    ["an array", []],
    ["a provider that is not a string", { providerId: 7, key: "1AbC" }],
    ["an empty provider", { providerId: "", key: "1AbC" }],
    ["an empty key", { providerId: "drive", key: "" }],
  ])("drops a sync block carrying %s", (_label, remote) => {
    const raw = JSON.stringify({
      document: { title: "Doc" },
      sync: { remote },
    });
    expect(parseProperties(raw, "fallback").sync).toBeNull();
  });

  // The record names its backend, so a target with a key but no
  // provider addresses nothing.
  it("drops a sync block whose remote names no provider", () => {
    const raw = JSON.stringify({
      document: { title: "Doc" },
      sync: { remote: { key: "1AbCdEf" } },
    });
    expect(parseProperties(raw, "fallback").sync).toBeNull();
  });
});

// ── Stats and the goal ───────────────────────────────────────────────────────
// Derived facts, so a damaged block costs a recount rather than an open, as
// with `ui`. A number is never invented.

describe("stats", () => {
  it("starts a new document counted and empty, not unknown", () => {
    const props = defaultProperties("Doc");
    expect(props.stats).toEqual({
      words: 0,
      parts: 0,
      sections: 0,
      countedAt: props.document.createdAt,
      perNode: [],
    });
    expect(props.document.goal).toBeNull();
  });

  it("round-trips a counted document", () => {
    const props = defaultProperties("Doc");
    props.document.goal = 90000;
    props.stats = {
      words: 2040,
      parts: 2,
      sections: 3,
      countedAt: "2026-07-28T10:00:00.000Z",
      perNode: [
        {
          nodeId: "EL2",
          words: 2040,
          updatedAt: "2026-07-28T10:00:00.000Z",
        },
      ],
    };
    const back = parseProperties(serializeProperties(props), "fallback");
    expect(back.stats).toEqual(props.stats);
    expect(back.document.goal).toBe(90000);
  });

  it("round-trips the per-node session deltas, negative ones included", () => {
    const props = defaultProperties("Doc");
    props.stats = {
      words: 300,
      parts: 1,
      sections: 2,
      countedAt: "2026-07-28T10:00:00.000Z",
      perNode: [
        {
          nodeId: "EL2",
          words: 400,
          updatedAt: "2026-07-28T10:00:00.000Z",
          lastDelta: 400,
        },
        {
          nodeId: "EL3",
          words: 100,
          updatedAt: "2026-07-28T10:00:00.000Z",
          lastDelta: -250,
        },
      ],
    };
    const back = parseProperties(serializeProperties(props), "fallback");
    expect(back.stats.perNode).toEqual(props.stats.perNode);
  });

  it("drops a hostile session delta rather than believing it", () => {
    const props = parseProperties(
      JSON.stringify({
        document: { title: "Doc" },
        stats: {
          words: 10,
          perNode: [
            { nodeId: "EL1", words: 10, lastDelta: "lots" },
            { nodeId: "EL2", words: 5, lastDelta: 2.5 },
          ],
        },
      }),
      "fallback",
    );
    expect(props.stats.perNode).toEqual([
      { nodeId: "EL1", words: 10, updatedAt: "" },
      { nodeId: "EL2", words: 5, updatedAt: "" },
    ]);
  });

  it("reads a document with no stats as uncounted, not as broken", () => {
    const older = JSON.stringify({
      schemaVersion: 1,
      document: { title: "Doc", type: "novel", language: "en" },
      ui: { expanded: [], lastOpened: null },
    });
    const props = parseProperties(older, "fallback");
    expect(props.stats.words).toBe(0);
    expect(props.stats.perNode).toEqual([]);
    expect(props.document.goal).toBeNull();
  });

  it("discards a stats block that is the wrong shape", () => {
    const props = parseProperties(
      JSON.stringify({ document: { title: "Doc" }, stats: "nonsense" }),
      "fallback",
    );
    expect(props.stats.words).toBe(0);
  });

  it("drops per-node entries that name nothing, and de-duplicates", () => {
    const props = parseProperties(
      JSON.stringify({
        document: { title: "Doc" },
        stats: {
          words: 10,
          perNode: [
            { nodeId: "EL1", words: 10, updatedAt: "x" },
            { nodeId: "EL1", words: 99, updatedAt: "y" },
            { words: 5 },
            null,
            "nope",
          ],
        },
      }),
      "fallback",
    );
    expect(props.stats.perNode).toEqual([
      { nodeId: "EL1", words: 10, updatedAt: "x" },
    ]);
  });

  it("refuses negative and nonsensical counts", () => {
    const props = parseProperties(
      JSON.stringify({
        document: { title: "Doc", goal: -5 },
        stats: { words: -100, parts: "two", sections: NaN, perNode: [] },
      }),
      "fallback",
    );
    expect(props.stats.words).toBe(0);
    expect(props.stats.parts).toBe(0);
    expect(props.stats.sections).toBe(0);
    expect(props.document.goal).toBeNull();
  });

  it("treats a goal of zero as no goal", () => {
    const props = parseProperties(
      JSON.stringify({ document: { title: "Doc", goal: 0 } }),
      "fallback",
    );
    expect(props.document.goal).toBeNull();
  });

  // A positive fraction would floor to an impossible "0 words to write"; the
  // card hides it (`goal > 0`), but the file would carry a false goal. It is
  // no goal.
  it("treats a positive fractional goal as no goal", () => {
    const props = parseProperties(
      JSON.stringify({ document: { title: "Doc", goal: 0.5 } }),
      "fallback",
    );
    expect(props.document.goal).toBeNull();
  });
});

// ── The snapshot record ──────────────────────────────────────────────────────
// Once the structure is known, `reconcileRecords` attaches the properties'
// snapshot records to the nodes and refuses the open on a live node whose
// record is corrupt: a snapshot is the prose, and the disk check would refuse
// anyway. A problem in the removed list warns and drops the entry, because a
// broken bin is a wrong annotation, not an unreadable document.
// `parseStructure` does not read snapshots, so these tests feed a yaml shape
// and a properties record together.

describe("reconcileRecords", () => {
  /** Parse a yaml fixture, then attach the given records to it. */
  const reconcile = (
    raw: string,
    snapshots: Record<string, Snapshot[]>,
    summaries: Record<string, string> = {},
  ) => {
    const parsed = parseStructure(raw);
    if (!parsed.ok)
      throw new Error(`fixture must parse, got ${parsed.errors[0].code}`);
    return reconcileRecords(parsed.structure, snapshots, summaries);
  };

  const storm = `version: 1
document:
  - id: EL1
    section: "The Storm"
    adopted: section--the_storm.EL1.01.md
`;

  it("attaches a live node's snapshots and leaves warnings empty", () => {
    const out = reconcile(storm, {
      EL1: [
        {
          file: "section--the_storm.EL1.00.md",
          title: "The Storm 1",
          created: "2026-01-01T00:00:00.000Z",
        },
        {
          file: "section--the_storm.EL1.01.md",
          title: "My second snapshot",
          created: "2026-02-01T00:00:00.000Z",
        },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings).toEqual([]);
    expect(out.structure.children[0].snapshots).toEqual([
      {
        file: "section--the_storm.EL1.00.md",
        title: "The Storm 1",
        created: "2026-01-01T00:00:00.000Z",
      },
      {
        file: "section--the_storm.EL1.01.md",
        title: "My second snapshot",
        created: "2026-02-01T00:00:00.000Z",
      },
    ]);
  });

  it("reads a node's snapshots and round-trips them through both files", () => {
    const snaps: Snapshot[] = [
      {
        file: "section--the_storm.EL1.00.md",
        title: "The Storm 1",
        created: "2026-01-01T00:00:00.000Z",
      },
      {
        file: "section--the_storm.EL1.01.md",
        title: "My second snapshot",
        created: "2026-02-01T00:00:00.000Z",
      },
    ];
    const out = reconcile(storm, { EL1: snaps });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    // The yaml round trip keeps the node's shape and only the shape: the
    // snapshot list never goes back into `document-structure.yaml`.
    const again = parseStructure(serializeStructure(out.structure));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.structure.children[0]).toMatchObject({
      id: "EL1",
      adopted: "section--the_storm.EL1.01.md",
    });
    expect(again.structure.children[0].snapshots).toEqual([]);

    // The records ride the catalogue, which the shell writes from the
    // structure (`withRecords`), the reverse of the reconcile.
    const read = readCatalogue(
      serializeCatalogue(withRecords(emptyCatalogue(), out.structure)),
    );
    expect(read.ok && read.catalogue.snapshots.EL1).toEqual(snaps);
  });

  it("rejects a live node with no snapshots at all", () => {
    const absent = reconcile(storm, {});
    expect(absent.ok).toBe(false);
    if (absent.ok) return;
    expect(absent.errors[0].code).toBe("snapshotsEmpty");

    const nonList = reconcile(storm, {
      EL1: 42 as unknown as Snapshot[],
    });
    expect(nonList.ok).toBe(false);
    if (nonList.ok) return;
    expect(nonList.errors[0].code).toBe("snapshotsEmpty");
  });

  it("rejects a snapshot whose file is not the node's shape", () => {
    // The file anchors to the node's own kind and id: a snapshot name
    // that belongs to another node is never written to.
    const code = (file: string) => {
      const out = reconcile(storm, {
        EL1: [{ file, title: "x", created: "x" }],
      });
      return out.ok ? undefined : out.errors[0].code;
    };
    expect(code("section--the_storm.EL2.00.md")).toBe("snapshotEntryBad");
    expect(code("part--the_storm.EL1.00.md")).toBe("snapshotEntryBad");
    expect(code("section--the_storm.00.md")).toBe("snapshotEntryBad");
    expect(code("section--the_storm.md")).toBe("snapshotEntryBad");
    expect(code("section--the_storm.EL1.1.md")).toBe("snapshotEntryBad");
    expect(code("../escape.EL1.00.md")).toBe("snapshotEntryBad");
  });

  it("opens a node whose files carry a stale slug", () => {
    // A rename that stopped halfway, or a writer renaming files by hand,
    // leaves an old slug in the name. The slug is a label: the id
    // still anchors the file, so the book opens rather than being refused.
    const out = reconcile(
      `version: 1
document:
  - id: EL1
    section: "The Storm"
    adopted: section--the_gale.EL1.00.md
`,
      {
        EL1: [
          { file: "section--the_gale.EL1.00.md", title: "x", created: "x" },
        ],
      },
    );
    expect(out.ok).toBe(true);
  });

  it("rejects a node whose record has a duplicate snapshot title", () => {
    const out = reconcile(storm, {
      EL1: [
        { file: "section--the_storm.EL1.00.md", title: "A 1", created: "x" },
        { file: "section--the_storm.EL1.01.md", title: "A 1", created: "x" },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0].code).toBe("snapshotEntryBad");
  });

  it("rejects an adopted snapshot that is not listed", () => {
    const out = reconcile(storm, {
      EL1: [
        { file: "section--the_storm.EL1.00.md", title: "A 2", created: "x" },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0].code).toBe("adoptedNotListed");
  });

  it("opens two nodes whose titles transliterate to the same slug", () => {
    // "Act One" and "Act-One" share a slug, and the same title twice shares
    // everything, but each file carries its node's id, so both open.
    const out = reconcile(
      `version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
  - id: EL2
    part: "Act-One"
    adopted: part--act_one.EL2.00.md
  - id: EL3
    part: "Act One"
    adopted: part--act_one.EL3.00.md
`,
      {
        EL1: [
          { file: "part--act_one.EL1.00.md", title: "Act One 1", created: "x" },
        ],
        EL2: [
          { file: "part--act_one.EL2.00.md", title: "Act-One 1", created: "x" },
        ],
        EL3: [
          { file: "part--act_one.EL3.00.md", title: "Act One 1", created: "x" },
        ],
      },
    );
    expect(out.ok).toBe(true);
  });

  it("opens two Sections that share a title in different Parts", () => {
    // A chapter named for its point-of-view character, and that character
    // narrating again later. Titles are free.
    const out = reconcile(
      `version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    children:
      - id: EL2
        section: "Opening"
        adopted: section--opening.EL2.00.md
  - id: EL3
    part: "Act Two"
    adopted: part--act_two.EL3.00.md
    children:
      - id: EL4
        section: "Opening"
        adopted: section--opening.EL4.00.md
`,
      {
        EL1: [
          { file: "part--act_one.EL1.00.md", title: "Act One 1", created: "x" },
        ],
        EL2: [
          {
            file: "section--opening.EL2.00.md",
            title: "Opening 1",
            created: "x",
          },
        ],
        EL3: [
          { file: "part--act_two.EL3.00.md", title: "Act Two 1", created: "x" },
        ],
        EL4: [
          {
            file: "section--opening.EL4.00.md",
            title: "Opening 1",
            created: "x",
          },
        ],
      },
    );
    expect(out.ok).toBe(true);
  });

  it("rejects a record that lists one file twice", () => {
    // The folder-wide set still guards a record a hand edit doubled up.
    const out = reconcile(storm, {
      EL1: [
        { file: "section--the_storm.EL1.00.md", title: "A 1", created: "x" },
        { file: "section--the_storm.EL1.00.md", title: "A 2", created: "x" },
      ],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0].code).toBe("duplicateSnapshotFile");
  });

  it("silently ignores a snapshots key that names no node", () => {
    // An orphan key is nobody's record; it never refuses or warns, because the
    // reconcile reads only the ids the structure owns.
    const out = reconcile(storm, {
      EL99: [
        { file: "section--ghost.EL99.00.md", title: "Ghost 1", created: "x" },
      ],
      EL1: [
        {
          file: "section--the_storm.EL1.00.md",
          title: "The Storm 1",
          created: "x",
        },
        {
          file: "section--the_storm.EL1.01.md",
          title: "The Storm 2",
          created: "x",
        },
      ],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings).toEqual([]);
  });

  it("warns and drops a removed entry with broken snapshots, but still opens", () => {
    // A removed node whose record is corrupt warns and is dropped, never
    // refusing the open: its files live outside `document/`.
    const out = reconcile(
      `version: 1
document: []
removed:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    children: []
`,
      {},
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.structure.removed).toEqual([]);
    expect(out.warnings.map((w) => w.code)).toEqual(["snapshotsEmpty"]);
  });

  it("keeps a removed entry whose record is good, snapshots attached", () => {
    // The counterpart of the warn-and-drop: a removed node with a clean record
    // survives the reconcile with its snapshots attached, and warns nothing.
    const out = reconcile(
      `version: 1
document:
  - id: EL1
    section: "Opening"
    adopted: section--opening.EL1.00.md
removed:
  - id: EL2
    part: "Act One"
    adopted: part--act_one.EL2.00.md
    children: []
`,
      {
        EL1: [
          {
            file: "section--opening.EL1.00.md",
            title: "Opening 1",
            created: "x",
          },
        ],
        EL2: [
          { file: "part--act_one.EL2.00.md", title: "Act One 1", created: "x" },
        ],
      },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings).toEqual([]);
    expect(out.structure.removed).toHaveLength(1);
    expect(out.structure.removed?.[0].snapshots).toEqual([
      { file: "part--act_one.EL2.00.md", title: "Act One 1", created: "x" },
    ]);
  });

  it("maps every node's records, live and removed, by id", () => {
    const structure: DocumentStructure = {
      version: 1,
      children: [
        {
          kind: "section",
          id: "EL1",
          title: "Opening",
          adopted: "section--opening.EL1.00.md",
          summary: "summary--EL1.md",
          snapshots: [
            {
              file: "section--opening.EL1.00.md",
              title: "Opening 1",
              created: "x",
            },
          ],
        } satisfies DocNode,
      ],
      removed: [
        {
          kind: "part",
          id: "EL2",
          title: "Act One",
          adopted: "part--act_one.EL2.00.md",
          snapshots: [
            {
              file: "part--act_one.EL2.00.md",
              title: "Act One 1",
              created: "x",
            },
          ],
          children: [
            {
              kind: "section",
              id: "EL3",
              title: "The Storm",
              adopted: "section--the_storm.EL3.00.md",
              snapshots: [
                {
                  file: "section--the_storm.EL3.00.md",
                  title: "The Storm 1",
                  created: "x",
                },
              ],
            } satisfies DocNode,
          ],
        } satisfies DocNode,
      ],
    };
    expect(recordsOf(structure)).toEqual({
      snapshots: {
        EL1: [
          {
            file: "section--opening.EL1.00.md",
            title: "Opening 1",
            created: "x",
          },
        ],
        EL2: [
          { file: "part--act_one.EL2.00.md", title: "Act One 1", created: "x" },
        ],
        EL3: [
          {
            file: "section--the_storm.EL3.00.md",
            title: "The Storm 1",
            created: "x",
          },
        ],
      },
      summaries: { EL1: "summary--EL1.md" },
    });
  });

  it("a removed node sharing a live id never overwrites the live record", () => {
    // A hand-edited yaml can hold the same id in both lists, since the reader
    // parses separate id sets for them; the app never reuses ids. The
    // properties write keeps the live node's record.
    const structure: DocumentStructure = {
      version: 1,
      children: [
        {
          kind: "section",
          id: "EL1",
          title: "Opening",
          adopted: "section--opening.EL1.00.md",
          summary: "summary--EL1.md",
          snapshots: [
            {
              file: "section--opening.EL1.00.md",
              title: "Opening 1",
              created: "x",
            },
          ],
        } satisfies DocNode,
      ],
      removed: [
        {
          kind: "section",
          id: "EL1",
          title: "The Storm",
          adopted: "section--the_storm.EL1.00.md",
          summary: "summary--EL1-removed.md",
          snapshots: [
            {
              file: "section--the_storm.EL1.00.md",
              title: "The Storm 1",
              created: "x",
            },
          ],
        } satisfies DocNode,
      ],
    };
    expect(recordsOf(structure)).toEqual({
      snapshots: {
        EL1: [
          {
            file: "section--opening.EL1.00.md",
            title: "Opening 1",
            created: "x",
          },
        ],
      },
      summaries: { EL1: "summary--EL1.md" },
    });
  });
});

// ── The summary binding ──────────────────────────────────────────────────────
//
// A node's summary binding lives in `document-properties.json` beside the
// snapshots. The reconcile warns and attaches nothing on a wrong name: an
// annotation problem is visible, never a refusal, and a novel must not lock
// over one.

describe("the summary binding through reconcileRecords", () => {
  const storm = `version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    children:
      - id: EL2
        section: "Opening"
        adopted: section--opening.EL2.00.md
`;
  const snaps: Record<string, Snapshot[]> = {
    EL1: [
      { file: "part--act_one.EL1.00.md", title: "Act One 1", created: "x" },
    ],
    EL2: [
      { file: "section--opening.EL2.00.md", title: "Opening 1", created: "x" },
    ],
  };
  /** Parse the yaml fixture, then attach the given summary bindings. */
  const reconcile = (raw: string, summaries: Record<string, string>) => {
    const parsed = parseStructure(raw);
    if (!parsed.ok)
      throw new Error(`fixture must parse, got ${parsed.errors[0].code}`);
    return reconcileRecords(parsed.structure, snaps, summaries);
  };

  it("attaches a binding on a Part and on a Section", () => {
    const out = reconcile(storm, {
      EL1: "summary--EL1.md",
      EL2: "summary--EL2.md",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.warnings).toEqual([]);
    expect(out.structure.children[0].summary).toBe("summary--EL1.md");
    const part = out.structure.children[0];
    if (part.kind !== "part") throw new Error("fixture: EL1 must be a part");
    expect(part.children[0].summary).toBe("summary--EL2.md");
  });

  it("leaves a node without one alone", () => {
    const out = reconcile(storm, {});
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.structure.children[0].summary).toBeUndefined();
    expect(out.warnings).toEqual([]);
  });

  it("warns and attaches nothing when a binding does not name its own node", () => {
    const out = reconcile(storm, { EL1: "summary--EL2.md" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.structure.children[0].summary).toBeUndefined();
    expect(out.warnings).toEqual([
      {
        code: "summaryMismatch",
        values: {
          title: "Act One",
          value: "summary--EL2.md",
          expected: "summary--EL1.md",
        },
      },
    ]);
  });

  it("rides the properties round trip, never the yaml", () => {
    const out = reconcile(storm, { EL1: "summary--EL1.md" });
    if (!out.ok) throw new Error("expected a reconciled structure");
    // The yaml round trip is shape only: a structural edit can neither carry
    // nor drop the binding.
    const again = parseStructure(serializeStructure(out.structure));
    if (!again.ok) throw new Error("expected a readable structure");
    expect(again.structure.children[0].summary).toBeUndefined();
    // The properties round trip is where the binding survives.
    const props = parseProperties(
      serializeProperties({
        ...defaultProperties("Doc"),
        summaries: { EL1: "summary--EL1.md" },
      }),
      "Doc",
    );
    expect(props.summaries).toEqual({ EL1: "summary--EL1.md" });
  });
});

it("parseSummaries drops bindings that are not names at all, without complaint", () => {
  const raw = JSON.stringify({
    document: { title: "T" },
    summaries: { EL1: 7, EL2: "", EL3: "summary--EL3.md" },
  });
  const props = parseProperties(raw, "T");
  expect(props.summaries).toEqual({ EL3: "summary--EL3.md" });
});

it("reads no assistant block: the bar and the model live elsewhere", () => {
  // The barred sources live in their own synced file and the model in the
  // chat. A reader with a branch for this shape would fail here.
  const raw = JSON.stringify({
    document: { title: "T" },
    assistant: { modelId: "qwen3:8b", excludedSourceIds: ["reference:a.md"] },
  });
  expect(parseProperties(raw, "T")).not.toHaveProperty("assistant");
  expect(defaultProperties("T")).not.toHaveProperty("assistant");
});

describe("the edits", () => {
  const base = defaultProperties("Once Dark");

  it("binds a summary, and drops it again", () => {
    const bound = withSummary(base, "EL2", "summary--EL2.md");
    expect(bound.summaries).toEqual({ EL2: "summary--EL2.md" });
    expect(withoutSummary(bound, "EL2")?.summaries).toEqual({});
  });

  it("writes nothing to drop a summary that is not bound", () => {
    expect(withoutSummary(base, "EL2")).toBeNull();
  });

  it("merges into ui and keeps every key it does not name", () => {
    const next = withUi(base, { dockWidth: 420 });
    expect(next.ui).toEqual({ ...base.ui, dockWidth: 420 });
  });

  it("clears a lastOpened that names a removed node, and only that one", () => {
    const open = withUi(base, { lastOpened: "EL2" });
    expect(
      withoutLastOpened(open, new Set(["EL2", "EL3"]))?.ui.lastOpened,
    ).toBeNull();
    expect(withoutLastOpened(open, new Set(["EL3"]))).toBeNull();
  });
});
