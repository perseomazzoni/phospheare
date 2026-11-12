// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getCurrentUserId } from "../auth/currentUser";
import { findWriter } from "../writers/registry";
import { sha256Hex } from "../text/hash";
import { isUserPurged } from "./purgeLatch";
import {
  asPortableDoc,
  emptyDoc,
  holdsLater,
  keptWhole,
  libraryOf,
  mergeDocs,
  sameContent,
  type PortableDoc,
} from "./portableDoc";
import {
  deleteProfileCopy,
  listProfileCopies,
  readProfileCopy,
  writeProfileCopy,
  type ProfileCopy,
} from "./portableDrive";
import type {
  DocumentStructure,
  DocumentType,
  NodeStat,
} from "../project/types";

// The account's preferences and library membership. The canonical copy is
// local, one `profile.<accountId>` entry per account in this site's
// localStorage, with their clocks and the tombstones of forgotten projects.
// Every read and every edit goes to it synchronously. While Remote Storage is
// connected, `mergeWithDrive` merges it with every other installation's copy
// in the account's Drive application data and writes the result back as this
// installation's own; that merge is the one asynchronous step.
//
// Every call names its account, and the merge acts only while that account
// is the signed-in one, so a merge that outlives a sign-out cannot write one
// account's profile under another's key or push it to another's Remote Storage.

/**
 * The derived card content a library row carries: title, type, counts, goal,
 * per-node stats and the spine's structure shape. Never manuscript body
 * text: this is what the copy in Remote Storage holds about a book, and a
 * field added to it widens that.
 */
export interface CardContent {
  id: string;
  /** The document's own title, which may differ from the folder's name. */
  title: string;
  type: DocumentType;
  words: number;
  parts: number;
  sections: number;
  goal: number | null;
  /** The spine glyph's source. */
  perNode: NodeStat[];
  /** The reduced shape, as `document-structure.yaml` last described it. */
  structure: DocumentStructure;
  /** `document.updatedAt`, as the file reported it. */
  updatedAt: string;
  /**
   * The card's own last-writer-wins clock: when a change to this content was
   * last observed, not when it was last looked at.
   */
  cachedAt: string;
}

export interface LibraryRow {
  /**
   * The project's identity, the uuid in its `document-properties.json`, and
   * the row's key.
   */
  id: string;
  /** Where the book is reachable today: a location, not an identity. */
  provider: string;
  key: string;
  name: string;
  openedAt: string | null;
  lastSeenAt: string | null;
  removedAt: string | null;
  /** The derived card content; null until some device has read the book. */
  card: CardContent | null;
}

// ── The local copy ───────────────────────────────────────────────────────────

/** The prefix of every account's profile key, for the sign-out sweep. */
export const PROFILE_PREFIX = "profile.";
const INSTALLATION_KEY = "installation";

interface StoredProfile {
  doc: PortableDoc;
  /** This installation's copy in Remote Storage, once written. */
  fileId: string | null;
  /**
   * SHA-256 of the body last written to Remote Storage, to skip unchanged
   * writes.
   */
  uploadedSum: string | null;
  /**
   * Drive's checksum of each other installation's copy as the last merge
   * read it, by file id: a copy still carrying it holds nothing new.
   */
  mergedSums: Record<string, string>;
  /** When the last full sync with Remote Storage finished. */
  syncedAt: string | null;
}

let installationMemo: string | null = null;

/** This browser profile's (or application's) random installation id. */
export function installationId(): string {
  if (installationMemo) return installationMemo;
  try {
    const held = localStorage.getItem(INSTALLATION_KEY);
    if (held && /^[A-Za-z0-9_-]{8,64}$/.test(held)) {
      installationMemo = held;
      return held;
    }
  } catch {
    // An installation that cannot store its id gets a new one per tab; its
    // Remote Storage copies are told apart by it all the same.
  }
  // Thirty-two characters, so the low five bits of each byte pick one with
  // equal odds; a modulo by 36 would favour the first four.
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let id = "";
  for (const b of bytes) id += "abcdefghijklmnopqrstuvwxyz234567"[b & 31];
  installationMemo = id;
  try {
    localStorage.setItem(INSTALLATION_KEY, id);
  } catch {
    // The id lasts this tab.
  }
  return id;
}

/**
 * The parsed profile per account, keyed on the stored string it came from.
 * `getPref` reads the profile on every render, and the rows carry whole
 * structure trees, so an unchanged string is never parsed again. Any write,
 * this tab's or another's, changes the string, so the memo needs no
 * invalidation. The profile handed out is shared and never mutated: an edit
 * copies what it changes (`editProfile`).
 */
const parsedProfiles = new Map<
  string,
  { raw: string; profile: StoredProfile }
>();
const memoryProfiles = new Map<string, StoredProfile>();
const volatileProfiles = new Set<string>();

/** Whether the latest local profile survives a page reload. */
export function profileDurable(writerId: string): boolean {
  return !volatileProfiles.has(writerId);
}

function emptyProfile(): StoredProfile {
  return {
    doc: emptyDoc(installationId()),
    fileId: null,
    uploadedSum: null,
    mergedSums: {},
    syncedAt: null,
  };
}

function asSums(value: unknown): Record<string, string> {
  const sums: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value))
    for (const [fileId, sum] of Object.entries(value))
      if (typeof sum === "string") sums[fileId] = sum;
  return sums;
}

/** A stored profile, or `null` when the string holds none. */
function parseProfile(raw: string): StoredProfile | null {
  const parsed = JSON.parse(raw) as Partial<
    Record<keyof StoredProfile, unknown>
  >;
  const doc = asPortableDoc(parsed.doc);
  if (!doc) return null;
  return {
    doc: { ...doc, installation: installationId() },
    fileId: typeof parsed.fileId === "string" ? parsed.fileId : null,
    uploadedSum:
      typeof parsed.uploadedSum === "string" ? parsed.uploadedSum : null,
    mergedSums: asSums(parsed.mergedSums),
    syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : null,
  };
}

function readProfile(writerId: string): StoredProfile {
  const held = memoryProfiles.get(writerId);
  if (held && volatileProfiles.has(writerId)) return held;
  let raw: string | null;
  try {
    raw = localStorage.getItem(`${PROFILE_PREFIX}${writerId}`);
  } catch {
    // Storage that cannot be read falls back to this tab's memory.
    return held ?? emptyProfile();
  }
  // Storage that holds nothing is the answer: another tab's sign-out sweep
  // removed the key, and this tab's memory of it must not outlive that.
  if (!raw) return emptyProfile();
  const memo = parsedProfiles.get(writerId);
  if (memo && memo.raw === raw) return memo.profile;
  let profile: StoredProfile | null = null;
  try {
    profile = parseProfile(raw);
  } catch {
    // Unreadable JSON reads as no profile.
  }
  if (!profile) return emptyProfile();
  parsedProfiles.set(writerId, { raw, profile });
  return profile;
}

function writeProfile(writerId: string, profile: StoredProfile): void {
  // A purged account's profile stays gone until the next account change,
  // whatever an edit or a merge still in flight hands back.
  if (isUserPurged(writerId)) return;
  memoryProfiles.set(writerId, profile);
  try {
    const raw = JSON.stringify(profile);
    localStorage.setItem(`${PROFILE_PREFIX}${writerId}`, raw);
    parsedProfiles.set(writerId, { raw, profile });
    volatileProfiles.delete(writerId);
  } catch {
    // Full or disabled storage: the edit stays this session's truth in
    // memory, and `profileDurable` says it will not survive a reload.
    volatileProfiles.add(writerId);
  }
  for (const listen of [...syncListeners]) listen();
}

/** Removes an account's local profile copy, for the sign-out purge. */
export function removeProfile(writerId: string): void {
  memoryProfiles.delete(writerId);
  volatileProfiles.delete(writerId);
  parsedProfiles.delete(writerId);
  try {
    localStorage.removeItem(`${PROFILE_PREFIX}${writerId}`);
  } catch {
    // Nothing stored is the same as nothing removed.
  }
}

/** The account's profile as stored; shared, so it must not be mutated. */
export function profileDoc(writerId: string): PortableDoc {
  return readProfile(writerId).doc;
}

/**
 * Applies one edit to the account's profile. The edit receives a copy of the
 * document whose `prefs` and `library` records are its own, which is what
 * `applyPref`, `applyAdd` and `applyRemove` change.
 *
 * @returns whether the edited profile is saved on this device.
 */
export function editProfile(
  writerId: string,
  change: (doc: PortableDoc) => void,
): boolean {
  const profile = readProfile(writerId);
  const doc: PortableDoc = {
    ...profile.doc,
    prefs: { ...profile.doc.prefs },
    library: { ...profile.doc.library },
  };
  change(doc);
  writeProfile(writerId, { ...profile, doc });
  return profileDurable(writerId);
}

const rowsByDoc = new WeakMap<PortableDoc, LibraryRow[]>();

/**
 * The live rows of the account's profile. The same array comes back until
 * the profile changes, so a caller can compare by reference.
 */
export function profileRows(writerId: string): LibraryRow[] {
  const doc = profileDoc(writerId);
  let rows = rowsByDoc.get(doc);
  if (!rows) {
    rows = libraryOf(doc);
    rowsByDoc.set(doc, rows);
  }
  return rows;
}

// ── Sync state ───────────────────────────────────────────────────────────────

export type ProfileSyncState =
  | { kind: "off" }
  | { kind: "synced"; at: string }
  | { kind: "paused"; reason: "offline" | "drive" };

const syncState = new Map<string, ProfileSyncState>();
const syncListeners = new Set<() => void>();
// One object for every writer with no state, so a `useSyncExternalStore`
// snapshot stays equal between reads and does not render in a loop.
const SYNC_OFF: ProfileSyncState = { kind: "off" };

export function profileSyncState(writerId: string): ProfileSyncState {
  return syncState.get(writerId) ?? SYNC_OFF;
}

export function subscribeProfileSync(listen: () => void): () => void {
  syncListeners.add(listen);
  return () => syncListeners.delete(listen);
}

function setSyncState(writerId: string, state: ProfileSyncState): void {
  syncState.set(writerId, state);
  for (const listen of [...syncListeners]) listen();
}

// ── The merge with Remote Storage ────────────────────────────────────────────

/**
 * This installation's copies, newest first by Drive's modified time. Two
 * appear when two tabs with no file id remembered created one each.
 */
function ownCopies(copies: ProfileCopy[], own: string): ProfileCopy[] {
  const modified = (copy: ProfileCopy) => {
    const ms = Date.parse(copy.modifiedTime ?? "");
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  // Equal times fall back to the file id, so every tab keeps the same copy.
  return copies
    .filter((copy) => copy.installation === own)
    .sort(
      (a, b) =>
        modified(b) - modified(a) ||
        (a.fileId < b.fileId ? -1 : a.fileId > b.fileId ? 1 : 0),
    );
}

/**
 * Whether the merge must read `copy`. The copy this installation last wrote
 * holds nothing the local profile lacks, and neither does another
 * installation's copy whose checksum is the one the last merge read. Every
 * other copy is read: a spare own copy, an own copy the local profile does
 * not know (after a sign-out removed it), a changed or unlisted checksum.
 */
function mustRead(copy: ProfileCopy, own: string, held: StoredProfile) {
  if (copy.installation === own) return copy.fileId !== held.fileId;
  return copy.md5 === null || held.mergedSums[copy.fileId] !== copy.md5;
}

async function syncWithDrive(writerId: string): Promise<RemoteProfile> {
  const stillOwner = () => getCurrentUserId() === writerId;
  const copies = await listProfileCopies();
  if (!stillOwner()) return "off";
  const found = copies.length > 0 ? "found" : "none";
  const own = installationId();
  const before = readProfile(writerId);
  const [newest, ...spare] = ownCopies(copies, own);
  const ownFileId = newest?.fileId ?? before.fileId;
  const reading = copies.filter((copy) => mustRead(copy, own, before));
  const bodies = await Promise.all(
    reading.map((copy) => readProfileCopy(copy.fileId)),
  );
  if (!stillOwner()) return "off";
  const now = Date.now();
  const others: PortableDoc[] = [];
  const mergedSums: Record<string, string> = {};
  for (const copy of copies) {
    if (copy.installation === own || copy.md5 === null) continue;
    if (!reading.includes(copy)) mergedSums[copy.fileId] = copy.md5;
  }
  reading.forEach((copy, i) => {
    const doc = asPortableDoc(bodies[i]);
    // The file name, not the body, names the installation a copy speaks
    // for; a copy cannot claim another installation's tie-breaks.
    if (doc) others.push({ ...doc, installation: copy.installation });
    // A copy holding entries the merge leaves out for now is read again
    // until their time comes, and one holding values this build refused is
    // read again by the build that takes them.
    if (
      copy.installation !== own &&
      copy.md5 !== null &&
      !(doc && (holdsLater(doc, now) || !keptWhole(bodies[i], doc)))
    )
      mergedSums[copy.fileId] = copy.md5;
  });
  const profile = readProfile(writerId);
  const merged = mergeDocs(profile.doc, others, now);
  const body = JSON.stringify(merged);
  const sum = await sha256Hex(body);
  if (!stillOwner()) return "off";
  let fileId = ownFileId;
  // The kept copy is written whenever spares exist, so it holds their
  // content before they are deleted below, and whenever the listing lacks
  // it: a copy put in the bin or deleted holds nothing until it is written
  // again, and a sign-out that trusted it would lose the profile.
  if (
    sum !== profile.uploadedSum ||
    fileId === null ||
    newest === undefined ||
    spare.length > 0
  ) {
    fileId = await writeProfileCopy(own, body, fileId);
  }
  if (!stillOwner()) return "off";
  const at = new Date().toISOString();
  // Edits made while the merge ran are applied again on top of it, so
  // nothing the writer did in that window is reverted.
  const latest = readProfile(writerId);
  const combined =
    latest.doc === profile.doc || sameContent(latest.doc, profile.doc)
      ? merged
      : mergeDocs(merged, [latest.doc]);
  writeProfile(writerId, {
    doc: combined,
    fileId,
    uploadedSum: sum,
    mergedSums,
    syncedAt: at,
  });
  setSyncState(writerId, { kind: "synced", at });
  // A spare copy that survives a failed delete is merged and deleted again
  // on the next merge.
  for (const copy of spare) {
    if (!stillOwner()) return found;
    await deleteProfileCopy(copy.fileId).catch(() => undefined);
  }
  return found;
}

/** How long a merge waits for another tab's merge before it fails. */
const MERGE_TURN_WAIT_MS = 20_000;

/** The last turn each account's merges and holds wait for in this tab. */
const turns = new Map<string, Promise<void>>();

/**
 * Runs `run` once the account's earlier turns in this tab have settled, so
 * a browser without the Web Locks API still takes them one at a time.
 */
function inTurn<T>(writerId: string, run: () => Promise<T>): Promise<T> {
  const turn = (turns.get(writerId) ?? Promise.resolve()).then(run);
  const settled = turn.then(
    () => undefined,
    () => undefined,
  );
  turns.set(writerId, settled);
  void settled.then(() => {
    if (turns.get(writerId) === settled) turns.delete(writerId);
  });
  return turn;
}

const mergeLock = (writerId: string) => `${PROFILE_PREFIX}merge.${writerId}`;

/**
 * Runs `merge` once no other merge of the same account, in this tab or
 * another, is running. The tabs share the local profile and its Remote
 * Storage copy, so two merges at once can each delete the copy the other
 * kept, or record an upload checksum for a body the other overwrote.
 */
function oneMergeAtATime<T>(
  writerId: string,
  merge: () => Promise<T>,
): Promise<T> {
  return inTurn(writerId, () =>
    typeof navigator === "undefined" || !("locks" in navigator)
      ? merge()
      : navigator.locks.request(
          mergeLock(writerId),
          { signal: AbortSignal.timeout(MERGE_TURN_WAIT_MS) },
          merge,
        ),
  );
}

/**
 * Runs `remove` once no merge of the account is running, in this tab or
 * another, and lets none start until it settles. Deleting the account's
 * copies and disconnecting Remote Storage go through here: an upload under way
 * would otherwise write back a copy just deleted. A merge that waited finds
 * Remote Storage disconnected and does nothing; another tab's that waits
 * longer than `MERGE_TURN_WAIT_MS` fails as unreachable.
 */
export function withMergesHeld<T>(
  writerId: string,
  remove: () => Promise<T>,
): Promise<T> {
  return inTurn(writerId, () =>
    typeof navigator === "undefined" || !("locks" in navigator)
      ? remove()
      : navigator.locks.request(mergeLock(writerId), remove),
  );
}

/**
 * What a merge found in Remote Storage: copies of the profile, none (the
 * merge wrote the first), no answer from Remote Storage, or nothing to ask
 * because Remote Storage is not connected or the account changed while it ran.
 */
export type RemoteProfile = "found" | "none" | "unreachable" | "off";

/**
 * Merges the account's profile with its other installations' copies while
 * Remote Storage is connected, and resolves what it found there. A merge
 * that fails leaves the local copy in charge and says so in
 * `profileSyncState`; it never rejects.
 */
export async function mergeWithDrive(writerId: string): Promise<RemoteProfile> {
  if (!findWriter(writerId)?.drive) {
    setSyncState(writerId, { kind: "off" });
    return "off";
  }
  try {
    return await oneMergeAtATime(writerId, async () => {
      // Remote Storage may have been disconnected while this merge waited its
      // turn.
      if (findWriter(writerId)?.drive) return syncWithDrive(writerId);
      setSyncState(writerId, { kind: "off" });
      return "off";
    });
  } catch {
    setSyncState(writerId, {
      kind: "paused",
      reason:
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "offline"
          : "drive",
    });
    return "unreachable";
  }
}
