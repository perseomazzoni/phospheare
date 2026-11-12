// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef, StorageProvider } from "../storage";
import {
  ASSISTANT_DIR,
  ASSISTANT_MEMORY_DIR,
  DOCUMENT_DIR,
  REFERENCE_DIR,
  PROPERTIES_FILE,
  SNAPSHOTS_CATALOGUE_FILE,
  STRUCTURE_FILE,
} from "./naming";
import { commentsFilePath, filePath } from "./naming";
import { emptyStructure, recordsOf, serializeStructure } from "./structure";
import { defaultProperties, serializeProperties } from "./properties";
import {
  emptyCatalogue,
  hashesFor,
  serializeCatalogue,
  withRecords,
} from "./snapshotCatalogue";
import { buildStats } from "./stats";
import type { DocumentMeta, DocumentProperties, NodeStat } from "./types";
import type { StartingShape } from "./startingShape";
import type { CreateStepId } from "./createSteps";

/**
 * What the creator can seed the project with beyond the defaults.
 *
 * `shape` lays out the nodes and their files; `document` carries the creation
 * choices into `document-properties.json`. The structure id stored is the one
 * the shape was built from. An omitted field keeps the default rather than
 * being spread in as `undefined`, which would drop the key at serialization.
 *
 * `stats` is the per-node count of a shape that arrives with words, an
 * imported manuscript. A blank project's count is an empty list.
 */
export interface ScaffoldInit {
  shape?: StartingShape;
  document?: Partial<
    Pick<
      DocumentMeta,
      | "title"
      | "author"
      | "type"
      | "language"
      | "goal"
      | "structure"
      | "genres"
      | "ageCategory"
      | "tropes"
    >
  >;
  stats?: NodeStat[];
  /**
   * Comments files to write, one per node, already serialised: the comments
   * an import brings. The scaffold only places them; their content belongs to
   * the comments module.
   */
  comments?: { nodeId: string; content: string }[];
}

/**
 * A project the Library is asked to make: where, under which folder name, and
 * what goes in it. The one hand-off between a flow that prepares a project
 * (the creation wizard, the import) and the Library's `createFrom`, which
 * turns it into a folder, a scaffold and a card. It lives in
 * `project/` because both sides may name it and neither may name the other.
 */
export interface ProjectSeed {
  destination: "local" | "drive";
  folderName: string;
  init: ScaffoldInit;
}

/**
 * How many document files are written at once. Drive answers each write in a
 * round trip, so a few hundred chapters in sequence take minutes, while more
 * than a handful at once only queue in the browser and against the API's rate
 * limit. Four hides latency without tripping a 429.
 */
const WRITE_POOL = 4;

/**
 * Turn an empty folder into a project.
 *
 * Two paths reach it, the editor scaffolding a folder the writer opened and
 * the workspace creating a project in Remote Storage, and the projects they
 * make must be indistinguishable.
 *
 * `assistant/` and `reference/` are created from the start, so the assistant
 * can assume every project has them.
 *
 * The shape's files are written before the manifest that names them, so a
 * copy interrupted halfway leaves a folder with neither properties nor yaml,
 * which the editor offers to scaffold, rather than a yaml naming Parts that
 * are not there, which it refuses to open. Interrupted between the two
 * writes, the folder holds properties but no yaml: refused as invalid, with
 * the creation facts left for a human to read.
 *
 * `onStep` names the `CREATE_STEPS` segment just finished, fired only after
 * the await it describes resolves, so the bar never reports work not done and
 * a failed step stops the sequence. The caller reports `folder` and `adopt`,
 * the steps it performs.
 */
export async function scaffoldProject(
  provider: StorageProvider,
  ref: ProjectRef,
  init?: ScaffoldInit,
  onStep?: (id: CreateStepId) => void,
  onFile?: (done: number, total: number) => void,
): Promise<void> {
  const structure = init?.shape?.structure ?? emptyStructure();
  // The title the writer typed, not the folder it became: the ref's name is
  // the folder name, "once-dark" for "Once Dark", and would reach the shelf,
  // the export's title page and the EPUB's metadata.
  const base = defaultProperties(init?.document?.title ?? ref.name);
  const props: DocumentProperties = {
    ...base,
    document: {
      ...base.document,
      author: init?.document?.author ?? base.document.author,
      type: init?.document?.type ?? base.document.type,
      language: init?.document?.language ?? base.document.language,
      goal: init?.document?.goal ?? base.document.goal,
      structure: init?.document?.structure ?? base.document.structure,
      genres: init?.document?.genres ?? base.document.genres,
      ageCategory: init?.document?.ageCategory ?? base.document.ageCategory,
      tropes: init?.document?.tropes ?? base.document.tropes,
    },
  };

  await provider.createDir(ref, DOCUMENT_DIR);
  const files = init?.shape?.files ?? [];
  let done = 0;
  await pooled(files, WRITE_POOL, async (file) => {
    await provider.writeFile(ref, filePath(file.fileName), file.content);
    done += 1;
    onFile?.(done, files.length);
  });
  // The comments go with the documents, before the manifest, so an
  // interrupted copy leaves no manifest describing a half-written margin.
  await pooled(init?.comments ?? [], WRITE_POOL, async (file) => {
    await provider.writeFile(ref, commentsFilePath(file.nodeId), file.content);
  });
  onStep?.("documents");

  // The seeded structure's records live beside the yaml, not in it: the
  // snapshots in the catalogue, their hashes and the summaries in the
  // properties file. The catalogue goes first, so a project with properties
  // always has one.
  await provider.writeFile(
    ref,
    SNAPSHOTS_CATALOGUE_FILE,
    serializeCatalogue(withRecords(emptyCatalogue(), structure)),
  );
  await provider.writeFile(
    ref,
    PROPERTIES_FILE,
    // Counted, not unknown: Parts with no words are a fact about the
    // document.
    serializeProperties({
      ...props,
      stats: buildStats(structure, init?.stats ?? [], props.stats.countedAt),
      snapshotHashes: hashesFor({}, structure),
      summaries: recordsOf(structure).summaries,
    }),
  );
  onStep?.("properties");
  await provider.writeFile(ref, STRUCTURE_FILE, serializeStructure(structure));
  onStep?.("structure");
  await provider.createDir(ref, ASSISTANT_DIR);
  await provider.createDir(ref, ASSISTANT_MEMORY_DIR);
  await provider.createDir(ref, REFERENCE_DIR);
  onStep?.("workspace");
}

/**
 * Run `work` over every item with at most `size` in flight, failing on the
 * first rejection. A failed write stops the scaffold rather than being
 * skipped, so the manifest written after the files never describes a folder
 * missing one as complete.
 */
async function pooled<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
}
