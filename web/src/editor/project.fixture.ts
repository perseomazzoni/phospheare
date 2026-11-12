// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { expect, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  StorageError,
  ROOT_PATH,
  baseName,
  joinPath,
  parentPath,
  type Access,
  type DirEntry,
  type ProjectRef,
  type FileFingerprint,
  type StorageProvider,
} from "../storage";
import type { IconName } from "../ui/icons";
import {
  PROPERTIES_FILE,
  SNAPSHOTS_CATALOGUE_FILE,
  STRUCTURE_FILE,
  filePath,
} from "../project/naming";
import { parseStructure } from "../project/structure";
import { parseProperties, reconcileRecords } from "../project/properties";
import { readCatalogue, withHashes } from "../project/snapshotCatalogue";
import type {
  DocumentStructure,
  Snapshot,
  SnapshotCatalogue,
} from "../project/types";

// ── The fake storage ─────────────────────────────────────────────────────────
//
// The same Map-shaped provider the app seeds for the demo document, created
// per test so a structural change never leaks into the next test. Its id is
// not the local provider's, so the Drive-recents branch in the open pipeline
// stays off. A test that needs the picker borrows the "local" identity for
// one row; that changes only which connection reconnect asks, never which
// provider the re-read runs through.

export class FakeProvider implements StorageProvider {
  readonly id = "fake";
  // A device: the files are in a Map on this machine and nothing commits
  // them anywhere. Declaring "remote" would make every card built on it offer
  // the remote-only actions.
  readonly kind = "device" as const;
  readonly label = () => "Fake storage";
  readonly icon: IconName = "mark";
  files = new Map<string, string>();
  emptyDirs = new Set<string>();
  available = true;
  grant = true;

  isAvailable = () => this.available;
  reopenProject = vi.fn(async () => this.grant);
  // The open pipeline queries access at mount and never requests it;
  // only the click-driven reconnect consumes `grant` through
  // `reopenProject`. Both read `grant`, so "lapsed" means lapsed through
  // either path.
  canAccess = vi.fn(async (): Promise<Access> =>
    this.grant ? "granted" : "needs-gesture",
  );
  listDir = vi.fn(
    async (_ref: ProjectRef, path: string): Promise<DirEntry[]> => {
      const prefix = path === ROOT_PATH ? ROOT_PATH : `${path}/`;
      const seen = new Map<string, DirEntry>();
      for (const filePath of this.files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (rest.length === 0) continue;
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        seen.set(name, {
          path: joinPath(path, name),
          name,
          kind: slash === -1 ? "file" : "folder",
        });
      }
      for (const dir of this.emptyDirs) {
        if (parentPath(dir) === path && !seen.has(baseName(dir))) {
          seen.set(baseName(dir), {
            path: dir,
            name: baseName(dir),
            kind: "folder",
          });
        }
      }
      if (seen.size === 0 && path !== ROOT_PATH && !this.emptyDirs.has(path)) {
        throw new StorageError(`Folder not found: ${path}`, "not-found");
      }
      return [...seen.values()];
    },
  );
  exists = vi.fn(async (_ref: ProjectRef, path: string) =>
    this.files.has(path),
  );
  readFile = vi.fn(async (_ref: ProjectRef, path: string): Promise<string> => {
    const content = this.files.get(path);
    if (content === undefined)
      throw new StorageError(`File not found: ${path}`, "not-found");
    return content;
  });
  writeFile = vi.fn(
    async (_ref: ProjectRef, path: string, content: string): Promise<void> => {
      this.files.set(path, content);
      this.emptyDirs.delete(parentPath(path));
    },
  );
  createDir = vi.fn(async (_ref: ProjectRef, path: string): Promise<void> => {
    this.emptyDirs.add(path);
  });
  renameFile = vi.fn(
    async (_ref: ProjectRef, path: string, newName: string): Promise<void> => {
      const content = this.files.get(path);
      if (content === undefined)
        throw new StorageError(`File not found: ${path}`, "not-found");
      this.files.delete(path);
      this.files.set(joinPath(parentPath(path), newName), content);
    },
  );
  moveFile = vi.fn(
    async (
      _ref: ProjectRef,
      fromPath: string,
      toDir: string,
    ): Promise<void> => {
      const content = this.files.get(fromPath);
      if (content === undefined)
        throw new StorageError(`File not found: ${fromPath}`, "not-found");
      this.files.delete(fromPath);
      this.files.set(joinPath(toDir, baseName(fromPath)), content);
      this.emptyDirs.delete(toDir);
    },
  );
  removeFile = vi.fn(async (_ref: ProjectRef, path: string): Promise<void> => {
    this.files.delete(path);
  });
  // Mandatory on `StorageProvider`, but the editor's suites do not
  // exercise sync, so a fixed stand-in satisfies the port. `sync/scan.test.ts`
  // and `sync/check.test.ts` cover fingerprinting against the real providers.
  fingerprintFile = vi.fn(async (): Promise<FileFingerprint> => ({
    hash: "fake",
  }));
  fingerprintDir = vi.fn(
    async (): Promise<Map<string, FileFingerprint>> => new Map(),
  );
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Copies a structure fixture's per-node records (snapshots and summary
 * bindings) into its properties fixture. The open pipeline reads those records
 * from `document-properties.json`, and fixtures that write them in the yaml
 * would otherwise lose their summaries or refuse to open. A properties fixture
 * that already carries a block keeps it; only missing blocks are filled in.
 */
export function withRecords(propsYaml: string, structureYaml: string): string {
  let props: Record<string, unknown>;
  try {
    props = JSON.parse(propsYaml) as Record<string, unknown>;
  } catch {
    // Unparseable properties: a damaged-project fixture, which the open
    // pipeline must refuse, not this relocator.
    return propsYaml;
  }
  const needSnapshots = !props.snapshots;
  const needSummaries = !props.summaries;
  if (!needSnapshots && !needSummaries) return propsYaml;
  let structure: { document?: unknown[]; removed?: unknown[] };
  try {
    structure = parseYaml(structureYaml) as {
      document?: unknown[];
      removed?: unknown[];
    };
  } catch {
    // Unparseable yaml: a damaged-project fixture. The open pipeline reports
    // the line number, so this relocator must not swallow it.
    return propsYaml;
  }
  const snapshots: Record<string, unknown> = {};
  const summaries: Record<string, unknown> = {};
  const collect = (entries: unknown[] | undefined) => {
    for (const entry of entries ?? []) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== "string") continue;
      if (Array.isArray(row.snapshots)) snapshots[row.id] = row.snapshots;
      if (typeof row.summary === "string" && row.summary.length > 0) {
        summaries[row.id] = row.summary;
      }
      if (Array.isArray(row.children)) collect(row.children);
    }
  };
  collect(structure.document);
  collect(structure.removed);
  if (needSnapshots) props.snapshots = snapshots;
  if (needSummaries) props.summaries = summaries;
  return JSON.stringify(props, null, 2);
}

/**
 * A properties fixture's records, split as a project keeps them: the
 * snapshot lists in the catalogue, their hashes in the properties file's
 * `snapshotHashes`. Fixtures write the records in one place, the shape the
 * tests read most easily; this puts them where the open pipeline reads them.
 * An unparseable fixture is a damaged project: its properties go as they are,
 * with no catalogue.
 */
export function splitRecords(propsJson: string): {
  properties: string;
  catalogue: string | null;
} {
  let props: Record<string, unknown>;
  try {
    props = JSON.parse(propsJson) as Record<string, unknown>;
  } catch {
    return { properties: propsJson, catalogue: null };
  }
  type Row = { file: string; contentHash?: string };
  const hashes: Record<string, string> = {
    ...((props.snapshotHashes as Record<string, string>) ?? {}),
  };
  const strip = (block: unknown) =>
    Object.fromEntries(
      Object.entries((block as Record<string, Row[]>) ?? {}).map(
        ([id, list]) => [
          id,
          Array.isArray(list)
            ? list.map((row) => {
                if (!row || typeof row !== "object") return row;
                const { contentHash, ...rest } = row;
                if (contentHash) hashes[rest.file] = contentHash;
                return rest;
              })
            : list,
        ],
      ),
    );
  const catalogue = {
    snapshots: strip(props.snapshots),
    binned: strip(props.binnedSnapshots),
  };
  delete props.snapshots;
  delete props.binnedSnapshots;
  if (Object.keys(hashes).length > 0) props.snapshotHashes = hashes;
  return {
    properties: JSON.stringify(props, null, 2),
    catalogue: JSON.stringify(catalogue, null, 2),
  };
}

/**
 * Seeds a project's properties and catalogue from a properties fixture that
 * carries its records, and from the structure fixture's own records when it
 * carries none (`withRecords`).
 */
export function seedRecords(
  provider: FakeProvider,
  propsJson: string,
  structureYaml: string,
): void {
  seedProps(provider, withRecords(propsJson, structureYaml));
}

/** Seeds a properties fixture that carries its records (`splitRecords`). */
export function seedProps(provider: FakeProvider, propsJson: string): void {
  const { properties, catalogue } = splitRecords(propsJson);
  provider.files.set(PROPERTIES_FILE, properties);
  if (catalogue !== null)
    provider.files.set(SNAPSHOTS_CATALOGUE_FILE, catalogue);
}

/**
 * Seeds one file of a test's `files` override. A properties file is split
 * like every other properties fixture, so an override written with its
 * records still opens.
 */
export function seedFile(
  provider: FakeProvider,
  path: string,
  content: string,
): void {
  if (path === PROPERTIES_FILE) seedProps(provider, content);
  else provider.files.set(path, content);
}

export const PROPS = `{
  "schemaVersion": 1,
  "document": {
    "id": "doc-1",
    "title": "Once Dark",
    "type": "Novel",
    "structure": "threeact",
    "language": "en",
    "goal": 4800,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "sync": null,
  "ui": { "expanded": ["EL1"], "lastOpened": "EL2" },
  "stats": { "words": 0, "parts": 0, "sections": 0, "countedAt": "2026-01-01T00:00:00.000Z", "perNode": [] },
  "snapshots": {
    "EL1": [{ "file": "part--act_one.EL1.00.md", "title": "Act One 1", "created": "2026-01-01T00:00:00.000Z" }],
    "EL2": [{ "file": "section--opening.EL2.00.md", "title": "Opening 1", "created": "2026-01-01T00:00:00.000Z" }],
    "EL3": [
      { "file": "section--the_storm.EL3.00.md", "title": "The Storm 1", "created": "2026-01-01T00:00:00.000Z" },
      { "file": "section--the_storm.EL3.01.md", "title": "The Storm 2", "created": "2026-02-01T00:00:00.000Z" }
    ],
    "EL4": [{ "file": "part--act_two.EL4.00.md", "title": "Act Two 1", "created": "2026-01-01T00:00:00.000Z" }]
  }
}
`;

export const STRUCTURE = `# Phospheare — document structure
# The order of this list is the order of the finished document.
# Phospheare rewrites this file when the structure changes; comments below are not preserved.
version: 1
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

export const DEFAULT_FILES: Record<string, string> = {
  [filePath("part--act_one.EL1.00.md")]: "# Act One\n",
  [filePath("part--act_two.EL4.00.md")]: "# Act Two\n",
  [filePath("section--opening.EL2.00.md")]:
    "The house had been empty for a year.\n",
  [filePath("section--the_storm.EL3.00.md")]:
    "It came in from the south, a slow darkening.\n",
  [filePath("section--the_storm.EL3.01.md")]:
    "It came in from the west, without warning.\n",
};

// ── Reading back what was written ────────────────────────────────────────────

export function structureOf(provider: FakeProvider): DocumentStructure {
  const raw = provider.files.get(STRUCTURE_FILE);
  const result = parseStructure(raw ?? null);
  expect(result.ok).toBe(true);
  // The expect is the assertion; the throw narrows the type, so a bad fixture
  // fails here with a message instead of crashing downstream.
  if (!result.ok) throw new Error("structureOf: structure file did not parse");
  // The records live in the catalogue and the properties file. Attach them
  // as the open pipeline does, so tests read the same reassembled model the
  // app holds.
  const rawProps = provider.files.get(PROPERTIES_FILE) ?? null;
  const props = parseProperties(rawProps, "Once Dark");
  const catalogue = catalogueOf(provider);
  const reconciled = reconcileRecords(
    result.structure,
    withHashes(catalogue.snapshots, props.snapshotHashes),
    props.summaries,
  );
  if (!reconciled.ok) {
    throw new Error(
      `structureOf: records did not reconcile: ${reconciled.errors[0]?.code}`,
    );
  }
  return reconciled.structure;
}

/** The catalogue as last written; a test fails here when it is not valid. */
export function catalogueOf(provider: FakeProvider): SnapshotCatalogue {
  const read = readCatalogue(
    provider.files.get(SNAPSHOTS_CATALOGUE_FILE) ?? null,
  );
  if (!read.ok) throw new Error(`catalogueOf: ${read.error.code}`);
  return read.catalogue;
}

/**
 * The live snapshot records as last written, each with its stored hash joined
 * on, the shape the open pipeline attaches.
 */
export function hashedRecordsOf(
  provider: FakeProvider,
): Record<string, Snapshot[]> {
  const props = parseProperties(
    provider.files.get(PROPERTIES_FILE) ?? null,
    "Once Dark",
  );
  return withHashes(catalogueOf(provider).snapshots, props.snapshotHashes);
}

export function propsOf(provider: FakeProvider): Record<string, unknown> {
  return JSON.parse(provider.files.get(PROPERTIES_FILE) ?? "{}");
}
