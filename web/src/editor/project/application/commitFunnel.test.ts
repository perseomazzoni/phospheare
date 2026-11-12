// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type {
  SnapshotCatalogue,
  DocumentStructure,
} from "../../../project/types";
import { splitRecords, withRecords } from "../../project.fixture";
import type { MetadataStore, ProjectId, ProjectReader } from "./stores";
import { commitChange, RollbackIncomplete } from "./commitFunnel";
import { MetadataLanes } from "./metadataLanes";
import { readProject } from "./projectOpener";

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

const STRUCTURE = `version: 1
document:
  - id: EL1
    part: Act One
    adopted: ${PART}
    snapshots:
      - file: ${PART}
        title: Act One
        created: 2026-01-01T00:00:00.000Z
    children: []
`;

/** The node's title and its snapshot's title both become `label`, so the
 * yaml and the records each show which structure they were written from. */
function labelled(shape: DocumentStructure, label: string): DocumentStructure {
  const [node, ...rest] = shape.children;
  return {
    ...shape,
    children: [
      {
        ...node,
        title: label,
        snapshots: node.snapshots.map((s) => ({ ...s, title: label })),
      },
      ...rest,
    ],
  };
}

const yamlLabel = (s: DocumentStructure | null) => s?.children[0]?.title;
const recordLabel = (c: SnapshotCatalogue) => c.snapshots.EL1?.[0]?.title;

/** A store and file moves that log, in one list, what happened in what order. */
function rig() {
  const log: string[] = [];
  const store: MetadataStore<ProjectId> = {
    writeStructure: vi.fn(async (project, structure) => {
      log.push(`${project.key}:yaml:${yamlLabel(structure)}`);
    }),
    // The properties write carries the hashes and summaries; the records
    // the order is about are the catalogue's.
    writeProperties: vi.fn(async () => {}),
    writeCatalogue: vi.fn(async (project, catalogue) => {
      log.push(`${project.key}:records:${recordLabel(catalogue)}`);
    }),
  };
  const applyFiles = vi.fn(async () => {
    log.push("files");
  });
  const revertFiles = vi.fn(async () => {
    log.push("files back");
  });
  const failed = vi.fn((error: unknown) => {
    log.push(`error: ${(error as Error).message}`);
  });
  return { log, store, applyFiles, revertFiles, failed };
}

async function opened() {
  const seeded = splitRecords(withRecords(BARE_PROPS, STRUCTURE));
  const reader: ProjectReader<ProjectId> = {
    properties: async () => seeded.properties,
    catalogue: async () => seeded.catalogue,
    structure: async () => STRUCTURE,
    snapshot: async () => "",
    documentFiles: async () => [PART],
    pullUnfinished: async () => false,
  };
  const verdict = await readProject(reader, A, "a");
  if (!verdict?.ok) throw new Error("the fixture does not open");
  const shown: Array<string | undefined> = [];
  const lanes = new MetadataLanes<ProjectId>({
    structure: (s) => shown.push(yamlLabel(s)),
    properties: () => {},
    catalogue: () => {},
  });
  lanes.open(A, verdict.structure, verdict.properties, verdict.catalogue);
  shown.length = 0;
  return {
    lanes,
    shown,
    shape: verdict.structure,
    props: verdict.properties,
    catalogue: verdict.catalogue,
  };
}

describe("commitChange", () => {
  it("moves the files, then writes the yaml, then the records, and undoes all three metadata first", async () => {
    const { lanes, shown, shape } = await opened();
    const { log, store, applyFiles, revertFiles } = rig();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Act Two"),
      applyFiles,
      revertFiles,
      writeRecords: true,
    });
    expect(log).toEqual(["files", "a:yaml:Act Two", "a:records:Act Two"]);
    expect(yamlLabel(lanes.structure)).toBe("Act Two");

    log.length = 0;
    if (!outcome?.ok || !outcome.undo) throw new Error("no undo");
    await outcome.undo();
    expect(log).toEqual(["a:yaml:Act One", "a:records:Act One", "files back"]);
    expect(shown).toEqual(["Act Two", "Act One"]);
  });

  it("writes only the yaml unless the records changed", async () => {
    const { lanes, shape } = await opened();
    const { log, store } = rig();
    await commitChange(lanes, store, { next: labelled(shape, "Act Two") });
    expect(log).toEqual(["a:yaml:Act Two"]);
  });

  it("shows a records-only change once its write lands, and shows it back on undo", async () => {
    const { lanes, shown, shape } = await opened();
    const { log, store } = rig();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Retitled"),
      writeStructure: false,
      writeRecords: true,
    });
    expect(log).toEqual(["a:records:Retitled"]);
    expect(shown).toEqual(["Retitled"]);

    if (!outcome?.ok || !outcome.undo) throw new Error("no undo");
    await outcome.undo();
    expect(log).toEqual(["a:records:Retitled", "a:records:Act One"]);
    expect(shown).toEqual(["Retitled", "Act One"]);
  });

  it("reports a failed file move, then puts the files back and writes no metadata", async () => {
    const { lanes, shape } = await opened();
    const { log, store, revertFiles, failed } = rig();
    const outcome = await commitChange(
      lanes,
      store,
      {
        next: labelled(shape, "Act Two"),
        applyFiles: async () => {
          throw new Error("disk full");
        },
        revertFiles,
        writeRecords: true,
      },
      failed,
    );
    expect(outcome).toEqual({ ok: false, restored: true });
    expect(log).toEqual(["error: disk full", "files back"]);
    expect(yamlLabel(lanes.structure)).toBe("Act One");
  });

  it("reports a failed metadata write, then puts the files and the metadata files back", async () => {
    const { lanes, shape } = await opened();
    const { log, store, applyFiles, revertFiles, failed } = rig();
    vi.mocked(store.writeCatalogue).mockRejectedValueOnce(new Error("offline"));
    const outcome = await commitChange(
      lanes,
      store,
      {
        next: labelled(shape, "Act Two"),
        applyFiles,
        revertFiles,
        writeRecords: true,
      },
      failed,
    );
    expect(outcome).toEqual({ ok: false, restored: true });
    expect(log).toEqual([
      "files",
      "a:yaml:Act Two",
      "error: offline",
      "files back",
      "a:yaml:Act One",
      "a:records:Act One",
    ]);
    expect(yamlLabel(lanes.structure)).toBe("Act One");
  });

  it("reports the first error once when the rollback fails too", async () => {
    const { lanes, shape } = await opened();
    const { store, failed } = rig();
    vi.mocked(store.writeStructure).mockRejectedValue(new Error("offline"));
    const outcome = await commitChange(
      lanes,
      store,
      {
        next: labelled(shape, "Act Two"),
        revertFiles: async () => {
          throw new Error("stuck");
        },
      },
      failed,
    );
    // The yaml never went back, so the outcome says the folder may differ
    // from what is shown.
    expect(outcome).toEqual({ ok: false, restored: false });
    expect(failed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledWith(new Error("offline"));
  });

  it("tries nothing while no project is open", async () => {
    const { lanes, shape } = await opened();
    lanes.refuse();
    const { log, store, applyFiles } = rig();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Act Two"),
      applyFiles,
    });
    expect(outcome).toBeNull();
    expect(log).toEqual([]);
  });

  it("lands in its own folder and offers no undo once another project is open", async () => {
    const { lanes, shown, shape, props, catalogue } = await opened();
    const { log, store } = rig();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Act Two"),
      applyFiles: async () => {
        lanes.open(B, labelled(shape, "Other"), props, catalogue);
      },
    });
    expect(outcome).toEqual({ ok: true, undo: null });
    expect(log).toEqual(["a:yaml:Act Two"]);
    expect(yamlLabel(lanes.structure)).toBe("Other");
    expect(shown).toEqual(["Other"]);
  });

  it("shows nothing on undo once another project is open", async () => {
    const { lanes, shown, shape, props, catalogue } = await opened();
    const { log, store } = rig();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Retitled"),
      writeStructure: false,
      writeRecords: true,
    });
    lanes.open(B, labelled(shape, "Other"), props, catalogue);
    shown.length = 0;
    log.length = 0;
    if (!outcome?.ok || !outcome.undo) throw new Error("no undo");
    await outcome.undo();
    expect(log).toEqual([]);
    expect(yamlLabel(lanes.structure)).toBe("Other");
    expect(shown).toEqual([]);
  });

  it("touches no file and puts the metadata forward again when the undo's metadata write fails", async () => {
    // A created file, as adding a node makes it: its bytes change after the
    // commit, and a failed undo must leave them as the writer saved them.
    const { lanes, shown, shape } = await opened();
    const { store } = rig();
    const disk = new Map<string, string>();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Act Two"),
      applyFiles: async () => {
        disk.set("part--new.EL2.00.md", "");
      },
      revertFiles: async () => {
        disk.delete("part--new.EL2.00.md");
      },
      writeRecords: true,
    });
    disk.set("part--new.EL2.00.md", "Prose saved after the add.");
    vi.mocked(store.writeCatalogue).mockRejectedValueOnce(new Error("offline"));
    if (!outcome?.ok || !outcome.undo) throw new Error("no undo");
    await expect(outcome.undo()).rejects.toThrow("offline");
    expect(disk.get("part--new.EL2.00.md")).toBe("Prose saved after the add.");
    expect(yamlLabel(lanes.structure)).toBe("Act Two");
    expect(lanes.catalogue && recordLabel(lanes.catalogue)).toBe("Act Two");
    expect(shown[shown.length - 1]).toBe("Act Two");
  });

  it("puts the metadata forward again when the undo's files cannot move back", async () => {
    const { lanes, shape } = await opened();
    const { log, store, applyFiles, revertFiles } = rig();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Act Two"),
      applyFiles,
      revertFiles,
    });
    revertFiles.mockRejectedValueOnce(new Error("stuck"));
    log.length = 0;
    if (!outcome?.ok || !outcome.undo) throw new Error("no undo");
    await expect(outcome.undo()).rejects.toThrow("stuck");
    expect(log).toEqual(["a:yaml:Act One", "a:yaml:Act Two"]);
    expect(yamlLabel(lanes.structure)).toBe("Act Two");
  });

  it("says so when the undo's metadata cannot go forward again either", async () => {
    const { lanes, shape } = await opened();
    const { store, applyFiles, revertFiles } = rig();
    const outcome = await commitChange(lanes, store, {
      next: labelled(shape, "Act Two"),
      applyFiles,
      revertFiles,
    });
    revertFiles.mockRejectedValueOnce(new Error("stuck"));
    // The yaml goes back fine; it is the write forward again that fails.
    vi.mocked(store.writeStructure).mockImplementation(async (_, structure) => {
      if (yamlLabel(structure) === "Act Two") throw new Error("offline");
    });
    if (!outcome?.ok || !outcome.undo) throw new Error("no undo");
    const failure = await outcome.undo().then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RollbackIncomplete);
    expect((failure as RollbackIncomplete).cause).toEqual(new Error("stuck"));
  });
});
