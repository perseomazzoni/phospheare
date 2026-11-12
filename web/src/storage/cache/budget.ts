// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { userCacheDir } from "./cacheRoot";

// ── The byte budget ──────────────────────────────────────────────────────────
//
// A ceiling on bucket (e), applied to what the `cached()` decorator writes.
//
// It protects the origin quota, not the disk. The working copy shares one
// quota with `STORE_QUEUE`, `STORE_HANDLES`, `STORE_SYNC` and
// `profile.<userId>`, and each of those holds something that cannot be
// rebuilt: the queue lists work the remote has never seen, the handles are a
// grant a writer can only regrant by hand, the sync manifests pair a folder
// with its remote, and the profile holds the writer's preferences and shelf.
// The working copy is the only disposable one of the five and the one that
// grows with every keystroke. A cache that fills the quota makes those stores
// fail to write.
//
// The cap is a fixed number of bytes; `estimate()` and `persist()` are never
// consulted. Branching on `navigator.storage.estimate()` would tie
// behaviour to the free space on the writer's machine, which no test can
// reproduce. `opfsSeam.test.ts` confines those APIs to `cacheRoot.ts`.
//
// The eviction unit is the project (`CacheStore.dropProject`). A file-grained
// policy would leave a project half-cached, and its next read would be a miss
// the queue must treat as recoverable: the shape of an eviction, but
// self-inflicted and permanent.

/**
 * The ceiling, in bytes.
 *
 * A long novel is about a megabyte of markdown, so 64 MiB holds dozens of
 * books: more than a writer opens in a session, and small against an origin
 * quota of hundreds of megabytes or more, so the irreplaceable stores are
 * never squeezed.
 *
 * It errs generous. Evicting a project costs a re-fill from the remote, which
 * is slow and needs a connection the writer may not have; holding one costs
 * disk the browser already allows.
 */
export const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * How long a sweep waits after a write before measuring, in milliseconds.
 *
 * A save burst is many writes a second, and each would otherwise walk the
 * whole cache directory. The trailing delay collapses a burst into one walk,
 * so steady typing costs at most two walks a minute.
 */
export const SWEEP_DELAY_MS = 30_000;

/**
 * Which segments must never be evicted, injected rather than imported.
 *
 * A segment holding undrained queue work is never a candidate. The
 * working copy is the queue's only source, so dropping a segment with ops
 * still waiting destroys the writer's only copy of that work.
 *
 * `remoteQueue.ts` imports `openCacheStore`, so importing the queue here would
 * be a cycle. The queue registers itself at module load. Until it does, the
 * default throws and the sweep evicts nothing, because a budget running before
 * its interlock is wired does not know what is unsafe.
 */
async function noInterlock(): Promise<ReadonlySet<string>> {
  throw new Error("budget: no interlock registered");
}

let protectedSegments: () => Promise<ReadonlySet<string>> = noInterlock;

export function guardSegments(fn: () => Promise<ReadonlySet<string>>): void {
  protectedSegments = fn;
}

/** One project's directory, as the sweep sees it. */
export interface SegmentUse {
  /** The directory name: `segmentFor` of the project's id. */
  segment: string;
  bytes: number;
  /**
   * The newest `lastModified` under it, in epoch ms.
   *
   * Write recency, not access recency: OPFS reports no atime. A project being
   * written is one the writer is working in, while one being read may only be
   * a card being decorated.
   */
  usedAt: number;
}

/** Bytes and newest mtime under a directory, walked depth-first. */
async function measureDir(
  dir: FileSystemDirectoryHandle,
): Promise<{ bytes: number; usedAt: number }> {
  let bytes = 0;
  let usedAt = 0;
  for await (const [, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      const inner = await measureDir(handle as FileSystemDirectoryHandle);
      bytes += inner.bytes;
      usedAt = Math.max(usedAt, inner.usedAt);
      continue;
    }
    try {
      const file = await (handle as FileSystemFileHandle).getFile();
      bytes += file.size;
      usedAt = Math.max(usedAt, file.lastModified);
    } catch {
      // A file being written by another tab, or gone between the listing and
      // the read. Skipping it undercounts, which errs toward keeping data.
    }
  }
  return { bytes, usedAt };
}

/**
 * What this user's working copy holds, per project.
 *
 * Resolves `[]` when there is no cache directory, whether the browser has no
 * OPFS or nothing has been written yet. Never creates: a measurement that
 * scaffolded a directory would make the sweep a writer.
 */
export async function measureUserCache(userId: string): Promise<SegmentUse[]> {
  const dir = await userCacheDir(userId, { create: false });
  if (!dir) return [];
  const used: SegmentUse[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== "directory") continue;
    const { bytes, usedAt } = await measureDir(
      handle as FileSystemDirectoryHandle,
    );
    used.push({ segment: name, bytes, usedAt });
  }
  return used;
}

/**
 * Brings this user's working copy back under the ceiling, and resolves the
 * dropped segments.
 *
 * Evicts least-recently-written first, skips every protected segment, and
 * stops once the total is under.
 *
 * It can free nothing. A writer working offline has queued work in every
 * project they touched, so every segment is protected and the cache may
 * exceed the ceiling; the alternative is destroying the only copy of that
 * work. The ceiling is a target, never a licence.
 *
 * It measures once and evicts against that measurement. Re-walking after each
 * drop would let a save landing mid-sweep keep the loop running; one pass
 * terminates.
 *
 * A failed drop is skipped, not retried. The next sweep sees it again, and a
 * sweep that fought a locked directory would never end.
 */
export async function enforceBudget(userId: string): Promise<string[]> {
  const used = await measureUserCache(userId);
  let total = used.reduce((sum, u) => sum + u.bytes, 0);
  if (total <= CACHE_BUDGET_BYTES) return [];

  const keep = await protectedSegments();
  const dir = await userCacheDir(userId, { create: false });
  if (!dir) return [];

  const dropped: string[] = [];
  const candidates = used
    .filter((u) => !keep.has(u.segment))
    .sort((a, b) => a.usedAt - b.usedAt);

  for (const candidate of candidates) {
    if (total <= CACHE_BUDGET_BYTES) break;
    try {
      await dir.removeEntry(candidate.segment, { recursive: true });
      total -= candidate.bytes;
      dropped.push(candidate.segment);
    } catch {
      // Locked, or already gone; the next pass sees it again.
    }
  }
  return dropped;
}

// ── The trailing sweep ───────────────────────────────────────────────────────
//
// One timer per module, not per store: the budget is account-wide, and N open
// stores must not mean N walks. The sweep is also single-flight, because on a
// large cache a walk outlasts the delay and two overlapping walks would race
// each other's `removeEntry`.

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * Schedules a sweep; fire-and-forget.
 *
 * Called after every successful cache write, the only thing that grows this
 * bucket, read-through fills included. A hook on the drain would miss fifty
 * projects opened read-only, none queued and none ever draining.
 *
 * It never throws and never reports: housekeeping must not fail a save.
 */
export function sweepSoon(userId: string): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    if (running) return;
    running = true;
    void enforceBudget(userId)
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  }, SWEEP_DELAY_MS);
}

/** Test seam: forget the pending sweep and the interlock. */
export function resetBudgetState(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  running = false;
  protectedSegments = noInterlock;
}
