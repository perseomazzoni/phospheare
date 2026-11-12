// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The open project's stats block in `document-properties.json`: a save's
// count and hash, the two backfills behind the open, and this visit's session.
// The Library draws documents it has not opened from that block, and only the
// editor has the text to keep it correct.
//
// Every write goes through the properties lane and never rejects: a count is
// derived, and failing to record one must never look like the prose failed to
// save.
//
// The session baseline: the spine's delta marks show what the writer did last
// time, per node, against every counted node's words when this visit began. It
// is captured when the project settles, before any save can land, and
// completed by the count backfill, so a count the backfill reads off the disk
// is not mistaken for work done this visit. The first exit consumes it, so a
// double fire (pagehide then unmount, or visibilitychange then pagehide)
// settles nothing twice.

import { hashOf } from "../../../text/hash";
import {
  buildStats,
  countWords,
  sessionDeltas,
  withNodeCount,
} from "../../../project/stats";
import { findNode, walk } from "../../../project/structure";
import type {
  DocNode,
  DocumentProperties,
  DocumentStructure,
  NodeStat,
} from "../../../project/types";
import { sessionChanged, sessionFor } from "../../deskLedger";
import type { MetadataStore, ProjectId, ProjectReader } from "./stores";
import { sameProject, type MetadataLanes } from "./metadataLanes";

export class StatsKeeper<P extends ProjectId> {
  /** Every counted node's words when this visit began; null once consumed. */
  private baseline: Map<string, number> | null = null;
  /** Backfill counts that landed before the baseline existed, folded in by
   * the settle, so the order of two background jobs cannot mint a false
   * "you wrote this" mark. */
  private readonly backfilled = new Map<string, number>();
  /** The project whose visit has settled: once per open. */
  private settledFor: P | null = null;

  constructor(private readonly lanes: MetadataLanes<P>) {}

  /**
   * Settles this visit's baseline from `current`, the open project's
   * properties, and stamps `ui.session` when a new session starts. Once per
   * project: a later call for the same one does nothing.
   */
  settle(
    store: MetadataStore<P>,
    target: P,
    current: DocumentProperties,
    now = Date.now(),
  ): Promise<void> {
    if (sameProject(this.settledFor, target)) return Promise.resolve();
    this.settledFor = target;

    const baseline = new Map(this.backfilled);
    for (const entry of current.stats.perNode) {
      baseline.set(entry.nodeId, entry.words);
    }
    this.baseline = baseline;

    const next = sessionFor(current.ui.session, current.stats, now);
    if (!sessionChanged(current.ui.session, next)) return Promise.resolve();
    return this.write(store, target, (latest) => ({
      ...latest,
      ui: { ...latest.ui, session: next },
    }));
  }

  /**
   * Closes this visit's session: diffs every counted node against the
   * baseline and stamps the ones that moved. The diff runs inside the lane
   * job, so every earlier count this visit is already in the base it reads,
   * and the delta is the visit's whole work. A visit that changed nothing
   * writes nothing; the session stays virtual.
   */
  settleExit(store: MetadataStore<P>): Promise<void> {
    const target = this.lanes.owner;
    const baseline = this.baseline;
    if (!target || !baseline) return Promise.resolve();
    // Consumed before the write: pagehide, visibilitychange and unmount can
    // all fire for one exit, and the first to settle owns the write.
    this.baseline = null;
    return this.write(store, target, (latest) => {
      const deltas = sessionDeltas(latest.stats.perNode, baseline);
      if (deltas.size === 0) return null;
      return {
        ...latest,
        stats: {
          ...latest.stats,
          perNode: latest.stats.perNode.map((entry) => {
            const delta = deltas.get(entry.nodeId);
            return delta === undefined ? entry : { ...entry, lastDelta: delta };
          }),
        },
      };
    });
  }

  /**
   * Records what a save of `text` into `file`, the adopted file of `nodeId`,
   * changed, in one write: the node's word count, the `updatedAt` stamp that
   * rides it, and the snapshot's `contentHash`.
   *
   * The per-node stamp is the save time of the adopted file, so there is no
   * separate snapshot stamp to keep in sync. The hash is the only copy kept:
   * `reconcileRecords` attaches it to the live nodes at open, and that copy is
   * never updated, since its one reader, `verifySnapshotHashes`, runs at open.
   *
   * One write, not two: each properties write redraws everything that reads
   * the project. The job takes its place in the lane at once and waits there
   * for the hash, so a later job, such as the exit settle, sees this count.
   */
  recordSave(
    store: MetadataStore<P>,
    target: P,
    nodeId: string,
    file: string,
    text: string,
    now = new Date(),
  ): Promise<void> {
    const shape = this.lanes.structure;
    if (!shape) return Promise.resolve();
    const words = countWords(text);
    const hash = hashOf(text);
    const at = now.toISOString();
    return this.write(store, target, async (latest) => {
      const counted: DocumentProperties = {
        ...latest,
        stats: withNodeCount(latest.stats, shape, nodeId, words, at),
      };
      const h = await hash.catch(() => null);
      const listed = findNode(shape, nodeId)?.snapshots.some(
        (snap) => snap.file === file,
      );
      if (h === null || !listed || counted.snapshotHashes[file] === h)
        return counted;
      return {
        ...counted,
        snapshotHashes: { ...counted.snapshotHashes, [file]: h },
      };
    });
  }

  /**
   * Brings the stats block level with what is on disk, behind the open.
   *
   * Only nodes the block does not cover are read, so this is a one-time cost
   * per document; after it, saving keeps the count current. Each node is
   * counted from its adopted file, the live text. `stillHere` answers false
   * once a newer open started, and the pass then reads and writes no more.
   */
  async backfillCounts(
    store: MetadataStore<P>,
    reader: ProjectReader<P>,
    target: P,
    shape: DocumentStructure,
    current: DocumentProperties,
    stillHere: () => boolean,
    now = new Date(),
  ): Promise<void> {
    const counted = new Set(current.stats.perNode.map((entry) => entry.nodeId));
    const missing: string[] = [];
    walk(shape.children, (node) => {
      if (!counted.has(node.id)) missing.push(node.id);
    });

    const added: NodeStat[] = [];
    for (const nodeId of missing) {
      if (!stillHere()) return;
      const node = findNode(shape, nodeId);
      if (!node) continue;
      const text = await reader.snapshot(target, node.adopted);
      if (text === null) continue;
      // No `updatedAt`: this editor never wrote the file, so there is no edit
      // time, and a made-up "now" would make a fresh project's snapshot table
      // claim the writer was just editing it. The first real save stamps it.
      added.push({ nodeId, words: countWords(text) });
    }

    const next = buildStats(
      shape,
      [...current.stats.perNode, ...added],
      now.toISOString(),
    );
    // A backfilled count is from before this visit, so the exit never reads
    // it as work done now: it goes into the pending map in case the baseline
    // is not captured yet, and into the baseline in case it is.
    for (const entry of added) {
      this.backfilled.set(entry.nodeId, entry.words);
      this.baseline?.set(entry.nodeId, entry.words);
    }
    const unchanged =
      added.length === 0 &&
      next.words === current.stats.words &&
      next.parts === current.stats.parts &&
      next.sections === current.stats.sections &&
      next.perNode.length === current.stats.perNode.length;
    if (unchanged || !stillHere()) return;

    await this.write(store, target, (latest) => ({ ...latest, stats: next }));
  }

  /**
   * Fills each snapshot's missing `contentHash`, one read per snapshot file,
   * behind the open. A missing hash is not yet computed, not a mismatch.
   * `stillHere` stops it as it stops the count backfill.
   */
  async backfillHashes(
    store: MetadataStore<P>,
    reader: ProjectReader<P>,
    target: P,
    shape: DocumentStructure,
    stillHere: () => boolean,
  ): Promise<void> {
    const updates: Array<{ id: string; file: string; hash: string }> = [];
    const nodes: DocNode[] = [];
    walk(shape.children, (node) => nodes.push(node));
    for (const node of nodes) {
      if (!stillHere()) return;
      for (const snap of node.snapshots) {
        if (snap.contentHash) continue;
        const content = await reader.snapshot(target, snap.file);
        if (content === null) continue;
        updates.push({
          id: node.id,
          file: snap.file,
          hash: await hashOf(content),
        });
      }
    }
    if (updates.length === 0 || !stillHere()) return;
    await this.write(store, target, (latest) => {
      const patched: Record<string, string> = {};
      for (const { file, hash } of updates) {
        // A backfill fills a missing hash and never overwrites one. Its read
        // may be seconds stale by dequeue on a network provider; a save that
        // landed meanwhile set a newer hash, and the stale one would raise a
        // false out-of-band mark.
        if (latest.snapshotHashes[file]) continue;
        patched[file] = hash;
      }
      if (Object.keys(patched).length === 0) return null;
      return {
        ...latest,
        snapshotHashes: { ...latest.snapshotHashes, ...patched },
      };
    });
  }

  private write(
    store: MetadataStore<P>,
    target: P,
    job: (
      latest: DocumentProperties,
    ) => DocumentProperties | null | Promise<DocumentProperties | null>,
  ): Promise<void> {
    return this.lanes
      .writeProperties(store, target, job)
      .catch(() => undefined);
  }
}
