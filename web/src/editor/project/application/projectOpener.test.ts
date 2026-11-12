// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { hashOf } from "../../../text/hash";
import type { DocumentStructure } from "../../../project/types";
import { splitRecords, withRecords } from "../../project.fixture";
import type { ProjectId, ProjectReader } from "./stores";
import { readProject, verifySnapshotHashes } from "./projectOpener";

const A: ProjectId = { providerId: "fake", key: "a" };

// The snapshot records live in the catalogue; `withRecords` and
// `splitRecords` move the yaml's `snapshots:` blocks there, as the provider's
// own fixture does.
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
        title: Act One 1
        created: 2026-01-01T00:00:00.000Z
    children: []
`;

const SEEDED = splitRecords(withRecords(BARE_PROPS, STRUCTURE));
const PROPS = SEEDED.properties;
const CATALOGUE = SEEDED.catalogue;

interface Folder {
  props?: string | null;
  catalogue?: string | null;
  structure?: string | null;
  /** The Part and Section files; `null` for no `document/` folder. */
  files?: Record<string, string> | null;
  /** Whether the last sync's pull stopped partway. */
  pulling?: boolean;
}

/** A reader over one folder, with a log of what it was asked. */
function fakeReader({
  props = PROPS,
  catalogue = CATALOGUE,
  structure = STRUCTURE,
  files = { [PART]: "# Act One\n" },
  pulling = false,
}: Folder = {}) {
  const asked: string[] = [];
  const reader: ProjectReader<ProjectId> = {
    properties: vi.fn(async () => {
      asked.push("properties");
      return props;
    }),
    catalogue: vi.fn(async () => {
      asked.push("catalogue");
      return catalogue;
    }),
    structure: vi.fn(async () => {
      asked.push("structure");
      return structure;
    }),
    snapshot: vi.fn(async (_project, fileName) => {
      asked.push(`snapshot ${fileName}`);
      return files?.[fileName] ?? null;
    }),
    documentFiles: vi.fn(async () => {
      asked.push("documentFiles");
      if (files === null) throw new Error("no document folder");
      return Object.keys(files);
    }),
    pullUnfinished: vi.fn(async () => pulling),
  };
  return { reader, asked };
}

const codes = (verdict: Awaited<ReturnType<typeof readProject>>) =>
  verdict && !verdict.ok ? verdict.errors.map((e) => e.code) : verdict;

describe("readProject", () => {
  it("loads a project whose folder matches its yaml", async () => {
    const { reader } = fakeReader();
    const verdict = await readProject(reader, A, "a");
    expect(verdict?.ok).toBe(true);
    if (!verdict?.ok) return;
    expect(verdict.structure.children.map((n) => n.id)).toEqual(["EL1"]);
    expect(verdict.properties.document.title).toBe("Once Dark");
  });

  it("refuses an empty folder as no project", async () => {
    const { reader } = fakeReader({ props: null, structure: null, files: {} });
    expect(codes(await readProject(reader, A, "a"))).toEqual([
      "missingProperties",
    ]);
  });

  it("refuses prose with no properties file, so no scaffold writes over it", async () => {
    const { reader } = fakeReader({ props: null, structure: null });
    expect(codes(await readProject(reader, A, "a"))).toEqual([
      "documentNotEmpty",
    ]);
  });

  it("refuses a properties file it cannot parse", async () => {
    const { reader, asked } = fakeReader({ props: "{" });
    expect(codes(await readProject(reader, A, "a"))).toEqual([
      "propertiesParse",
    ]);
    expect(asked).toEqual(["properties"]);
  });

  it("refuses a missing catalogue, never reading it as one with no snapshots", async () => {
    const { reader, asked } = fakeReader({ catalogue: null });
    expect(codes(await readProject(reader, A, "a"))).toEqual([
      "missingCatalogue",
    ]);
    expect(asked).toEqual(["properties", "catalogue"]);
  });

  it("refuses a catalogue that is not JSON, or whose blocks are not maps", async () => {
    for (const catalogue of ["{", "[]", '{"snapshots": []}', '{"binned": 3}']) {
      const { reader } = fakeReader({ catalogue });
      expect(codes(await readProject(reader, A, "a"))).toEqual([
        "catalogueParse",
      ]);
    }
  });

  it("joins each file's stored hash to its record", async () => {
    const hash = "b".repeat(64);
    const props = JSON.stringify({
      ...JSON.parse(PROPS),
      snapshotHashes: { [PART]: hash },
    });
    const { reader } = fakeReader({ props });
    const verdict = await readProject(reader, A, "a");
    expect(verdict?.ok && verdict.structure.children[0].snapshots[0]).toEqual(
      expect.objectContaining({ file: PART, contentHash: hash }),
    );
  });

  it("refuses a missing yaml", async () => {
    const { reader } = fakeReader({ structure: null });
    const verdict = await readProject(reader, A, "a");
    expect(verdict?.ok).toBe(false);
  });

  it("refuses a folder with no document folder", async () => {
    const { reader } = fakeReader({ files: null });
    expect(codes(await readProject(reader, A, "a"))).toEqual([
      "missingDocumentDir",
    ]);
  });

  it("refuses a yaml that names a file the folder does not hold", async () => {
    const { reader } = fakeReader({ files: {} });
    const verdict = await readProject(reader, A, "a");
    expect(verdict?.ok).toBe(false);
  });

  it("refuses a file the yaml does not name", async () => {
    const { reader } = fakeReader({
      files: { [PART]: "# Act One\n", "part--stray.EL9.00.md": "" },
    });
    const verdict = await readProject(reader, A, "a");
    expect(verdict?.ok).toBe(false);
  });

  it("says the sync did not finish when only unlisted files and the mark are there", async () => {
    const { reader } = fakeReader({
      files: { [PART]: "# Act One\n", "part--stray.EL9.00.md": "" },
      pulling: true,
    });
    expect(codes(await readProject(reader, A, "a"))).toEqual([
      "syncUnfinished",
    ]);
  });

  it("keeps the plain refusal for a missing file, mark or not", async () => {
    const { reader } = fakeReader({ files: {}, pulling: true });
    expect(codes(await readProject(reader, A, "a"))).toEqual(["filesMissing"]);
  });

  it("stops reading once a newer open has started", async () => {
    const { reader, asked } = fakeReader();
    let open = true;
    vi.mocked(reader.properties).mockImplementation(async () => {
      asked.push("properties");
      open = false;
      return PROPS;
    });
    expect(await readProject(reader, A, "a", () => open)).toBeNull();
    expect(asked).toEqual(["properties"]);
  });

  // Each read the open makes, and the folder that read is the last one for:
  // the newer open starts while it runs, so the verdict must be null.
  it.each([
    ["the catalogue read", "catalogue", {}],
    ["the structure read", "structure", {}],
    ["the document listing", "documentFiles", {}],
    ["a document listing that fails", "documentFiles", { files: null }],
    [
      "the look for prose with no properties file",
      "documentFiles",
      { props: null, structure: null },
    ],
  ] as const)(
    "answers nothing when a newer open starts during %s",
    async (_, read, folder) => {
      const { reader } = fakeReader(folder);
      let open = true;
      const real = vi.mocked(reader[read]).getMockImplementation() as (
        ...args: unknown[]
      ) => Promise<unknown>;
      vi.mocked(reader[read]).mockImplementation((async (
        ...args: unknown[]
      ) => {
        try {
          return await real(...args);
        } finally {
          open = false;
        }
      }) as never);
      expect(await readProject(reader, A, "a", () => open)).toBeNull();
    },
  );

  it("lets a read no check covers throw", async () => {
    const { reader } = fakeReader();
    vi.mocked(reader.structure).mockRejectedValue(new Error("offline"));
    await expect(readProject(reader, A, "a")).rejects.toThrow("offline");
  });
});

describe("verifySnapshotHashes", () => {
  const tree = (
    snapshots: Array<{ file: string; contentHash?: string }>,
  ): DocumentStructure =>
    ({
      children: [{ id: "EL1", title: "Act One", snapshots, children: [] }],
    }) as unknown as DocumentStructure;

  it("marks a node whose snapshot changed outside the editor", async () => {
    const { reader } = fakeReader({ files: { [PART]: "edited elsewhere" } });
    const result = await verifySnapshotHashes(
      reader,
      A,
      tree([{ file: PART, contentHash: await hashOf("# Act One\n") }]),
    );
    expect([...result.mismatched]).toEqual(["EL1"]);
    expect(result.warnings).toEqual([
      {
        code: "contentHashMismatch",
        values: { id: "EL1", title: "Act One", file: PART },
      },
    ]);
  });

  it("passes a snapshot whose text matches its hash", async () => {
    const { reader } = fakeReader();
    const result = await verifySnapshotHashes(
      reader,
      A,
      tree([{ file: PART, contentHash: await hashOf("# Act One\n") }]),
    );
    expect(result.mismatched.size).toBe(0);
  });

  it("reads nothing for a hash not yet computed", async () => {
    const { reader } = fakeReader();
    const result = await verifySnapshotHashes(
      reader,
      A,
      tree([{ file: PART }]),
    );
    expect(result.mismatched.size).toBe(0);
    expect(reader.snapshot).not.toHaveBeenCalled();
  });

  it("passes a snapshot it cannot read", async () => {
    const { reader } = fakeReader({ files: {} });
    const result = await verifySnapshotHashes(
      reader,
      A,
      tree([{ file: PART, contentHash: "abc" }]),
    );
    expect(result.mismatched.size).toBe(0);
  });
});
