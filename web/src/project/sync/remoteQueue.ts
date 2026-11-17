// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Op } from "../../storage/mirrored";
import { getProvider, isRemoteRef } from "../../storage";
import { openCacheStore } from "../../storage/cache/opfsCacheStore";
import { guardSegments } from "../../storage/cache/budget";
import { segmentFor } from "../../storage/cache/cachePath";
import type { CacheStore } from "../../storage/cache/cacheStore";
import {
  StorageError,
  baseName,
  joinPath,
  parentPath,
  type FileFingerprint,
  type ProjectRef,
  type StorageProvider,
} from "../../storage/types";
import { getCurrentUserId, onUserChange } from "../../auth/currentUser";
import {
  appendOp,
  clearStopped,
  dropOps,
  forgetLost,
  LOST,
  markStopped,
  allPendingOps,
  opsFor,
  pendingProjects,
  pendingProjectsOrThrow,
  removeOp,
  type ProjectAddress,
  type QueuedProject,
  type RemoteQueueRecord,
} from "./remoteQueueStore";
import { refIdentity } from "../refIdentity";
import { remoteFor } from "./remoteFor";
import { projectIdFor } from "../projectId";
import { sha256Hex } from "../../text/hash";
import {
  withBaseline,
  withoutPath,
  withPathMoved,
  type RemoteTarget,
  type SyncManifest,
} from "./manifest";
import { getManifest, putManifest } from "./manifestStore";
import { withSyncLock } from "./syncLock";
import { isScanned } from "./scan";
import { appLog, describeError } from "../../log";

// ── Coalescing ───────────────────────────────────────────────────────────────
//
// Ops carry a path, never content: `put` reads its source at drain time, so a
// burst of saves pushes the final text once and stale text is never pushed.
// A `put` supersedes an earlier pending `put` on the same path, unless a
// structural op (rename, move, delete) touching that path or an ancestor sits
// between them, because the path then names something else. Everything else
// appends. Do not generalize this into a smarter merge: its correctness
// argument does not pay for the bugs it would open.

function ancestorOf(path: string, maybeAncestor: string): boolean {
  return path === maybeAncestor || path.startsWith(`${maybeAncestor}/`);
}

function opPaths(op: Op): string[] {
  switch (op.kind) {
    case "put":
    case "mkdir":
    case "rm":
    case "rename":
      return [op.path];
    case "mv":
      return [op.from, op.toDir];
  }
}

function structurallyTouches(op: Op, path: string): boolean {
  return (
    op.kind !== "put" &&
    opPaths(op).some((p) => ancestorOf(path, p) || ancestorOf(p, path))
  );
}

/** The pending `put` a new one on the same path supersedes, or -1. */
function supersededIndex(
  pending: readonly Op[],
  next: Extract<Op, { kind: "put" }>,
): number {
  for (let i = pending.length - 1; i >= 0; i--) {
    const op = pending[i];
    if (op.kind === "put") {
      if (op.path === next.path) return i;
      continue;
    }
    if (structurallyTouches(op, next.path)) return -1;
  }
  return -1;
}

/** `pending` with `next` added under the coalescing rule. */
export function coalesce(pending: readonly Op[], next: Op): Op[] {
  if (next.kind !== "put") return [...pending, next];
  const i = supersededIndex(pending, next);
  if (i === -1) return [...pending, next];
  return [...pending.slice(0, i), ...pending.slice(i + 1), next];
}

// ── The queue's index and signal ─────────────────────────────────────────────
//
// Two readers ask different questions of the same rows: the card's badge asks
// whether a project owes the remote anything, and the notice asks how much of
// the writer's work is only on this device. The count is projected
// from the ops by `deviceWork.ts`, because this module does not know what kind
// of project it drains, and Parts and Sections are that kind of knowledge.
//
// The index is re-derived from the store, never asserted. `refresh()` is its
// one mutator and it reads, so the index follows the store by construction.
// An index kept by hand claims things about rows it has not read, and a count
// one op stale is a wrong number in front of the writer for as long as the
// condition lasts.
//
// Subscribers are told whenever the queue's contents change, not only when a
// project gains or loses all its work. The count needs that, and `isPending`
// answers the same boolean again on an extra notify.

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Identity to that project's live ops, oldest first.
 *
 * The value is the rows, not the bare ref: the `online` handler hands a whole
 * ref to `kick`, and the notice's projection needs the ops. Holding the rows
 * keeps the notice from opening a transaction on every notify.
 */
const index = new Map<string, RemoteQueueRecord[]>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPending(ref: ProjectAddress): boolean {
  return index.has(refIdentity(ref));
}

/**
 * One project's outstanding ops, oldest first.
 *
 * Read off the in-memory index with no transaction, because it sits in the
 * await chain of every `listDir`. It allocates, unlike `pendingRecords`, which
 * is safe because it is called once per listing, not as a
 * `useSyncExternalStore` snapshot getter.
 */
export function pendingOpsFor(ref: ProjectAddress): readonly Op[] {
  const records = index.get(refIdentity(ref));
  return records ? records.map((record) => record.op) : EMPTY_OPS;
}

/** One shared empty array, so the common answer allocates nothing. */
const EMPTY_OPS: readonly Op[] = [];

/** Every project with work outstanding. */
function pendingRefs(): QueuedProject[] {
  return [...index.values()].map((records) => records[0].ref);
}

/**
 * The queue's live rows for the signed-in user, as one stable array.
 *
 * `useSyncExternalStore` calls its snapshot getter on every render and
 * compares by identity, so a getter that allocates is an infinite render loop.
 * The array is replaced only inside `refresh()`, and only when
 * the rows differ.
 */
let snapshot: RemoteQueueRecord[] = [];

export function pendingRecords(): RemoteQueueRecord[] {
  return snapshot;
}

/**
 * A cheap fingerprint of the rows, so `refresh` can tell a real change from a
 * re-read that found the same thing.
 *
 * The id and the stop are all any reader reacts to. Ids are unique and
 * monotonic (the autoincrement key), so a differing id list is an append or a
 * removal, and `stopped` is the one field that mutates in place. An op is
 * immutable once written. A stop counts by its presence as well as its code:
 * a stop can carry a null code, and one read as absent leaves the claim
 * running an op the store holds as stopped.
 */
function fingerprint(records: readonly RemoteQueueRecord[]): string {
  return records
    .map((r) => (r.stopped ? `${r.id}:s:${r.stopped.code ?? ""}` : `${r.id}`))
    .join(",");
}

/** `fingerprint(snapshot)`, kept beside it so a re-read builds one string. */
let snapshotPrint = fingerprint(snapshot);

// Single-flight, with one trailing re-read. A drain removing N rows and an
// `enqueue` burst both fire N times in a turn, and a `getAll()` for each would
// put one IndexedDB transaction per op on the store the drain is using. The
// coalescing lives here so the cost of a burst is a property of this module,
// not of each reader.
//
// A caller that arrives mid-read gets the running read's promise, not an
// early return. That read loops once more because of the flag, so when the
// caller's await resolves the index has read the store after the caller's
// own write.
let running: Promise<void> | null = null;
let refreshAgain = false;

/**
 * Re-derive the index from the store, and tell subscribers if anything moved.
 *
 * Every mutator awaits this before it returns, so `isPending` is true the
 * instant `enqueue` resolves.
 */
function refresh(): Promise<void> {
  if (running) {
    refreshAgain = true;
    return running;
  }
  running = (async () => {
    try {
      for (;;) {
        const records = await allPendingOps();
        const print = fingerprint(records);
        if (print !== snapshotPrint) {
          snapshot = records;
          snapshotPrint = print;
          index.clear();
          for (const record of records) {
            const key = refIdentity(record.ref);
            const existing = index.get(key);
            if (existing) existing.push(record);
            else index.set(key, [record]);
          }
          notify();
        }
        if (!refreshAgain) return;
        refreshAgain = false;
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

// ── Backoff ──────────────────────────────────────────────────────────────────

const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export function nextBackoffMs(previousMs: number | null): number {
  if (previousMs === null) return MIN_BACKOFF_MS;
  return Math.min(previousMs * 2, MAX_BACKOFF_MS);
}

const backoff = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// Both maps key on `refIdentity`, never on a bare project key: two backends
// can hand out the same key string, and a timer armed for one book must not be
// cleared by the other.
function clearRetry(key: string): void {
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
  backoff.delete(key);
}

function scheduleRetry(ref: QueuedProject): void {
  const key = refIdentity(ref);
  const delay = nextBackoffMs(backoff.get(key) ?? null);
  backoff.set(key, delay);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      kick(ref);
    }, delay),
  );
}

// ── Per-project exclusivity ──────────────────────────────────────────────────
//
// `enqueue`'s coalesce check and the drain's claim-push-remove of the head op
// are both read-modify-write against the same store, and a burst of saves
// makes the drain likely to be pushing op 1 when op 2 arrives. Unserialized,
// `enqueue` could delete a row the drain has claimed as its `head` while it
// awaits the remote, and the drain would push it anyway, so coalescing would
// fail under the load it exists for. A promise-chain mutex per project closes
// that window without making `enqueue` block its caller, since nothing in
// `mirrored.ts` awaits its promise.

const locks = new Map<string, Promise<void>>();

/**
 * The scope one exclusive section is exclusive against: this project, for
 * this user. The user is in the key because the outgoing user's chain
 * survives a user change (`resetInMemoryState`), and the incoming user's
 * first `enqueue` for the same project must not queue behind it.
 *
 * `\u0000` separates because it cannot appear in a provider id or a local
 * folder name, so no (user, project) pair spells another pair's key. A null
 * user shares the empty prefix, which is harmless: `appendOp` refuses without
 * a signed-in user, so nothing durable happens under it.
 */
function lockKey(ref: ProjectAddress): string {
  return `${getCurrentUserId() ?? ""}\u0000${refIdentity(ref)}`;
}

/**
 * `fn` under the browser's lock of this name, so another tab draining the
 * same queue waits for it.
 *
 * The rows live in one IndexedDB every tab of the origin shares, and each tab
 * runs its own drain. The promise chain below orders this tab only, so two
 * tabs would claim the same head op and both send it: for a new file, two
 * files under one name. Where the platform has no Web Locks, the chain is
 * all there is.
 */
function acrossTabs<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const manager = globalThis.navigator?.locks;
  if (!manager) return fn();
  return manager.request(`remote-queue\u0000${key}`, () => fn());
}

function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const body = () => acrossTabs(key, fn);
  const next = previous.then(body, body);
  const settled = next.then(
    () => {},
    () => {},
  );
  locks.set(key, settled);
  // Drop the chain once it has finished and nothing queued behind it. If
  // another caller chained on, `locks` holds their promise and the identity
  // test deletes nothing. Without it the map grows one entry per user and
  // project forever.
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return next;
}

// ── The drain worker ─────────────────────────────────────────────────────────
//
// FIFO per project, and at most two projects draining at once. These are
// writes, and an adapter such as `driveProvider` keeps a listing cache per
// folder that they all contend on, so more concurrency buys only contention.

const MAX_CONCURRENT_DRAINS = 2;
let activeDrains = 0;
const waitingForSlot: (() => void)[] = [];
const draining = new Set<string>();
/** Projects kicked while their drain was running, owed one more pass. */
const wakeAgain = new Set<string>();

// ── Failure policy ───────────────────────────────────────────────────────────
//
// Success is the only reason an op leaves this queue. The queue's
// source can be the working copy, and the working copy can be the only copy of
// those bytes, so an op deleted because it failed is a manuscript
// deleted. A failed op is marked `RemoteQueueRecord.stopped` instead: it stays
// where it is, the drain stops at it, and the project reads as having unsent
// work because it does.
//
// Nothing re-derives a dropped op. `checkSync` always compares against a local
// side, so a project without one has no such repair, and even with a disk
// behind it a dropped op leaves the remote stale while the badge reads synced.
//
// Failures run on two axes, because they mean opposite things. `isPermanent`
// classifies what the destination said: a refusal, an oversized body, a target
// that is gone, all answers about whether these bytes can ever land there. A
// failure to read the source says nothing about that, so it never reaches that
// predicate. Routed together, a lapsed folder grant (`localProvider`'s
// `requireRoot` throws `permission`) reads as the remote refusing the write,
// and dead-letters a push nothing refused.
//
// A permanent destination failure stops the op at once, since another attempt
// cannot change the answer. Every other failure, transient destination or any
// source failure, backs off and retries, and stops after
// `MAX_CONSECUTIVE_FAILURES`. The cap keeps a poisoned project from spinning
// forever; it never deletes.
//
// The drain stops at a stopped op rather than stepping over it. Applying op
// N+1 while op N never landed is a reordering: a later state on top of a
// missing earlier one, the right bytes at the wrong path for a `rename` or
// `mv` that never happened.
//
// 401 and 403 arrive as `permission`. An adapter retries once with a fresh
// token first (`driveFetch` does), so a second refusal is a real one. Google
// can rate-limit with a quota 403 rather than 429, and telling that from a
// real permission loss needs the error body, so a rate limit stops the project
// until the writer or a new session asks again. Stopping visibly is the safer
// of the two failures.

const MAX_CONSECUTIVE_FAILURES = 10;
const failures = new Map<string, number>();

/**
 * Whether a destination error code is permanent. Exported so the layers that
 * mint these codes pin their classification against this predicate rather
 * than restating it.
 *
 * `opfsCacheStore.ts` chooses a code for every way OPFS can refuse a write,
 * and transient against permanent there is retrying the writer's work against
 * dead-lettering it. A second copy of this list drifts silently, and the drift
 * shows only as lost prose.
 */
export function isPermanent(code: string | null): boolean {
  return code === "permission" || code === "too-large" || code === "not-found";
}

/**
 * What one attempt at one op came to. The stage that produced an error
 * classifies it, so `drainOnce` sees a verdict, never a code's origin.
 */
type OpOutcome =
  | {
      done: true;
      pushed: string | null;
      /**
       * The remote's own fingerprint of the file a `put` left there, when the
       * drain knows it, or `null`.
       */
      remote: FileFingerprint | null;
    }
  | { done: false; verdict: "retry" | "stop"; code: string | null }
  | { done: false; verdict: "lost" };

/**
 * What one pass of the drain's exclusive step found and did: nothing queued,
 * a head already given up on, or one op attempted.
 *
 * The step returns it rather than assigning captured `let`s, because
 * TypeScript cannot narrow a variable written only inside a callback, and the
 * casts that would need hide a new branch that forgets to set one.
 */
type Step =
  | { kind: "empty" }
  | { kind: "held" }
  | { kind: "ran"; id: number; op: Op["kind"]; outcome: OpOutcome };

/**
 * The code an error carries, recognized by shape rather than class identity:
 * `instanceof StorageError` is unreliable across module boundaries, since
 * `vi.resetModules` gives each import its own class.
 */
function codeOf(err: unknown): string | null {
  if (err instanceof StorageError) return err.code;
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function withDrainSlot(run: () => Promise<void>): void {
  const start = () => {
    activeDrains++;
    void run().finally(() => {
      activeDrains--;
      const next = waitingForSlot.shift();
      if (next) next();
    });
  };
  if (activeDrains < MAX_CONCURRENT_DRAINS) start();
  else waitingForSlot.push(start);
}

/** A minimal ref for a provider read or write; sync needs only `.key`. */
function refFor(providerId: string, key: string): ProjectRef {
  return { providerId, key, name: "", openedAt: "" };
}

/**
 * Resolve the backend this project's pairing points at, or `null`.
 *
 * Through the registry rather than a named import: the pairing records which
 * provider it addresses, so the queue commits to whatever is
 * registered under that id and gains a second remote by registration alone.
 * `null` means the pairing names a provider this build does not register;
 * the drain then parks the project until one is.
 */
function remoteProviderFor(remote: RemoteTarget): StorageProvider | null {
  const provider = getProvider(remote.providerId);
  return provider?.kind === "remote" ? provider : null;
}

/**
 * The stop code for a `put` the remote moved away from: another device edited
 * or created the file after the last sync, so sending this one would destroy
 * that edit. The next sync check reads both sides as changed and reports the
 * conflict, and the writer's resolution backs up the side that loses and
 * drops this queue (`forgetProject`).
 */
const CONFLICT = "conflict";

/**
 * Whether a `put` may overwrite what the remote holds at `path` now, with the
 * fingerprint that answer was read from (`null` for a file the remote lacks).
 *
 * The manifest's baseline is the remote's fingerprint at the last sync, or no
 * entry for a path never synced. Only a remote still matching it is this
 * device's to overwrite. A remote already holding exactly these bytes needs
 * no write, and both sides then agree. Anything else is an edit made
 * elsewhere.
 *
 * Fingerprints compare like with like. A weak one (a `modifiedTime`) matches
 * only the weak baseline it was recorded as, as `compare.ts` compares it. A
 * real digest also matches the baseline's local hash, which names the bytes
 * both sides held at the last sync, so a remote that went from a weak answer
 * to a digest still reads as unchanged.
 */
async function precondition(
  provider: StorageProvider,
  ref: ProjectRef,
  path: string,
  manifest: SyncManifest,
  content: string,
): Promise<{
  verdict: "write" | "landed" | "conflict";
  now: FileFingerprint | null;
}> {
  let now: FileFingerprint | null;
  try {
    now = await provider.fingerprintFile(ref, path);
  } catch (err) {
    if (codeOf(err) !== "not-found") throw err;
    now = null;
  }
  const baseline = manifest.files[path];
  if (now === null) {
    return { verdict: baseline ? "conflict" : "write", now };
  }
  if (baseline && now.hash === baseline.remote)
    return { verdict: "write", now };
  if (!now.weak) {
    if (baseline && now.hash === baseline.local) {
      return { verdict: "write", now };
    }
    if (now.hash === (await sha256Hex(content))) {
      return { verdict: "landed", now };
    }
  }
  return { verdict: "conflict", now };
}

/**
 * The remote's fingerprint of a file a `put` just wrote, or `null` when it
 * cannot be read. A failure here never fails the push, which has landed.
 */
async function fingerprintAfterPush(
  provider: StorageProvider,
  ref: ProjectRef,
  path: string,
): Promise<FileFingerprint | null> {
  try {
    return await provider.fingerprintFile(ref, path);
  } catch {
    return null;
  }
}

/**
 * Runs a rename or move, and counts a `not-found` as done when the source is
 * not on the remote.
 *
 * Then the op either already ran (a redelivery after a success whose removal
 * from the queue was lost) or names a path that never reached the remote, and
 * in both cases nothing is left to move. Stopping would hold every op behind
 * it for good. A `not-found` with the source still there is about something
 * else and stays an error.
 */
async function movedAlready(
  provider: StorageProvider,
  ref: ProjectRef,
  source: string,
  move: () => Promise<void>,
): Promise<void> {
  try {
    await move();
  } catch (err) {
    if (codeOf(err) !== "not-found") throw err;
    if (await provider.exists(ref, source)) throw err;
  }
}

async function runOp(
  store: CacheStore,
  remote: RemoteTarget,
  provider: StorageProvider,
  op: Op,
  /** Whether the working copy is the project's only copy (Remote-only). */
  onlyCopy: boolean,
  /**
   * The device project's sync manifest, read under the sync lock, or `null`
   * for a project that keeps none. A `put` on a path conflict detection
   * tracks lands only where the manifest agrees with what the remote holds
   * now; any other path stays last-write-wins, as the check leaves it.
   */
  manifest: SyncManifest | null,
): Promise<OpOutcome> {
  const remoteRef = refFor(provider.id, remote.key);

  // The source is the working copy, for every project. Both kinds put their
  // bytes there before appending the op, so the queue does not know or ask
  // which kind of project it drains. Only a `put` has a source, and a source
  // failure is classified here, before its code can meet a destination's.
  let content: string | null = null;
  if (op.kind === "put") {
    let entry;
    try {
      entry = await store.read(op.path);
    } catch (err) {
      const code = codeOf(err);
      // `unusable-path` is about a name, which no retry fixes, so it stops on
      // the first attempt and the project says what is wrong now rather than
      // after ten backoff periods. Every other source failure is about a
      // moment (a lapsed folder grant, a busy disk, an evicted entry).
      return {
        done: false,
        verdict: code === "unusable-path" ? "stop" : "retry",
        code,
      };
    }
    if (!entry) {
      // The entry is gone: evicted, dropped by an idle in-memory partition, or
      // never written. Nothing is sent and nothing is removed. A miss is a
      // `null`, not a thrown `not-found`, which `isPermanent` would call
      // permanent, dropping the op that holds the writer's only copy.
      //
      // For a Local+Synced project a retry succeeds: `cached()` refills an
      // entry the queue owes from the disk on the next read of the path.
      //
      // For a Remote-only project the bytes are gone: `cached()` does not
      // refill an owed entry from the remote, whose bytes are older than this
      // change. That miss is a loss, and a change that will never sync must
      // not read as "not yet synced", so it is marked lost at once, with no
      // retries and no cap. The drain is told which case it is (`onlyCopy`).
      // An open buffer holding the change can still undo a loss, because the
      // editor saves it again.
      if (onlyCopy) return { done: false, verdict: "lost" };
      return { done: false, verdict: "retry", code: null };
    }
    content = entry.text;
  }

  // The destination stage.
  let remoteAfter: FileFingerprint | null = null;
  try {
    switch (op.kind) {
      case "put": {
        // Not `content ?? ""`. The source stage set it or returned, so the
        // null is unreachable, but an empty-string default here would write a
        // blank file over the writer's prose after any edit that reaches it.
        if (content === null) {
          throw new StorageError("remoteQueue: a put with no source", "io");
        }
        if (!manifest || !isScanned(op.path)) {
          await provider.writeFile(remoteRef, op.path, content);
          break;
        }
        const { verdict, now } = await precondition(
          provider,
          remoteRef,
          op.path,
          manifest,
          content,
        );
        if (verdict === "conflict") {
          return { done: false, verdict: "stop", code: CONFLICT };
        }
        if (verdict === "landed") {
          remoteAfter = now;
          break;
        }
        await provider.writeFile(remoteRef, op.path, content);
        // The next put's precondition compares the remote's answer then with
        // the baseline this one records, so the baseline is that answer's
        // kind. A remote that gave a real digest before the write gives the
        // digest of these bytes after it, which costs no request. A weak or a
        // new file is asked again, because a weak answer is a time the write
        // has just moved.
        remoteAfter =
          now && !now.weak
            ? { hash: await sha256Hex(content) }
            : await fingerprintAfterPush(provider, remoteRef, op.path);
        break;
      }
      case "mkdir":
        await provider.createDir(remoteRef, op.path);
        break;
      case "rm":
        try {
          await provider.removeFile(remoteRef, op.path);
        } catch (err) {
          // Already gone from the remote is what the op wanted. Any other
          // failure is real.
          if (codeOf(err) !== "not-found") throw err;
        }
        break;
      case "mv":
        await movedAlready(provider, remoteRef, op.from, () =>
          provider.moveFile(remoteRef, op.from, op.toDir),
        );
        break;
      case "rename":
        await movedAlready(provider, remoteRef, op.path, () =>
          provider.renameFile(remoteRef, op.path, op.newName),
        );
        break;
    }
  } catch (err) {
    // The destination's own answer, and the one place `isPermanent` is asked.
    const code = codeOf(err);
    return { done: false, verdict: isPermanent(code) ? "stop" : "retry", code };
  }
  return { done: true, pushed: content, remote: remoteAfter };
}

/**
 * Bring the sync manifest's baselines level with what the drain did to the
 * remote. Otherwise the next check reads both the save that queued the op and
 * the push itself as changes against stale baselines, and reports every
 * drained edit as a conflict.
 *
 * For a `put`, both sides hold the pushed bytes, so the local baseline takes
 * the hash of that content, never of a re-read, which could race a newer save
 * and record an unsynced state as synced. The remote baseline takes the
 * remote's own fingerprint of the file when the drain has it, which on a
 * remote without digests is a weak one, and the hash of the content
 * otherwise. A rename or a move changes where the bytes are on both sides,
 * not the bytes, so its baselines move with it. A delete drops its path.
 */
async function syncBaselines(
  projectId: string,
  op: Op,
  pushed: string | null,
  remote: FileFingerprint | null,
): Promise<void> {
  const stored = await getManifest(projectId);
  if (!stored) return;

  let manifest: SyncManifest = stored;
  switch (op.kind) {
    case "put": {
      const hash = await sha256Hex(pushed ?? "");
      manifest = withBaseline(manifest, op.path, {
        local: hash,
        remote: remote?.hash ?? hash,
        ...(remote?.weak ? { weak: true } : {}),
        remoteFileId: "",
        // No mtime pairs honestly with `hash`, which is the bytes of the save
        // that queued this op. Reading the file's current `lastModified` would
        // pair that hash with an mtime a newer, unpushed save moved.
        // `0` is a sentinel no real mtime equals, so a hint built from this
        // baseline never matches and never takes the fast path; `Date.now()`
        // would only be unlikely to collide.
        localMtime: 0,
      });
      break;
    }
    case "rm":
      manifest = withoutPath(manifest, op.path);
      break;
    case "rename":
      manifest = withPathMoved(
        manifest,
        op.path,
        joinPath(parentPath(op.path), op.newName),
      );
      break;
    case "mv":
      manifest = withPathMoved(
        manifest,
        op.from,
        joinPath(op.toDir, baseName(op.from)),
      );
      break;
    case "mkdir":
      break;
  }
  await putManifest(projectId, manifest);
}

async function drainOnce(ref: QueuedProject): Promise<void> {
  const key = refIdentity(ref);
  // Captured once, before the loop: a drain that started as this user stays
  // serialized against its own chain even if the account changes mid-await.
  const lock = lockKey(ref);
  // A project whose own address is remote has no disk behind its working
  // copy, so the working copy is the writer's only copy of a queued change.
  // Read once from the device/remote axis, a fact about the address.
  const onlyCopy = isRemoteRef(ref);
  if (draining.has(key)) {
    // The running drain may already have read the store and be on its way
    // out, so it would never see the op this kick is for. It is told instead,
    // and reads again before it leaves with nothing to do. A drain leaving
    // for a backoff or a stop does not: its retry or the stop covers every op
    // behind the head.
    wakeAgain.add(key);
    return;
  }
  draining.add(key);
  // One line per drain that moved something, never per op: a drain that
  // found nothing to do says nothing new.
  const began = Date.now();
  let moved = 0;
  const kinds = new Set<string>();
  try {
    for (;;) {
      let remote: RemoteTarget | null;
      try {
        remote = await remoteFor(ref);
      } catch (err) {
        // The pairing could not be read, which says nothing about whether
        // the writer unpaired. The ops stay, and the drain reads again after
        // a backoff. Not counted as an op failure: no op ran.
        appLog.warn("sync", "A project's pairing could not be read.", {
          project: ref.id ?? null,
          ...describeError(err),
        });
        await refresh();
        scheduleRetry(ref);
        return;
      }
      if (!remote) {
        // The writer unpaired the project mid-drain. That decision makes these
        // ops moot: dropping them is what was asked for, and keeping them
        // would resurrect the old destination into a future pairing.
        //
        // Only a device project reaches this branch. Its record carries the
        // book's id, and `remoteFor` resolves the pairing from that id
        // through a manifest in IndexedDB, never the library mirror, so `null`
        // means the manifest is gone, which is the writer unpairing. A record
        // without an id whose folder the shelf cannot name is the exception,
        // drained through the mirror while it can. A remote-primary project is
        // its own destination and never gets here, which matters because its
        // queue is the only path its work has, while a device project's bytes
        // are on the writer's disk and `checkSync` re-derives them.
        await dropOps(ref);
        await refresh();
        clearRetry(key);
        failures.delete(key);
        return;
      }
      const provider = remoteProviderFor(remote);
      if (!provider) {
        // The pairing names a backend this build does not register: an
        // adapter dropped, or a record written by a newer build. Nobody
        // decided anything, the fact can change on the next deploy, and the
        // ops may be the only copy of the writer's work, so the project parks:
        // still pending, nothing destroyed. It drains by itself once the
        // provider is registered, because `drainAll` re-reads the store on
        // every boot.
        await refresh();
        clearRetry(key);
        return;
      }

      // Claim, push and remove the head op as one exclusive step. The lock is
      // taken per iteration, not per drain, so an `enqueue` can arrive between
      // op N and op N+1 and coalesces against everything behind the op in
      // flight, never against that op.
      const claim = (store: CacheStore): Promise<Step> =>
        runExclusive(lock, async (): Promise<Step> => {
          // One read per step: the re-derived index is the project's rows as
          // read now, and the same read tells subscribers what the last step
          // removed.
          await refresh();
          const rows: readonly RemoteQueueRecord[] = index.get(key) ?? [];
          if (rows.length === 0) return { kind: "empty" };
          // A lost `put` is stepped past, never waited at: it can never land,
          // and it carries no structure for a later op to depend on.
          const head = rows.find((row) => row.stopped?.code !== LOST);
          if (!head) return { kind: "held" };
          if (head.stopped) {
            // Draining the op behind a stopped one applies a later state over
            // a missing earlier one, such as a `put` landing at a path a
            // never-applied `rename` should have created. The project waits.
            return { kind: "held" };
          }
          // The book whose manifest this op's baselines live in. A baseline
          // is a claim about two durable sides, and a remote-primary project
          // has only one, because the working copy is disposable and never a
          // side, so it keeps no manifest and none is created for it. The
          // manifest is keyed by the book, not its folder, and the record
          // carries that key, so a push levels its baseline without asking
          // the mirror to name the book. Only a record without an id falls
          // back to the mirror.
          const book = onlyCopy ? null : (ref.id ?? projectIdFor(ref));
          const attempt = async (): Promise<OpOutcome> => {
            let manifest: SyncManifest | null = null;
            if (book) {
              try {
                manifest = await getManifest(book);
              } catch (err) {
                // Without the manifest a `put` would skip its conflict check
                // and could overwrite an edit made on another device. The op
                // waits for a manifest it can read.
                return { done: false, verdict: "retry", code: codeOf(err) };
              }
            }
            const outcome = await runOp(
              store,
              remote,
              provider,
              head.op,
              onlyCopy,
              manifest,
            );
            if (outcome.done && book) {
              try {
                await syncBaselines(
                  book,
                  head.op,
                  outcome.pushed,
                  outcome.remote,
                );
              } catch (err) {
                // The push landed, so the op is done. A baseline the store
                // cannot take now costs the next check a question, since it
                // sees both sides changed, never the writer's bytes.
                appLog.warn(
                  "sync",
                  "A sync baseline could not be written after a push.",
                  { project: book, op: head.op.kind, ...describeError(err) },
                );
              }
            }
            return outcome;
          };
          // Under the project's sync lock, the one `checkSync` holds: a check
          // scanning while this op is half applied reads the drain's own push
          // as a remote change. The order is fixed: this lock is only ever
          // taken inside the queue's, and a check never waits on the queue,
          // so neither can wait on the other in a cycle.
          const outcome = book
            ? await withSyncLock(book, attempt)
            : await attempt();
          if (outcome.done) await removeOp(head.id);
          return { kind: "ran", id: head.id, op: head.op.kind, outcome };
        });

      // One store per op, opened inside the loop and disposed in the
      // `finally`. `remote` is re-resolved on every pass, since the writer can
      // unpair mid-drain, and a store outliving the destination it was opened
      // for would digest one book's bytes under another book's path. An
      // undisposed store leaks a listener (`cacheStore.ts`, `dispose`);
      // disposing it per op costs one digest, a hash against a network round
      // trip.
      //
      // `openCacheStore` gets the project's own ref and the destination
      // `remoteFor` resolved. Do not build that target from `localProvider.id`:
      // a cached project is not always local, and the digest of
      // `local:<a remote folder id>` would serve one book's bytes for another
      // book's path.
      const store = openCacheStore({ id: ref.id, remote });
      let step: Step;
      // The claim's read covers every kick before it.
      wakeAgain.delete(key);
      try {
        step = await claim(store);
      } finally {
        store.dispose();
      }

      if (step.kind === "held") {
        // Work is held and nothing runs for it. The re-read keeps the project
        // pending, because the rows are still there and the project still owes
        // the remote these ops.
        await refresh();
        clearRetry(key);
        return;
      }

      if (step.kind === "empty") {
        // A kick that arrived after the claim read the store found this drain
        // running and returned, so its op is read now, by another claim,
        // before the drain declares the queue empty. Nothing awaits between
        // this test and the `finally`, so no kick can slip in after it.
        if (wakeAgain.delete(key)) continue;
        clearRetry(key);
        failures.delete(key);
        return;
      }
      const { outcome } = step;
      // The project's id and the kind of change, never the file's path: a
      // chapter's name can be personal.
      const about = { project: ref.id ?? null, op: step.op };
      if (!outcome.done && outcome.verdict === "lost") {
        appLog.warn(
          "sync",
          "A change found its file gone. It is skipped.",
          about,
        );
        // Not a failure: the ops behind it drain on. The row stays, stopped as
        // lost, so the notice can say so until the writer has read it.
        await markStopped(step.id, LOST);
        await refresh();
        continue;
      }
      if (!outcome.done) {
        const stop = async (): Promise<void> => {
          // The failure count is kept; `retryNow` says why.
          await markStopped(step.id, outcome.code);
          // The re-read keeps the project pending, because a stopped op is
          // still an op in the store, ordered where it was.
          await refresh();
          clearRetry(key);
        };
        // `stop` is the destination's final answer, so there is nothing to
        // back off for.
        if (outcome.verdict === "stop") {
          appLog.error("sync", "Sync stopped at a change.", {
            ...about,
            code: outcome.code,
          });
          await stop();
          return;
        }
        const consecutive = (failures.get(key) ?? 0) + 1;
        if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
          appLog.error("sync", "Sync stopped at a change after many tries.", {
            ...about,
            code: outcome.code,
            tries: consecutive,
          });
          await stop();
          return;
        }
        appLog.warn(
          "sync",
          "A change did not reach its destination. Trying again.",
          {
            ...about,
            code: outcome.code,
            try: consecutive,
          },
        );
        failures.set(key, consecutive);
        scheduleRetry(ref);
        return;
      }
      // The next step's claim re-reads the store, which drops the removed
      // op from the index.
      moved += 1;
      kinds.add(step.op);
      failures.delete(key);
      clearRetry(key);
    }
  } finally {
    if (moved > 0)
      appLog.info("sync", "A sync drain moved changes.", {
        project: ref.id ?? null,
        ops: moved,
        kinds: [...kinds].join(","),
        ms: Date.now() - began,
      });
    draining.delete(key);
    wakeAgain.delete(key);
  }
}

// One promise per project covering whatever drain work is outstanding for it,
// so a caller can wait for the worker instead of watching for its side effects.
const drains = new Map<string, Promise<void>>();

function kick(ref: QueuedProject): void {
  const key = refIdentity(ref);
  const previous = drains.get(key);
  const run = new Promise<void>((resolve) => {
    // Inside the slot, not around it: a kick waiting for a drain slot is still
    // outstanding work, and `settled` must not resolve before the waiting
    // drain has started.
    withDrainSlot(() => drainOnce(ref).finally(resolve));
  });
  drains.set(
    key,
    previous
      ? Promise.all([previous, run]).then(() => {})
      : run.catch(() => {}),
  );
}

/**
 * Resolve when this project's drain worker is not running.
 *
 * An awaitable settle point lets a caller wait for a negative outcome (the op
 * still in the store, nothing written to the remote), which `vi.waitFor`
 * cannot wait for.
 *
 * It means not running, not nothing left to do: a project holding a stopped
 * op, or waiting out a backoff, is at rest, and a settle point that waited out
 * a five-minute backoff would be useless.
 */
export function settled(ref: QueuedProject): Promise<void> {
  return drains.get(refIdentity(ref)) ?? Promise.resolve();
}

/**
 * Try again now: skip the backoff, and give this project's stopped ops another
 * chance.
 *
 * "Sync now" is `checkNow` in `useProjects.ts`, a different question. This is
 * the one path by which a writer who has fixed the cause (re-granted the
 * folder, trimmed the file) can unstick a project without reloading, and the
 * one a flow that needs this book's queue empty asks before it waits on
 * `settled`. It resolves once the drain is kicked, so a `settled`
 * after it waits for that drain.
 */
export async function retryNow(ref: QueuedProject): Promise<void> {
  clearRetry(refIdentity(ref));
  // The consecutive-failure count is not reset. Asking again buys one
  // attempt, not a fresh budget of ten: if the cause is fixed the attempt
  // lands and success clears the counter, and if not, one round trip finds
  // out. A reset would let a project that cannot succeed burn the whole cap on
  // every press.
  await clearStopped(ref);
  kick(ref);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    // `kick`, not `retryNow`: reconnecting says nothing about a refusal, an
    // oversized file or an inexpressible path, and clearing every stopped op
    // on each reconnect would burn the failure cap again. This is for ops
    // waiting out a backoff.
    const waiting = pendingRefs();
    if (waiting.length > 0)
      appLog.info(
        "sync",
        "The browser came back online with changes waiting.",
        {
          projects: waiting.length,
        },
      );
    for (const ref of waiting) kick(ref);
  });
}

/**
 * The writer dismissed the notice that changes were lost: drop those rows.
 *
 * Every project at once, because the notice is one sentence about the whole
 * device, counting files across projects. Live and stopped work stays where
 * it was.
 */
export async function forgetLostChanges(): Promise<void> {
  await forgetLost();
  staleReads.clear();
  await refresh();
}

// ── Stale reads and trusted buffers ──────────────────────────────────────────
//
// A Remote-only file whose queued change lost its working-copy entry is read
// from the remote, the best text left and older than the change.
// That read is often the first moment anything knows the change is gone, so
// it marks the loss at once. Otherwise the writer could open the file, type
// and save, and that save, made from the older text, would be the only thing
// that reached the remote.
//
// The record also tells the editor, before it restores a loss by saving its
// buffer again, whether the buffer came from such a read. A file read that way
// holds the remote's text, not the lost change, and re-saving it would clear
// the notice over a real loss. The record is per path and synchronous, because
// the editor asks right after its own read, before an async mark could land.
// It is in memory only: a reload re-reads, and a stale read records itself
// again.

const staleReads = new Set<string>();
const staleKey = (ref: ProjectAddress, path: string) =>
  `${refIdentity(ref)}\u0000${path}`;

/**
 * A read of `path` fell back to the remote while the queue owed it a put.
 * Called by `cached()` through `providerFor`, for a remote base only.
 */
export function noteStaleRead(ref: QueuedProject, path: string): void {
  staleReads.add(staleKey(ref, path));
  void runExclusive(lockKey(ref), async () => {
    const rows = await opsFor(ref);
    const live = rows.filter(
      (r) => r.op.kind === "put" && r.op.path === path && !r.stopped,
    );
    const last = live[live.length - 1];
    if (!last) return;
    await markStopped(last.id, LOST);
    await refresh();
  }).catch(() => {
    // The drain marks the same loss when it reaches the op; this mark only
    // comes earlier.
  });
}

/** Whether this session read `path` from the remote while a put was owed. */
export function readStale(ref: ProjectAddress, path: string): boolean {
  return staleReads.has(staleKey(ref, path));
}

/**
 * The editor re-saved `path` from a buffer that holds the lost change: the
 * loss is repaired, so its rows go. Only this path's, only this project's.
 */
export async function forgetLostAt(
  ref: ProjectAddress,
  path: string,
): Promise<void> {
  for (const row of await opsFor(ref)) {
    if (
      row.stopped?.code === LOST &&
      row.op.kind === "put" &&
      row.op.path === path
    ) {
      await removeOp(row.id);
    }
  }
  await refresh();
}

/**
 * Try every pending project now: re-read the store, clear every stopped op,
 * kick each one.
 *
 * This is the queue's one automatic recovery. A new session is when the cause
 * of a stopped op may have gone, such as a folder grant renewed at sign-in or
 * an adapter registered again, and one round trip per stopped project lets a
 * project heal itself. It runs on sign-in and when the writer reaches for
 * sign-out, the last attempt before they are asked whether to destroy what is
 * left.
 */
export async function drainAll(): Promise<void> {
  await refresh();
  for (const ref of await pendingProjects()) {
    await clearStopped(ref);
    kick(ref);
  }
}

// ── Reacting to a user change ────────────────────────────────────────────────
//
// The maps above are keyed by `refIdentity` with no user id. `opsFor` and
// `allPendingOps` re-scope to whoever `getCurrentUserId()` names, but the
// outgoing user's timers and index would leak into the next session, so the
// scheduling state is torn down. Work in flight is not cancelled: a drain
// mid-await for the outgoing user finds nothing once its next claim's read
// re-scopes to nobody or someone else, and stops through the no-work path.
//
// `locks`, `activeDrains` and `waitingForSlot` survive a user change.
// Clearing `locks` mid-await would let the next caller run a body that must
// be serialized against one still running; `lockKey` puts the user in the key
// instead. The slot counter counts the writes this tab makes at once, a fact
// about the machine, not about who is signed in.

function resetInMemoryState(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  backoff.clear();
  failures.clear();
  draining.clear();
  wakeAgain.clear();
  drains.clear();
  // Unconditional: a reader holding a count must hear a sign-out even when
  // the index is already empty.
  index.clear();
  snapshot = [];
  snapshotPrint = fingerprint(snapshot);
  // Otherwise the incoming user inherits the outgoing user's "your work just
  // landed" and sees a confirmation for a push that was never theirs.
  notify();
}

onUserChange((userId) => {
  resetInMemoryState();
  if (userId) void drainAll();
});

// ── The eviction interlock ───────────────────────────────────────────────────
//
// The budget in `storage/cache/budget.ts` may drop a whole project's working
// copy to stay under its ceiling, and that copy is this queue's only source.
// A project with ops still waiting is never a candidate, and only the
// queue knows which projects those are.
//
// Registered rather than imported: this module imports `openCacheStore`, so
// `budget.ts` importing the queue would be a cycle. Until this line runs,
// `enforceBudget` evicts nothing, the safe default before the rule is wired.
//
// It re-reads the store on every sweep rather than the in-memory index. The
// index refreshes on notify and a sweep is not a notify, so the index could
// give a stale answer to whether destroying a segment is safe. A read that
// fails throws through to the sweep, which then evicts nothing.
guardSegments(async () => {
  const refs = await pendingProjectsOrThrow();
  return new Set(await Promise.all(refs.map((ref) => segmentFor(ref.id))));
});

/**
 * Drop a project's whole queue. It never refuses.
 *
 * Unpairing leaves nowhere for a queued op to go. Conflict resolution has made
 * both sides match by copying, so anything still queued, such as a `rm` from
 * before the conflict, describes the pre-resolution state and would undo the
 * resolution if it drained. `purgeLocalData` calls it inside a best-effort
 * `try`/`catch` that must never block a sign-out, so a refusal would either
 * leave rows behind after a purge that promised to delete them or block the
 * sign-out.
 *
 * `drainOnce` handles an unpairing mid-drain only for the next op it reaches;
 * this clears everything at once.
 */
export async function forgetProject(ref: ProjectAddress): Promise<void> {
  clearRetry(refIdentity(ref));
  await dropOps(ref);
  await refresh();
}

/**
 * Runs a conflict resolution for this book, then drops its whole queue, with
 * the queue's lock and the book's sync lock held throughout, in that order.
 *
 * The resolution copies one side over the other and writes a rebuilt
 * manifest. A drain step running inside it would push a pre-resolution op
 * over the copy and level a baseline the rebuilt manifest then overwrites, and
 * a check would scan a half-copied side. Holding the queue's lock also means
 * no drain has claimed a head op that the drop then removes from under it.
 * When `fn` throws, the queue is kept, since nothing was resolved.
 */
export function resolving<T>(
  ref: ProjectAddress,
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runExclusive(lockKey(ref), () =>
    withSyncLock(projectId, async () => {
      const result = await fn();
      await forgetProject(ref);
      return result;
    }),
  );
}

/**
 * Whether the queue's stored rows owe the remote a `put` on `path`, read from
 * IndexedDB, so a put another tab queued counts. `pendingOpsFor` answers from
 * this tab's index, which hears only this tab's changes.
 */
export async function owesPut(
  ref: ProjectAddress,
  path: string,
): Promise<boolean> {
  return (await opsFor(ref)).some(
    (row) => row.op.kind === "put" && row.op.path === path,
  );
}

// ── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * `mirrored.ts`'s `enqueue` callback, bound to one project.
 *
 * There is no pairing gate here. The destination is resolved once, when
 * `mirrored.ts` decorates the provider, and a project without one is never
 * decorated, so the same fact decides whether there is a working copy to
 * write to and a queue to append to. An op that arrives here has a
 * destination by construction. A second check here could disagree with that
 * one, and a remote-primary project would then enqueue nothing.
 *
 * The append happens first, outside the lock. `runExclusive` is
 * `previous.then(fn, fn)`, so its body never runs synchronously, and the drain
 * holds the same lock across a network round trip. An append inside it would
 * let every save resolve before its row exists, leaving bytes in the working
 * copy with nothing to commit them, lost if the tab closes in that window.
 * Waiting for the locked body would put a remote round trip on the editor's
 * save path, which `mirrored.ts` exists to prevent.
 *
 * The order is safe because an op carries a path, never content: a
 * superseded `put` that briefly survives is a redundant round trip carrying
 * the current bytes, never a stale write.
 */
export async function enqueue(ref: QueuedProject, op: Op): Promise<void> {
  // Durable before this resolves. The caller reports "saved" on it, so nothing
  // that can throw belongs after it and nothing deferrable belongs before it.
  const appended = await appendOp(ref, op);
  await refresh();
  kick(ref);

  if (op.kind !== "put") return;
  // The coalesce runs behind the lock and is not awaited by the caller: it
  // competes with the drain over rows, and the writer never waits for it.
  //
  // Only rows older than `appended` are candidates, by id, never by path. A
  // `put` on a path it already occupies would otherwise supersede itself, and
  // a row queued after it (the next save, whose coalesce may have run first)
  // would be removed as if it were older: two quick saves would each remove
  // the other, and neither would reach the remote. Ids are the store's
  // autoincrement key, so a smaller id is an earlier append.
  void runExclusive(lockKey(ref), async () => {
    // A lost put is never superseded. The save arriving now may come
    // from the remote's older text, the file opened after its entry vanished,
    // and clearing the loss would hide the change the writer is owed a
    // sentence about. A loss leaves by dismissal, or by `forgetLostAt` after a
    // restore from a buffer known to hold it.
    const existing = (await opsFor(ref)).filter(
      (r) => r.id < appended && r.stopped?.code !== LOST,
    );
    const i = supersededIndex(
      existing.map((r) => r.op),
      op,
    );
    if (i !== -1) {
      await removeOp(existing[i].id);
      await refresh();
    }
  }).catch(() => {
    // A failed coalesce leaves both puts standing, which drains correctly at
    // the cost of one round trip. It never fails the writer's save.
  });
}
