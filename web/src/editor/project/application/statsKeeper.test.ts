// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { hashOf } from "../../../text/hash";
import type {
  DocumentProperties,
  DocumentStructure,
} from "../../../project/types";
import { splitRecords, withRecords } from "../../project.fixture";
import type { MetadataStore, ProjectId, ProjectReader } from "./stores";
import { MetadataLanes } from "./metadataLanes";
import { readProject } from "./projectOpener";
import { StatsKeeper } from "./statsKeeper";

const A: ProjectId = { providerId: "fake", key: "a" };
const B: ProjectId = { providerId: "fake", key: "b" };

const BARE_PROPS = `{
  "schemaVersion": 1,
  "document": {
    "id": "doc-1",
    "title": "Once Dark",
    "type": "novel",
    "language": "en",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "sync": null,
  "ui": { "expanded": [], "lastOpened": null },
  "stats": { "words": 0, "parts": 0, "sections": 0, "countedAt": "2026-01-01T00:00:00.000Z", "perNode": [] }
}
`;

const PART = "part--act_one.EL1.00.md";
const SECTION = "section--the_door.EL2.00.md";

const STRUCTURE = `version: 1
document:
  - id: EL1
    part: Act One
    adopted: ${PART}
    snapshots:
      - file: ${PART}
        title: Act One 1
        created: 2026-01-01T00:00:00.000Z
    children:
      - id: EL2
        section: The Door
        adopted: ${SECTION}
        snapshots:
          - file: ${SECTION}
            title: The Door 1
            created: 2026-01-01T00:00:00.000Z
`;

const FILES: Record<string, string> = {
  [PART]: "One two three.\n",
  [SECTION]: "Four five.\n",
};

const NOW = new Date("2026-11-03T12:00:00.000Z");

const SEEDED = splitRecords(withRecords(BARE_PROPS, STRUCTURE));

/** A reader over the fixture's folder, with a log of the files it read. */
function fakeReader(files: Record<string, string> = FILES) {
  const read: string[] = [];
  const reader: ProjectReader<ProjectId> = {
    properties: async () => SEEDED.properties,
    catalogue: async () => SEEDED.catalogue,
    structure: async () => STRUCTURE,
    snapshot: async (_project, fileName) => {
      read.push(fileName);
      return files[fileName] ?? null;
    },
    documentFiles: async () => Object.keys(files),
    pullUnfinished: async () => false,
  };
  return { reader, read };
}

/** A store that keeps each properties file written. */
function fakeStore() {
  const written: DocumentProperties[] = [];
  const store: MetadataStore<ProjectId> = {
    writeStructure: vi.fn(async () => {}),
    writeProperties: vi.fn(async (_project, properties) => {
      written.push(properties);
    }),
    writeCatalogue: vi.fn(async () => {}),
  };
  return { store, written };
}

/** The fixture opened for real, with lanes that own it and a keeper. */
async function opened() {
  const verdict = await readProject(fakeReader().reader, A, "a");
  if (!verdict?.ok) throw new Error("the fixture does not open");
  const lanes = new MetadataLanes<ProjectId>({
    structure: () => {},
    properties: () => {},
    catalogue: () => {},
  });
  lanes.open(A, verdict.structure, verdict.properties, verdict.catalogue);
  return {
    lanes,
    keeper: new StatsKeeper(lanes),
    shape: verdict.structure as DocumentStructure,
    props: verdict.properties,
    catalogue: verdict.catalogue,
  };
}

const node = (props: DocumentProperties | null, id: string) =>
  props?.stats.perNode.find((entry) => entry.nodeId === id);

describe("a save's record", () => {
  it("writes the count, its stamp and the snapshot's hash in one write", async () => {
    const { keeper } = await opened();
    const { store, written } = fakeStore();
    await keeper.recordSave(store, A, "EL2", SECTION, "Six seven eight.", NOW);
    expect(written).toHaveLength(1);
    expect(node(written[0], "EL2")).toMatchObject({
      words: 3,
      updatedAt: NOW.toISOString(),
    });
    expect(written[0].snapshotHashes[SECTION]).toBe(
      await hashOf("Six seven eight."),
    );
  });

  it("writes the count alone for a file that is not one of the node's snapshots", async () => {
    const { keeper, props } = await opened();
    const { store, written } = fakeStore();
    await keeper.recordSave(store, A, "EL2", "stray.md", "Six.", NOW);
    expect(node(written[0], "EL2")?.words).toBe(1);
    expect(written[0].snapshotHashes).toEqual(props.snapshotHashes);
  });

  it("writes nothing while no project is open", async () => {
    const { lanes, keeper } = await opened();
    lanes.refuse();
    const { store, written } = fakeStore();
    await keeper.recordSave(store, A, "EL2", SECTION, "Six.", NOW);
    expect(written).toEqual([]);
  });

  it("never rejects when the write fails", async () => {
    const { keeper } = await opened();
    const { store } = fakeStore();
    vi.mocked(store.writeProperties).mockRejectedValue(new Error("offline"));
    await expect(
      keeper.recordSave(store, A, "EL2", SECTION, "Six.", NOW),
    ).resolves.toBeUndefined();
  });
});

describe("the visit's session", () => {
  it("stamps a new session once, however often the project settles", async () => {
    const { keeper, props } = await opened();
    const { store, written } = fakeStore();
    await keeper.settle(store, A, props, NOW.getTime());
    await keeper.settle(store, A, props, NOW.getTime());
    expect(written.map((p) => p.ui.session)).toEqual([
      { startedAt: NOW.toISOString(), words: 0 },
    ]);
  });

  it("settles another project's visit on its own", async () => {
    const { lanes, keeper, shape, props, catalogue } = await opened();
    const { store, written } = fakeStore();
    await keeper.settle(store, A, props, NOW.getTime());
    lanes.open(B, shape, props, catalogue);
    await keeper.settle(store, B, props, NOW.getTime());
    expect(written).toHaveLength(2);
  });

  it("keeps a session the writer is still in", async () => {
    const { keeper, props } = await opened();
    const { store, written } = fakeStore();
    const recent = { startedAt: "2026-11-03T11:00:00.000Z", words: 0 };
    await keeper.settle(
      store,
      A,
      { ...props, ui: { ...props.ui, session: recent } },
      NOW.getTime(),
    );
    expect(written).toEqual([]);
  });

  it("stamps each node's work at the exit, once", async () => {
    const { lanes, keeper } = await opened();
    const { store, written } = fakeStore();
    await keeper.recordSave(store, A, "EL2", SECTION, "Four five six.", NOW);
    const counted = lanes.properties as DocumentProperties;
    await keeper.settle(store, A, counted, NOW.getTime());
    await keeper.recordSave(store, A, "EL2", SECTION, "Four.", NOW);
    written.length = 0;

    await keeper.settleExit(store);
    await keeper.settleExit(store);
    expect(written).toHaveLength(1);
    expect(node(written[0], "EL2")?.lastDelta).toBe(-2);
  });

  it("writes nothing at the exit of a visit that changed nothing", async () => {
    const { keeper, props } = await opened();
    const { store, written } = fakeStore();
    await keeper.settle(store, A, props, NOW.getTime());
    written.length = 0;
    await keeper.settleExit(store);
    expect(written).toEqual([]);
  });

  it("writes nothing at an exit before the project settled", async () => {
    const { keeper } = await opened();
    const { store, written } = fakeStore();
    await keeper.settleExit(store);
    expect(written).toEqual([]);
  });
});

describe("the count backfill", () => {
  it("counts only the nodes the block does not hold, with no edit stamp", async () => {
    const { lanes, keeper, shape, props, catalogue } = await opened();
    const { store, written } = fakeStore();
    const { reader, read } = fakeReader();
    const held = {
      ...props,
      stats: { ...props.stats, perNode: [{ nodeId: "EL1", words: 3 }] },
    };
    lanes.open(A, shape, held, catalogue);
    await keeper.backfillCounts(store, reader, A, shape, held, () => true, NOW);
    expect(read).toEqual([SECTION]);
    expect(written[0].stats).toMatchObject({ words: 5, parts: 1, sections: 1 });
    expect(node(written[0], "EL2")).toEqual({ nodeId: "EL2", words: 2 });
  });

  it("reads and writes no more once a newer open started", async () => {
    const { keeper, shape, props } = await opened();
    const { store, written } = fakeStore();
    const { reader, read } = fakeReader();
    await keeper.backfillCounts(store, reader, A, shape, props, () => false);
    expect(read).toEqual([]);
    expect(written).toEqual([]);
  });

  it("stops between two reads once a newer open started", async () => {
    const { keeper, shape, props } = await opened();
    const { store, written } = fakeStore();
    const { reader, read } = fakeReader();
    const stillHere = () => read.length < 1;
    await keeper.backfillCounts(store, reader, A, shape, props, stillHere);
    expect(read).toEqual([PART]);
    expect(written).toEqual([]);
  });

  it("writes nothing when a newer open started after its last read", async () => {
    const { keeper, shape, props } = await opened();
    const { store, written } = fakeStore();
    const { reader, read } = fakeReader();
    const stillHere = () => read.length < 2;
    await keeper.backfillCounts(store, reader, A, shape, props, stillHere);
    expect(read).toEqual([PART, SECTION]);
    expect(written).toEqual([]);
  });

  it("is never read as this visit's work when it lands before the settle", async () => {
    const { lanes, keeper, shape, props } = await opened();
    const { store, written } = fakeStore();
    await keeper.backfillCounts(
      store,
      fakeReader().reader,
      A,
      shape,
      props,
      () => true,
    );
    // The settle sees the properties from before the backfill's write.
    await keeper.settle(store, A, props, NOW.getTime());
    expect(node(lanes.properties, "EL1")?.words).toBe(3);
    written.length = 0;
    await keeper.settleExit(store);
    expect(written).toEqual([]);
  });

  it("is never read as this visit's work when it lands after the settle", async () => {
    const { keeper, shape, props } = await opened();
    const { store, written } = fakeStore();
    await keeper.settle(store, A, props, NOW.getTime());
    await keeper.backfillCounts(
      store,
      fakeReader().reader,
      A,
      shape,
      props,
      () => true,
    );
    written.length = 0;
    await keeper.settleExit(store);
    expect(written).toEqual([]);
  });
});

describe("the hash backfill", () => {
  it("fills every missing hash in one write", async () => {
    const { keeper, shape } = await opened();
    const { store, written } = fakeStore();
    await keeper.backfillHashes(
      store,
      fakeReader().reader,
      A,
      shape,
      () => true,
    );
    expect(written).toHaveLength(1);
    expect(written[0].snapshotHashes[PART]).toBe(await hashOf(FILES[PART]));
    expect(written[0].snapshotHashes[SECTION]).toBe(
      await hashOf(FILES[SECTION]),
    );
  });

  it("stops between two reads once a newer open started", async () => {
    const { keeper, shape } = await opened();
    const { store, written } = fakeStore();
    const { reader, read } = fakeReader();
    const stillHere = () => read.length < 1;
    await keeper.backfillHashes(store, reader, A, shape, stillHere);
    expect(read).toEqual([PART]);
    expect(written).toEqual([]);
  });

  it("writes nothing when a newer open started after its last read", async () => {
    const { keeper, shape } = await opened();
    const { store, written } = fakeStore();
    const { reader, read } = fakeReader();
    const stillHere = () => read.length < 2;
    await keeper.backfillHashes(store, reader, A, shape, stillHere);
    expect(read).toEqual([PART, SECTION]);
    expect(written).toEqual([]);
  });

  it("never overwrites a hash a save set while it read", async () => {
    const { keeper, shape } = await opened();
    const { store, written } = fakeStore();
    const { reader } = fakeReader();
    // The save lands between the backfill's reads and its write.
    const save = vi.fn(() =>
      keeper.recordSave(store, A, "EL2", SECTION, "Saved now.", NOW),
    );
    const slow: ProjectReader<ProjectId> = {
      ...reader,
      snapshot: async (project, fileName) => {
        const text = await reader.snapshot(project, fileName);
        if (fileName === SECTION) void save();
        return text;
      },
    };
    await keeper.backfillHashes(store, slow, A, shape, () => true);
    const last = written[written.length - 1];
    expect(save).toHaveBeenCalledOnce();
    expect(last.snapshotHashes[SECTION]).toBe(await hashOf("Saved now."));
    expect(last.snapshotHashes[PART]).toBe(await hashOf(FILES[PART]));
  });

  it("writes nothing when every hash is there", async () => {
    const { keeper, shape } = await opened();
    const { store, written } = fakeStore();
    const { reader, read } = fakeReader();
    const hashed: DocumentStructure = {
      ...shape,
      children: shape.children.map((n) => ({
        ...n,
        snapshots: n.snapshots.map((s) => ({ ...s, contentHash: "x" })),
        children: [],
      })),
    };
    await keeper.backfillHashes(store, reader, A, hashed, () => true);
    expect(read).toEqual([]);
    expect(written).toEqual([]);
  });
});
