// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Storage abstraction ──────────────────────────────────────────────────────
//
// The app does not own the writer's files. A project is an ordinary folder
// wherever the writer keeps it: local disk, Google Drive, or another remote.
// Everything above this layer speaks in POSIX-style paths relative to the
// document root ("/" is the root itself), so providers stay interchangeable.
//
// A backend that addresses files by opaque id resolves a path by walking its
// folder listings, behind the same port.

import type { IconName } from "../ui/icons";

export type EntryKind = "folder" | "file";

/** One item in a folder listing. `path` is absolute within the project. */
export interface DirEntry {
  /** Such as '/Part One/opening.md': starts with '/', never ends with one. */
  path: string;
  name: string;
  kind: EntryKind;
}

/** Where a document the writer has opened lives. Serialisable. */
export interface ProjectRef {
  providerId: string;
  /** Opaque and provider-owned: the folder name on disk, the id on Drive. */
  key: string;
  /** The root folder's name: the project name and the tree's root label. */
  name: string;
  openedAt: string;
}

/**
 * Thrown when a provider cannot reach the document (permission lost, deleted).
 *
 * `code` is the routing axis: the sync layer, the Library card state machine
 * and the queue's dead-letter logic switch on it, so it never changes for copy
 * reasons. `message` is technical prose for logs, and the UI never reads it.
 * `storageErrorMessage` resolves the writer-facing string from `key` and
 * `params`, so the writer reads their own language whatever the throw site
 * wrote.
 */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly code:
      | "permission"
      | "not-found"
      | "too-large"
      | "unavailable"
      | "io"
      // The device has no room left. Kept apart from `too-large`, which the
      // queue classes as permanent and dead-letters: `too-large` says the
      // content will never fit, this says there is no room now, and it heals.
      | "no-space"
      // A path that cannot be expressed: empty, or carrying `..`, `.`, a
      // backslash or a NUL. The one code on the source axis that means stop
      // now rather than try again. Every other source failure is about a
      // moment (a lapsed grant, a busy disk, an evicted entry), while a name
      // that is not a name never becomes one. As `io`, an unusable path would
      // burn the whole consecutive-failure budget against a remote that is not
      // the problem.
      | "unusable-path",
    readonly key?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Whether a document can be read now, without asking the writer.
 *
 *   granted        readable this instant
 *   needs-gesture  still there; the browser wants a click before a read
 *   gone           this browser has no way to reach it
 *
 * Three states, not a boolean, because the last two need different words in
 * front of a writer: one is "press this", the other is "it is not here".
 */
export type Access = "granted" | "needs-gesture" | "gone";

/**
 * Where a provider's bytes live, and the one axis the app above this port may
 * branch on.
 *
 *   device  bound to this machine: the writer's own disk, reached through a
 *           handle that cannot travel and whose permission may lapse
 *   remote  reached over the network from any machine the writer signs in
 *           on, and therefore the side a queue commits to
 *
 * Do not ask `providerId === driveProvider.id` to mean "is this remote": it
 * answers "is this Google Drive", which stops being the same question when a
 * second remote is registered.
 */
export type ProviderKind = "device" | "remote";

/**
 * The id a local folder's ref carries, declared in the leaf module so the
 * provider, the root and the scan spell it once. A scan stamping an unknown
 * id reads as a backend nobody implements.
 */
export const LOCAL_PROVIDER_ID = "local";

/**
 * The most entries one directory listing pages through before refusing.
 * Shared by the port's `listDir` and the root scan, which walks the picked
 * folder directly. The root is any folder the writer chooses, so an
 * accidental home-directory pick is refused instead of probed entry by entry.
 */
export const MAX_DIR_ENTRIES = 5000;

/**
 * The most bytes one `readFile` takes from a backend before refusing.
 *
 * Without it, a remote says how many bytes to allocate and the adapter obliges.
 * Under `drive.file` the only reachable files are ones this app created, so
 * this guards against a corrupt or runaway file rather than an attacker. It
 * pairs with `MAX_DIR_ENTRIES`: the two questions a backend answers with an
 * unbounded number.
 *
 * 32 MiB is far above any plausible manuscript file (the AI path refuses a
 * source over 2,000,000 characters) and far below a number that hurts.
 */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

export interface StorageProvider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: () => string;
  readonly icon: IconName;

  /**
   * False when the runtime cannot support it (local disk on Firefox, for one).
   */
  isAvailable(): boolean;

  /** Re-establishes access to an opened document, as after a reload. */
  reopenProject(ref: ProjectRef): Promise<boolean>;

  /**
   * Whether this document can be read without asking.
   *
   * Never prompts. The Library calls it for every document at once, on mount,
   * where a permission dialog would be unbidden and, outside a user gesture,
   * refused anyway. It reports what is true now; `reopenProject`, from a
   * click, changes it.
   */
  canAccess(ref: ProjectRef): Promise<Access>;

  /**
   * The immediate contents of one folder. Shallow: a project keeps every Part
   * and Section side by side in `document/`, so a recursive walk would only
   * find things it has no business showing.
   */
  listDir(ref: ProjectRef, path: string): Promise<DirEntry[]>;

  exists(ref: ProjectRef, path: string): Promise<boolean>;

  readFile(ref: ProjectRef, path: string): Promise<string>;

  /**
   * Creates or overwrites a file. Resolves to the file's id on providers that
   * have one (Drive), void elsewhere; the sync layer persists it as the
   * baseline's `remoteFileId`.
   */
  writeFile(
    ref: ProjectRef,
    path: string,
    content: string,
  ): Promise<string | void>;

  /**
   * Creates or overwrites a binary file: an export. Every other file
   * the app writes is text, and the working copy and queue that carry a
   * remote project's text are text-only, so this is optional and its absence
   * is the answer. The `cached` and `mirrored` wrappers do not offer it; an
   * export goes to the bare provider of each of the book's homes. An export
   * can be regenerated at will, so it does not belong in a disposable cache
   * or in a queue that promises the writer's work.
   *
   * Ask the bare provider, `getProvider(ref.providerId)`, never the one a
   * reader of the book holds: for a project with a remote that is a wrapper,
   * and it always answers no.
   */
  writeBytes?(
    ref: ProjectRef,
    path: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<void>;

  /**
   * The id of the file at `path` when the provider has ids and the path
   * resolves, `null` otherwise. Only Drive implements it.
   */
  fileIdOf?(ref: ProjectRef, path: string): Promise<string | null>;

  /**
   * A web address where the writer can see this project's folder on the
   * backend, or `null` when there is none.
   *
   * Synchronous, because for every backend that has one it is a pure function
   * of the ref: Drive's folder id is the URL's last segment. A device provider
   * does not implement it: a folder on disk has no address.
   */
  folderUrl?(ref: ProjectRef): string | null;

  /**
   * Sends this project's whole folder to the backend's bin.
   *
   * Its absence is why the Library offers Delete on remote cards only: a
   * remote has a bin the writer can restore from, and the File System Access
   * API has none. A device provider holding the root could remove a book with
   * a recursive `removeEntry`, but it would be gone for good. So a device
   * provider does not implement this.
   */
  trashProject?(ref: ProjectRef): Promise<void>;

  createDir(ref: ProjectRef, path: string): Promise<void>;

  /** Renames in place, keeping the file in its folder. */
  renameFile(ref: ProjectRef, path: string, newName: string): Promise<void>;

  /**
   * Renames the project's own folder in place, and resolves to its new name.
   * Only Drive implements it: the File System Access API renames through
   * `move()`, which works on a directory only inside the origin-private file
   * system, never on the writer's disk.
   */
  renameFolder?(ref: ProjectRef, newName: string): Promise<string>;

  /** Moves to another folder under the same name, creating it if needed. */
  moveFile(ref: ProjectRef, fromPath: string, toDir: string): Promise<void>;

  removeFile(ref: ProjectRef, path: string): Promise<void>;

  /**
   * File timestamps, implemented only by providers that have them cheaply.
   * The two fields are independent: a provider with no creation time (the
   * File System Access API has none) returns only `updatedAt`, and `created`
   * is never fabricated from a value that means something else.
   */
  statFile?(
    ref: ProjectRef,
    path: string,
  ): Promise<{ created?: string; updatedAt?: string } | null>;

  /**
   * Positions the native picker at the project's folder, the closest the web
   * platform gets to revealing it in a file manager: there is no path to hand
   * the OS. Only providers whose platform has a picker implement it. Never
   * prompts for permission and never modifies the folder.
   */
  revealProject?(ref: ProjectRef): Promise<void>;

  /**
   * Whether the bytes at this path changed since the last sync, answered
   * without downloading them. Mandatory: every adapter can compute one (Drive
   * from the API, local and memory by hashing).
   *
   * `hint` is the caller's last-known `(mtime, hash)` for this path
   * (`FileBaseline.localMtime` in `sync/manifest.ts` plus its stored hash). A
   * provider that can cheaply detect "unchanged since that mtime" (local, via
   * `lastModified`) may trust the hint's hash instead of re-reading the file.
   * The mtime must match exactly, with no grace margin. A provider with no
   * such signal (Drive, memory) ignores the hint.
   *
   * `hash` is not provider-opaque. Two sites compare a local hash directly
   * against Drive's checksum: the no-baseline path in `compare.ts` (every
   * newly paired project, every new file, and manifest-loss recovery), and
   * the post-push baseline write in `remoteQueue.ts`, which stores one local
   * hash into both sides. That holds only while `localProvider.fingerprintFile`
   * and Drive's `sha256Checksum` agree: both are SHA-256 over UTF-8 bytes with
   * no BOM, and neither normalizes line endings (`sha256Hex` in `text/hash.ts`
   * does no CRLF handling; `hashOf` there is a different hash, for snapshot
   * integrity). A fingerprint that is not Drive-identical for identical
   * content, such as `lastModified + size`, would silently break both sites.
   * `weak` marks a Drive fingerprint with no real checksum.
   */
  fingerprintFile(
    ref: ProjectRef,
    path: string,
    hint?: FileHint,
  ): Promise<FileFingerprint>;

  /**
   * Every file directly inside one folder, fingerprinted in the request that
   * lists it. One `fingerprintFile` call per file turns a
   * 100-file project into 100 round trips per side, per check. Drive folds
   * `sha256Checksum` and `modifiedTime` into the listing it already makes;
   * local and memory walk the folder and apply the same `hints` per file.
   * Mandatory, for the same reason as `fingerprintFile`.
   *
   * Keyed by name, not path: the caller knows the directory it asked about.
   * `hints` mirrors `fingerprintFile`'s `hint`, keyed by name within this
   * directory.
   */
  fingerprintDir(
    ref: ProjectRef,
    dirPath: string,
    hints?: Map<string, FileHint>,
  ): Promise<Map<string, FileFingerprint>>;
}

export interface FileFingerprint {
  hash: string;
  /** Set when the provider had no real checksum and used a weaker signal. */
  weak?: boolean;
  /**
   * The provider's own "last changed" signal, read from the same file read
   * the hash came from; set only by a provider that trusts it for `hint`
   * matching (local's `lastModified`). It becomes a fresh baseline's
   * `FileBaseline.localMtime`; a wall-clock value there would almost never
   * match a real `lastModified`, silently disabling the shortcut.
   */
  mtime?: number;
}

/** A last-known `(mtime, hash)` pair, as `fingerprintFile` takes it. */
export interface FileHint {
  mtime: number;
  hash: string;
}

// ── Path helpers ─────────────────────────────────────────────────────────────
// Shared so every provider and the tree builder agree on the shape of a path.
// The root is '/'; every other path is '/a/b' with no trailing slash.

export const ROOT_PATH = "/";

export function joinPath(parent: string, name: string): string {
  return parent === ROOT_PATH ? `/${name}` : `${parent}/${name}`;
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? ROOT_PATH : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
