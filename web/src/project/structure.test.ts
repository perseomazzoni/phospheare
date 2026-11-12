// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  allFileNames,
  allIds,
  childKindOf,
  childrenOf,
  descendantCount,
  emptyStructure,
  findNode,
  findParent,
  isDescendant,
  nextNodeId,
  nodeLabels,
  nodeNumber,
  nodeOfFile,
  parseStructure,
  recordsOf,
  sectionNumbers,
  serializeStructure,
  snapshotOf,
  validateAgainstDisk,
} from "./structure";
import { PRODUCT } from "../product";
import {
  STRUCTURE_VERSION,
  type DocNode,
  type DocumentStructure,
  type PartNode,
  type Snapshot,
} from "./types";

// `document-structure.yaml` is the one file a writer is invited to edit by
// hand, so every way of getting it wrong produces a precise complaint rather
// than a guess. These tests are the list of ways.
//
// Every node carries a stable id (`EL<n>`), a display name and an adopted
// snapshot, its live file. The snapshot list lives in
// `document-properties.json`, so this file carries only the node's shape and
// the adopted pointer; `reconcileRecords` in `properties.ts` holds the strict
// snapshot validation, tested there.

const GOOD = `version: 1
document:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    children:
      - id: EL2
        section: "Opening"
        adopted: section--opening.EL2.00.md
      - id: EL3
        section: "The Storm"
        adopted: section--the_storm.EL3.01.md
  - id: EL4
    part: "Act Two"
    adopted: part--act_two.EL4.00.md
    children: []
`;

/** A snapshot record, as `document-properties.json` holds it. */
function snap(
  file: string,
  title: string,
  created = "2026-01-01T00:00:00.000Z",
): Snapshot {
  return { file, title, created };
}

/**
 * A node with its snapshots attached, the shape `reconcileRecords` produces.
 * `parseStructure` does not fill snapshots, so the tests on real snapshot
 * lists (the disk check, the queries) build them directly.
 */
function node(
  id: string,
  kind: "part" | "section",
  title: string,
  adopted: string,
  snaps: Snapshot[],
  children: DocNode[] = [],
): DocNode {
  return kind === "section"
    ? { kind, id, title, adopted, snapshots: snaps }
    : { kind, id, title, adopted, snapshots: snaps, children };
}

/**
 * The good document with real snapshots attached: what the reconcile hands
 * the rest of the open pipeline, and what the disk check and the queries use.
 */
const GOOD_ATTACHED: DocumentStructure = {
  version: 1,
  children: [
    node(
      "EL1",
      "part",
      "Act One",
      "part--act_one.EL1.00.md",
      [snap("part--act_one.EL1.00.md", "Act One 1")],
      [
        node("EL2", "section", "Opening", "section--opening.EL2.00.md", [
          snap("section--opening.EL2.00.md", "Opening 1"),
        ]),
        node("EL3", "section", "The Storm", "section--the_storm.EL3.01.md", [
          snap("section--the_storm.EL3.00.md", "The Storm 1"),
          snap("section--the_storm.EL3.01.md", "The Storm 2"),
        ]),
      ],
    ),
    node("EL4", "part", "Act Two", "part--act_two.EL4.00.md", [
      snap("part--act_two.EL4.00.md", "Act Two 1"),
    ]),
  ],
  removed: [],
};

/** The first error code, which is what the panel shows. */
function codeOf(raw: string): string | undefined {
  const result = parseStructure(raw);
  return result.ok ? undefined : result.errors[0].code;
}

function parsed(raw: string): DocumentStructure {
  const result = parseStructure(raw);
  if (!result.ok)
    throw new Error(`expected a parse, got ${result.errors[0].code}`);
  return result.structure;
}

describe("parseStructure", () => {
  it("reads a well-formed file", () => {
    const structure = parsed(GOOD);
    expect(structure.children).toHaveLength(2);
    expect(structure.children[0]).toMatchObject({
      kind: "part",
      id: "EL1",
      title: "Act One",
      adopted: "part--act_one.EL1.00.md",
    });
    const actOne = structure.children[0] as PartNode;
    expect(actOne.children.map((c) => c.id)).toEqual(["EL2", "EL3"]);
    expect(actOne.children.map((c) => c.title)).toEqual([
      "Opening",
      "The Storm",
    ]);
    // The snapshot list is empty here: it lives in `document-properties.json`,
    // and the reconcile tests pin that it is read and attached from there.
    // This reader builds only the node's shape.
    expect(structure.children[1].snapshots).toEqual([]);
  });

  it("reads a document made only of Sections", () => {
    const structure = parsed(
      'version: 1\ndocument:\n  - id: EL1\n    section: "One"\n    adopted: section--one.EL1.00.md\n',
    );
    expect(structure.children[0].kind).toBe("section");
  });

  it("treats a Part with no children key as an empty Part", () => {
    const structure = parsed(
      'version: 1\ndocument:\n  - id: EL1\n    part: "A"\n    adopted: part--a.EL1.00.md\n',
    );
    expect((structure.children[0] as PartNode).children).toEqual([]);
  });

  it("accepts an empty slug as a title — a valid name on every platform", () => {
    // "???" transliterates to nothing, yet `part--.EL1.00.md` is a real file
    // name: the slug contains no separators, dots or trailing spaces, so it is
    // not refused.
    const structure = parsed(
      'version: 1\ndocument:\n  - id: EL1\n    part: "???"\n    adopted: part--.EL1.00.md\n',
    );
    expect(structure.children[0].adopted).toBe("part--.EL1.00.md");
  });

  // ── The identity ───────────────────────────────────────────────────────────

  it("rejects an entry with no id, or an id that is not an EL number", () => {
    expect(
      codeOf('document:\n  - part: "A"\n    adopted: part--a.EL1.00.md\n'),
    ).toBe("entryId");
    expect(
      codeOf(
        'document:\n  - id: act-one\n    part: "A"\n    adopted: part--a.EL1.00.md\n',
      ),
    ).toBe("entryId");
    expect(
      codeOf(
        'document:\n  - id: el1\n    part: "A"\n    adopted: part--a.EL1.00.md\n',
      ),
    ).toBe("entryId");
  });

  it("rejects a duplicate id, however it is cased", () => {
    const dup =
      'document:\n  - id: EL1\n    part: "A"\n    adopted: part--a.EL1.00.md\n  - id: EL1\n    part: "B"\n    adopted: part--b.EL1.00.md\n';
    expect(codeOf(dup)).toBe("duplicateId");
  });

  // ── The adopted snapshot ───────────────────────────────────────────────────

  it("rejects an entry with no adopted snapshot", () => {
    expect(codeOf('document:\n  - id: EL1\n    part: "A"\n')).toBe(
      "entryAdopted",
    );
  });

  // ── Parsing at all ─────────────────────────────────────────────────────────

  it("reports a missing file", () => {
    const result = parseStructure(null);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0].code).toBe("missingStructure");
  });

  it("reports a YAML syntax error with the line it happened on", () => {
    const result = parseStructure("document:\n  - part: a\n   bad-indent: x\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe("yamlParse");
    expect(result.errors[0].line).toBeGreaterThan(0);
  });

  // ── Shape and the Golden Rule ──────────────────────────────────────────────

  it("rejects a top level that is not a map", () => {
    expect(codeOf("- just\n- a list\n")).toBe("notAMap");
  });

  it("rejects a file with no document list", () => {
    expect(codeOf("version: 1\nchapters: []\n")).toBe("noDocumentList");
    expect(codeOf("version: 1\ndocument: nope\n")).toBe("noDocumentList");
  });

  it("rejects an entry that names neither a part nor a section", () => {
    expect(codeOf("document:\n  - chapter: x\n")).toBe("entryKind");
  });

  it("rejects an entry that claims to be both", () => {
    expect(codeOf('document:\n  - part: "A"\n    section: "B"\n')).toBe(
      "entryKind",
    );
  });

  it("rejects an entry that is not a map at all", () => {
    expect(codeOf("document:\n  - just a string\n")).toBe("entryNotAMap");
    expect(codeOf("document:\n  - 42\n")).toBe("entryNotAMap");
  });

  it("rejects an entry whose name is not a string", () => {
    expect(codeOf("document:\n  - id: EL1\n    section: 7\n")).toBe(
      "entryName",
    );
  });

  it("rejects a Section that claims children", () => {
    expect(
      codeOf(
        'document:\n  - id: EL1\n    section: "A"\n    adopted: section--a.EL1.00.md\n    children: []\n',
      ),
    ).toBe("sectionWithChildren");
  });

  it("rejects children that are not a list", () => {
    expect(
      codeOf(
        'document:\n  - id: EL1\n    part: "A"\n    adopted: part--a.EL1.00.md\n    children: nope\n',
      ),
    ).toBe("childrenNotAList");
  });

  it("rejects a container that mixes Parts and Sections", () => {
    const mixed =
      'document:\n  - id: EL1\n    part: "A"\n    adopted: part--a.EL1.00.md\n  - id: EL2\n    section: "B"\n    adopted: section--b.EL1.00.md\n';
    expect(codeOf(mixed)).toBe("mixedChildren");
  });

  it("rejects mixing inside a nested Part too", () => {
    const mixed = [
      "document:",
      "  - id: EL1",
      '    part: "A"',
      "    adopted: part--a.EL1.00.md",
      "    children:",
      "      - id: EL2",
      '        part: "B"',
      "        adopted: part--b.EL2.00.md",
      "      - id: EL3",
      '        section: "C"',
      "        adopted: section--c.EL3.00.md",
      "",
    ].join("\n");
    expect(codeOf(mixed)).toBe("mixedChildren");
  });
});

// ── The disk check ───────────────────────────────────────────────────────────

describe("validateAgainstDisk", () => {
  // The reconcile attaches the snapshots before this check runs;
  // `parseStructure` alone yields no file names, so this uses the attached
  // shape.
  const structure = GOOD_ATTACHED;
  const onDisk = [
    "part--act_one.EL1.00.md",
    "part--act_two.EL4.00.md",
    "section--opening.EL2.00.md",
    "section--the_storm.EL3.00.md",
    "section--the_storm.EL3.01.md",
  ];

  it("passes when the yaml and the folder agree", () => {
    expect(validateAgainstDisk(structure, onDisk)).toEqual([]);
  });

  it("reports a file the yaml names but the folder lacks", () => {
    const errors = validateAgainstDisk(
      structure,
      onDisk.filter((n) => n !== "section--opening.EL2.00.md"),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("filesMissing");
    expect(errors[0].values?.names).toBe("section--opening.EL2.00.md");
  });

  it("reports a file in the folder that the yaml never mentions", () => {
    const errors = validateAgainstDisk(structure, [
      ...onDisk,
      "section--stray.EL9.00.md",
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("filesUnlisted");
    expect(errors[0].values?.names).toBe("section--stray.EL9.00.md");
  });

  it("reports a bare node file (no counter) as unlisted", () => {
    const errors = validateAgainstDisk(structure, [
      ...onDisk,
      "section--opening.md",
    ]);
    expect(errors.map((e) => e.code)).toContain("filesUnlisted");
  });

  it("reports both directions at once", () => {
    const errors = validateAgainstDisk(structure, [
      "part--act_one.EL1.00.md",
      "section--stray.EL9.00.md",
    ]);
    expect(errors.map((e) => e.code)).toEqual([
      "filesMissing",
      "filesUnlisted",
    ]);
  });

  it("summarises a long list rather than printing all of it", () => {
    const many = Array.from(
      { length: 9 },
      (_, i) => `section--x${i}.EL9${i}.00.md`,
    );
    const errors = validateAgainstDisk(structure, [...onDisk, ...many]);
    expect(errors[0].values?.count).toBe(9);
    expect(String(errors[0].values?.names)).toContain("+4");
  });
});

// ── Round trip ───────────────────────────────────────────────────────────────

describe("serializeStructure", () => {
  it("round-trips a document unchanged", () => {
    const before = parsed(GOOD);
    const after = parsed(serializeStructure(before));
    expect(after).toEqual(before);
  });

  it("writes a header a human can act on", () => {
    const yaml = serializeStructure(parsed(GOOD));
    // It names the product by its public name.
    expect(yaml.startsWith(`# ${PRODUCT.name} — document structure`)).toBe(
      true,
    );
    expect(yaml).not.toMatch(/phospheare/i);
    expect(yaml).toContain("comments below are not preserved");
  });

  it("keeps the display names and snapshot files, so the yaml points at real files", () => {
    const yaml = serializeStructure(parsed(GOOD));
    expect(yaml).toContain("Act One");
    expect(yaml).toContain("adopted: part--act_one.EL1.00.md");
    expect(yaml).toContain("section--the_storm.EL3.01.md");
  });

  it("survives an empty document", () => {
    const empty: DocumentStructure = { version: 1, children: [] };
    expect(parsed(serializeStructure(empty)).children).toEqual([]);
  });
});

// ── Queries ──────────────────────────────────────────────────────────────────

describe("queries", () => {
  // The queries walk real snapshot lists, so they need the attached shape too.
  const structure = GOOD_ATTACHED;

  it("emptyStructure is a legal, empty document", () => {
    const empty = emptyStructure();
    expect(empty.version).toBe(STRUCTURE_VERSION);
    expect(empty.children).toEqual([]);
    expect(empty.removed).toEqual([]);
  });

  it("lists every snapshot file name, depth first", () => {
    expect(allFileNames(structure)).toEqual([
      "part--act_one.EL1.00.md",
      "section--opening.EL2.00.md",
      "section--the_storm.EL3.00.md",
      "section--the_storm.EL3.01.md",
      "part--act_two.EL4.00.md",
    ]);
  });

  it("finds a node by id, and a parent, and reports null at the root", () => {
    expect(findNode(structure, "EL2")?.title).toBe("Opening");
    expect(findNode(structure, "EL99")).toBeNull();
    expect(findParent(structure, "EL2")?.id).toBe("EL1");
    expect(findParent(structure, "EL1")).toBeNull();
  });

  it("resolves a file to its node", () => {
    expect(nodeOfFile(structure, "section--the_storm.EL3.01.md")?.id).toBe(
      "EL3",
    );
    expect(nodeOfFile(structure, "section--the_storm.EL3.00.md")?.id).toBe(
      "EL3",
    );
    expect(nodeOfFile(structure, "section--elsewhere.EL9.00.md")).toBeNull();
  });

  it("reads a container’s children", () => {
    expect(childrenOf(structure, null)).toHaveLength(2);
    expect(childrenOf(structure, "EL1")).toHaveLength(2);
    expect(childrenOf(structure, "EL4")).toEqual([]);
    // A Section is not a container, so it has nothing to offer.
    expect(childrenOf(structure, "EL2")).toEqual([]);
  });

  it("names what a container holds", () => {
    expect(childKindOf(structure, null)).toBe("part");
    expect(childKindOf(structure, "EL1")).toBe("section");
    expect(childKindOf(structure, "EL4")).toBe("empty");
  });

  it("knows its own descendants", () => {
    expect(isDescendant(structure, "EL1", "EL2")).toBe(true);
    expect(isDescendant(structure, "EL4", "EL2")).toBe(false);
    expect(isDescendant(structure, "EL2", "EL1")).toBe(false);
  });

  it("counts descendant rows, never snapshot files", () => {
    const actOne = findNode(structure, "EL1");
    const storm = findNode(structure, "EL3");
    const actTwo = findNode(structure, "EL4");
    if (!actOne || !storm || !actTwo) throw new Error("fixture drifted");
    // EL1 holds EL2 and EL3: two rows, though EL3 alone owns two files.
    expect(descendantCount(actOne)).toBe(2);
    // A leaf stays zero, snapshots and all.
    expect(descendantCount(storm)).toBe(0);
    expect(descendantCount(actTwo)).toBe(0);
  });

  // Only the ids are a namespace; titles and slugs are free.
  it("namespaces ids and the next id", () => {
    expect([...allIds(structure)].sort()).toEqual(["EL1", "EL2", "EL3", "EL4"]);
    expect(nextNodeId(structure)).toBe("EL5");
  });

  it("counts the removed list in the next id, so ids are never reused", () => {
    const withRemoved = parsed(
      `version: 1
document: []
removed:
  - id: EL1
    part: "Gone"
    adopted: part--gone.EL1.00.md
    children: []
`,
    );
    expect(nextNodeId(withRemoved)).toBe("EL2");
  });

  it("walks a removed Part's children for the next id and allIds", () => {
    const withRemovedTree = parsed(
      `version: 1
document: []
removed:
  - id: EL1
    part: "Gone"
    adopted: part--gone.EL1.00.md
    children:
      - id: EL2
        section: "Its child"
        adopted: section--gone_child.EL2.00.md
`,
    );
    expect(nextNodeId(withRemovedTree)).toBe("EL3");
    expect([...allIds(withRemovedTree)].sort()).toEqual(["EL1", "EL2"]);
  });

  it("exposes a node's snapshots in creation order", () => {
    const node = findNode(structure, "EL3");
    if (!node) throw new Error("EL3 must exist");
    expect(node.snapshots.map((s) => s.file)).toEqual([
      "section--the_storm.EL3.00.md",
      "section--the_storm.EL3.01.md",
    ]);
  });
});

// ── The removed list ─────────────────────────────────────────────────────────
//
// Removing a node sends its whole subtree to a `removed:` list in the same
// file, the bin. It is read with the same reader as `document:`, with two
// differences: a problem there warns and drops instead of refusing, because
// the removed files live outside `document/` and a broken list must not lock
// the open; and it gets its own seen-sets, because a live node and a removed
// one may share ids and file names in different folders.

describe("the removed list", () => {
  const withRemoved = `version: 1
document:
  - id: EL1
    section: "Opening"
    adopted: section--opening.EL1.00.md
removed:
  - id: EL2
    part: "Act One"
    adopted: part--act_one.EL2.00.md
    children:
      - id: EL3
        section: "The Storm"
        adopted: section--the_storm.EL3.01.md
      - id: EL4
        section: "Arrival"
        adopted: section--arrival.EL4.00.md
`;

  it("reads removed subtrees, keeping their structure", () => {
    const structure = parsed(withRemoved);
    expect(structure.removed).toHaveLength(1);
    const actOne = structure.removed?.[0];
    expect(actOne).toMatchObject({
      kind: "part",
      id: "EL2",
      title: "Act One",
      adopted: "part--act_one.EL2.00.md",
    });
    expect((actOne as PartNode).children.map((c) => c.id)).toEqual([
      "EL3",
      "EL4",
    ]);
  });

  it("defaults to an empty list when none is written", () => {
    expect(parsed(GOOD).removed).toEqual([]);
  });

  it("ignores the removed list in the duplicate checks, and vice versa", () => {
    // The same id and file names on both sides of the file are legal: the
    // files live in different folders, so a restore does not trip a false
    // duplicate.
    const structure = parsed(`version: 1
document:
  - id: EL1
    section: "Opening"
    adopted: section--opening.EL1.00.md
removed:
  - id: EL1
    section: "Opening"
    adopted: section--opening.EL1.00.md
`);
    expect(structure.children).toHaveLength(1);
    expect(structure.removed).toHaveLength(1);
  });

  it("refuses a file from a newer format, and names both versions", () => {
    const result = parseStructure(`version: 2
document: []
`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a newer format opened");
    expect(result.errors).toEqual([
      { code: "yamlNewer", values: { version: 2, supported: 1 } },
    ]);
  });

  it("warns on a removed list that is not a list, but still opens", () => {
    const result = parseStructure(`version: 1
document: []
removed: nope
`);
    if (!result.ok)
      throw new Error("a bad removed list must not refuse the open");
    expect(result.structure.removed).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(["removedNotAList"]);
  });

  it("warns on a broken removed entry, but still opens", () => {
    const result = parseStructure(`version: 1
document: []
removed:
  - chapter: nope
`);
    if (!result.ok)
      throw new Error("a broken removed entry must not refuse the open");
    expect(result.structure.removed).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("entryKind");
  });

  it("warns when the removed list mixes kinds, but still opens", () => {
    const result = parseStructure(`version: 1
document: []
removed:
  - id: EL1
    part: "A"
    adopted: part--a.EL1.00.md
  - id: EL2
    section: "B"
    adopted: section--b.EL2.00.md
`);
    if (!result.ok)
      throw new Error("a mixed removed list must not refuse the open");
    expect(result.structure.removed).toHaveLength(2);
    expect(result.warnings.map((w) => w.code)).toContain("mixedChildren");
  });

  it("round-trips the removed list - shape only, bindings live in properties", () => {
    const withRemoved = `version: 1
document: []
removed:
  - id: EL1
    part: "Act One"
    adopted: part--act_one.EL1.00.md
    children:
      - id: EL2
        section: "Opening"
        adopted: section--opening.EL2.00.md
`;
    const first = parsed(withRemoved);
    const again = parsed(serializeStructure(first));
    expect(again.removed).toEqual(first.removed);
    expect(serializeStructure(again)).toContain("removed:");
    // The yaml's round trip is shape only: a structural edit can neither
    // carry nor drop a summary binding, which rides `document-properties.json`.
    expect(serializeStructure(again)).not.toContain("summary:");
  });

  it("writes no removed key when the bin is empty", () => {
    expect(serializeStructure(parsed(GOOD))).not.toContain("removed:");
  });

  it("never counts removed files against the document folder", () => {
    // The disk check compares `document/` against the `document:` list only.
    // The bin's files sit in `recyclebin/` and are invisible to it: the
    // removed node carries snapshots, yet none of its files are expected.
    const structure: DocumentStructure = {
      version: 1,
      children: [
        node("EL1", "section", "Opening", "section--opening.EL1.00.md", [
          snap("section--opening.EL1.00.md", "Opening 1"),
        ]),
      ],
      removed: [
        node(
          "EL2",
          "part",
          "Act One",
          "part--act_one.EL2.00.md",
          [snap("part--act_one.EL2.00.md", "Act One 1")],
          [
            node(
              "EL3",
              "section",
              "The Storm",
              "section--the_storm.EL3.01.md",
              [
                snap("section--the_storm.EL3.00.md", "The Storm 1"),
                snap("section--the_storm.EL3.01.md", "The Storm 2"),
              ],
            ),
          ],
        ),
      ],
    };
    expect(
      validateAgainstDisk(structure, ["section--opening.EL1.00.md"]),
    ).toEqual([]);
  });
});

describe("nodeLabels", () => {
  const sec = (id: string, title: string): DocNode => ({
    kind: "section",
    id,
    title,
    adopted: `section--x.${id}.00.md`,
    snapshots: [],
  });
  const prt = (id: string, title: string, children: DocNode[]): DocNode => ({
    kind: "part",
    id,
    title,
    adopted: `part--x.${id}.00.md`,
    snapshots: [],
    children,
  });

  it("keeps a unique title as it is", () => {
    const labels = nodeLabels({
      version: 1,
      children: [prt("EL1", "One", [sec("EL2", "Anna"), sec("EL3", "Ben")])],
    });
    expect(labels.get("EL2")).toBe("Anna");
    expect(labels.get("EL1")).toBe("One");
  });

  it("tells shared titles apart by their path, then by their place", () => {
    const labels = nodeLabels({
      version: 1,
      children: [
        prt("EL1", "Part One", [sec("EL2", "Anna"), sec("EL3", "anna")]),
        prt("EL4", "Part Two", [sec("EL5", "Anna")]),
      ],
    });
    expect(labels.get("EL2")).toBe("Part One › Anna #1");
    expect(labels.get("EL3")).toBe("Part One › anna #2");
    expect(labels.get("EL5")).toBe("Part Two › Anna");
  });

  it("counts every Section in reading order across the Parts, and no Part", () => {
    const numbers = sectionNumbers({
      version: 1,
      children: [
        prt("EL1", "Part One", [sec("EL2", "Lev"), sec("EL3", "Timo")]),
        prt("EL4", "Part Two", [sec("EL5", "Ari")]),
      ],
    });
    expect([...numbers]).toEqual([
      ["EL2", 1],
      ["EL3", 2],
      ["EL5", 3],
    ]);
  });

  // The titlebar names the open node with the number the panel draws beside
  // it, from one rule, so the two never disagree.
  it("numbers a node as the structure panel does", () => {
    const structure: DocumentStructure = {
      version: 1,
      children: [
        prt("EL1", "Prologue", [sec("EL2", "Lev")]),
        prt("EL3", "Part One", [
          sec("EL4", "Timo"),
          prt("EL5", "Inner", [sec("EL6", "Ari")]),
        ]),
      ],
    };
    // A top-level Part: its place at the root.
    expect(nodeNumber(structure, "EL1")).toBe(1);
    expect(nodeNumber(structure, "EL3")).toBe(2);
    // A Section: its place in the whole book.
    expect(nodeNumber(structure, "EL2")).toBe(1);
    expect(nodeNumber(structure, "EL6")).toBe(3);
    // A Part inside another carries none, as in the panel.
    expect(nodeNumber(structure, "EL5")).toBeNull();
    expect(nodeNumber(structure, "EL99")).toBeNull();
  });
});

describe("recordsOf", () => {
  const record = (file: string, title: string): Snapshot => ({
    file,
    title,
    created: "x",
  });

  // A hand-edited yaml can hold a live id again inside a removed subtree,
  // since the reader judges the two lists apart. The live record is the one
  // the properties write keeps, at any depth of the bin.
  it("never lets a nested removed record overwrite a live one", () => {
    const live = record("section--opening.EL2.00.md", "Opening 1");
    const structure: DocumentStructure = {
      version: STRUCTURE_VERSION,
      children: [
        {
          kind: "section",
          id: "EL2",
          title: "Opening",
          adopted: live.file,
          summary: "summary--EL2.md",
          snapshots: [live],
        },
      ],
      removed: [
        {
          kind: "part",
          id: "EL5",
          title: "Act Two",
          adopted: "part--act_two.EL5.00.md",
          snapshots: [record("part--act_two.EL5.00.md", "Act Two 1")],
          children: [
            {
              kind: "section",
              id: "EL2",
              title: "The Storm",
              adopted: "section--the_storm.EL2.00.md",
              summary: "summary--EL2-removed.md",
              snapshots: [record("section--the_storm.EL2.00.md", "Storm 1")],
            },
            {
              kind: "section",
              id: "EL6",
              title: "Arrival",
              adopted: "section--arrival.EL6.00.md",
              snapshots: [record("section--arrival.EL6.00.md", "Arrival 1")],
            },
          ],
        },
      ],
    };
    const { snapshots, summaries } = recordsOf(structure);
    expect(snapshots.EL2).toEqual([live]);
    expect(summaries.EL2).toBe("summary--EL2.md");
    expect(Object.keys(snapshots).sort()).toEqual(["EL2", "EL5", "EL6"]);
  });
});

describe("snapshotOf", () => {
  it("finds a node's snapshot record by its file", () => {
    expect(
      snapshotOf(GOOD_ATTACHED, "EL3", "section--the_storm.EL3.01.md")?.file,
    ).toBe("section--the_storm.EL3.01.md");
  });

  it("is null for an unknown node or a file the node does not hold", () => {
    expect(snapshotOf(GOOD_ATTACHED, "EL99", "x.md")).toBeNull();
    expect(
      snapshotOf(GOOD_ATTACHED, "EL2", "section--the_storm.EL3.01.md"),
    ).toBeNull();
  });
});
