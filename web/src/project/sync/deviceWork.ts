// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { LOST, type RemoteQueueRecord } from "./remoteQueueStore";
import { refIdentity } from "../refIdentity";

// How much of the writer's work has not reached its destination: a pure
// projection of the queue's rows, read by the notice.
//
// One count covers every op, prose or structure (a reorder, a rename, a
// delete), because both mean the work is not on the remote yet and need the
// same act from the writer. The unit is the file: every file any pending op
// names. That count is never zero while the queue holds anything.
//
// The file, not the node (Part or Section). Counting nodes needs file-to-node
// identity, which file names cannot give: a retitle re-stems every snapshot,
// so one node appears under two stems on either side of a queued rename. The
// file is what an op names, it is countable without a walk, and it is the unit
// the product presents to the writer, one file per Section.

/**
 * The one file an op is about, for counting. A move names where the file
 * was: counting both ends would report two files held for one drag.
 */
function pathsOf(record: RemoteQueueRecord): string[] {
  const op = record.op;
  return op.kind === "mv" ? [op.from] : [op.path];
}

/** What the queue is holding, and whether it is going anywhere. */
export interface DeviceWork {
  /** Distinct files with work outstanding. Zero means nothing is held. */
  files: number;
  /**
   * Whether the queue has given up on something.
   *
   * A stopped op is the case the writer can act on: the destination refused
   * it and nothing retries until they fix the cause or a new session starts.
   * Ordinary pending work drains by itself and belongs to the save chip; a
   * stopped op earns a standing notice.
   */
  stuck: boolean;
  /**
   * Distinct files whose queued change is gone and will never land, because
   * a Remote-only project's working copy lost the bytes.
   *
   * Counted apart from `files`: "not yet synced" promises the work is on its
   * way, and for these it is not. A file with both a lost change and live work
   * counts in both, because both sentences are true of it.
   */
  lost: number;
}

/**
 * How many of the writer's files the queue is still holding.
 *
 * Takes records, not ops: two projects holding the same path are two files
 * that a path-only count would merge. `stopped` rows count too, because
 * skipping them would go silent in the state the field exists for.
 */
export function uncommittedFiles(
  records: readonly RemoteQueueRecord[],
): DeviceWork {
  const files = new Set<string>();
  const lost = new Set<string>();
  let stuck = false;
  for (const record of records) {
    const isLost = record.stopped?.code === LOST;
    if (record.stopped && !isLost) stuck = true;
    for (const path of pathsOf(record)) {
      (isLost ? lost : files).add(`${refIdentity(record.ref)} ${path}`);
    }
  }
  return { files: files.size, stuck, lost: lost.size };
}

/**
 * Every path an op's file has had, for marking a row.
 *
 * A restructure queues like prose: offline, a writer moves Sections between
 * Parts and renames them, and each op's `path` names where the file was. The
 * panel draws rows where the file is, so matching on the op's path alone
 * would leave every moved or renamed row unmarked. Both ends, unlike
 * `pathsOf`.
 */
export function pathsTouched(record: RemoteQueueRecord): string[] {
  const op = record.op;
  if (op.kind === "mv") {
    const name = op.from.slice(op.from.lastIndexOf("/") + 1);
    return [op.from, `${op.toDir}/${name}`];
  }
  if (op.kind === "rename") {
    const dir = op.path.slice(0, op.path.lastIndexOf("/"));
    return [op.path, `${dir}/${op.newName}`];
  }
  return [op.path];
}
