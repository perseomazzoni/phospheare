// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The undo timeline's journals: one file per snapshot file under `history/`
// at the project root, in the writer's own folder, which sign-out and purge
// never touch. A journal is machine-written and never hand-edited; the keeper
// only moves opaque blobs between the engine and the files. One file per
// snapshot keeps a large or unreadable journal from blocking or evicting
// another's.
//
// Two guards keep another device's journal safe. Every flush re-reads the
// disk copy and skips when it differs from what this session last saw,
// because another device wrote newer steps and this flush must not overwrite
// them; and a journal that cannot be read is never written. The next open's
// tail-reconcile drops a stale journal quietly, and this session stops
// writing to a journal another device owns.
//
// A failed journal job is never an error the writer sees: the timeline is a
// convenience, the manuscript is the contract.

import type { JournalStore, ProjectId } from "./stores";

export class JournalKeeper<P extends ProjectId> {
  /** The active file's journal as last seen on disk, or null. */
  baseline: string | null = null;

  /**
   * One FIFO lane for every read-then-write of a journal file. A flush and a
   * move or delete of the same file close together would otherwise act on
   * what the other is about to change; one lane makes each job's read see
   * every earlier write.
   */
  private lane: Promise<void> = Promise.resolve();

  private enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.lane.then(job);
    // A failed job never breaks the chain: a rejected write must not strand
    // every later journal write.
    this.lane = run.catch(() => undefined);
    return run;
  }

  /**
   * Reads `fileName`'s journal for an open. An unreadable journal reads as
   * none, so the timeline starts empty and costs the open nothing; the next
   * flush re-reads the file and leaves it alone. The baseline waits for
   * `opened`, since an open overtaken after the read opens nothing.
   */
  async read(
    store: JournalStore<P>,
    project: P,
    fileName: string,
  ): Promise<string | undefined> {
    try {
      return (await store.read(project, fileName)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Records what the disk held for the file the engine opened. */
  opened(journal: string | undefined) {
    this.baseline = journal ?? null;
  }

  /**
   * Queues a write of `journal` for the active file `fileName`. The write
   * goes ahead only when the disk still holds the baseline.
   */
  flush(
    store: JournalStore<P>,
    project: P,
    fileName: string,
    journal: string,
  ): Promise<void> {
    return this.enqueue(async () => {
      try {
        const disk = await store.read(project, fileName);
        // The disk differs from what this session wrote or read: another
        // device wrote newer steps or deleted the journal.
        if (this.baseline !== disk) return;
        this.baseline = journal;
        await store.write(project, fileName, journal);
      } catch (err) {
        console.warn("history journal flush failed", err);
      }
    });
  }

  /**
   * Queues the move of a file's journal across a rename. The timeline is
   * named by file name, so without the move the renamed chapter reopens with
   * an empty history and the old journal lingers, read only as stale by the
   * name-reuse guard.
   */
  move(
    store: JournalStore<P>,
    project: P,
    from: string,
    to: string,
  ): Promise<void> {
    return this.enqueue(async () => {
      try {
        const moved = await store.read(project, from);
        if (moved === null) return;
        // The baseline needs no update: it holds the active file's journal,
        // whose bytes the move keeps.
        await store.write(project, to, moved);
        await store.remove(project, from);
      } catch (err) {
        console.warn("history journal section move failed", err);
      }
    });
  }

  /**
   * Queues the removal of a deleted file's journal. A deleted snapshot's
   * journal must not pass to a same-name successor, where the tail-reconcile
   * catches it only when the content happens to diverge.
   */
  remove(store: JournalStore<P>, project: P, fileName: string): Promise<void> {
    return this.enqueue(async () => {
      try {
        // Read first, so a file with no journal sends no remove.
        if ((await store.read(project, fileName)) === null) return;
        await store.remove(project, fileName);
      } catch (err) {
        console.warn("history journal section delete failed", err);
      }
    });
  }
}
