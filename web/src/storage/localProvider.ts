// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  LOCAL_PROVIDER_ID,
  MAX_DIR_ENTRIES,
  ROOT_PATH,
  StorageError,
  baseName,
  joinPath,
  parentPath,
  type Access,
  type DirEntry,
  type FileFingerprint,
  type FileHint,
  type ProjectRef,
  type StorageProvider,
} from "./types";
import { appIcons } from "../ui/appIcons";
import { t } from "i18next";
import {
  ensureLocalRoot,
  getLocalRoot,
  projectHandleFor,
  rootPermission,
} from "./localRoot";
import { listLocalProjectsIn } from "./projectScan";
import { sha256Hex } from "../text/hash";
import { PRODUCT } from "../product";

// The local disk provider, backed by the File System Access API, which is
// Chromium-only. `isAvailable()` is the one gate the UI consults; everywhere
// else assumes support.
//
// One folder per device, chosen once, is the root, and projects are created
// and scanned directly inside it. A `ProjectRef`'s `key` is the
// project folder's name, and every path op walks root, then `<key>`, then the
// requested path. Permission is root-wide: one grant covers the subtree, so
// `canAccess` answers the same for every card and `reconnect` re-grants once
// for all of them.
//
// The writer may point the picker at their home directory by accident, so a
// listing over `MAX_DIR_ENTRIES` is refused instead of hanging the tab; the
// root scan shares the ceiling.

/**
 * `error` carrying the browser's own failure as its `cause`, so the app's log
 * can name it (`QuotaExceededError`, `NotAllowedError`). Set by hand: the app
 * builds for ES2020, whose `Error` constructor takes no `cause`.
 */
function causedBy(error: StorageError, cause: unknown): StorageError {
  return Object.assign(error, { cause });
}

/** Names never surfaced: dotfiles and dependency folders. */
function isHidden(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

/** The root handle, with the write permission this provider needs. */
async function requireRoot(): Promise<FileSystemDirectoryHandle> {
  if (!supported())
    throw new StorageError(
      "This browser cannot open local folders.",
      "unavailable",
      "storage.browserUnsupported",
    );
  const root = await getLocalRoot();
  if (!root)
    throw new StorageError(
      "This project is no longer available.",
      "not-found",
      "storage.projectGone",
    );
  // The root handle is memoized, but the permission verdict is queried fresh
  // every time.
  const access = await rootPermission();
  if (access !== "granted") {
    throw new StorageError(
      `${PRODUCT.name} needs permission to read this folder.`,
      "permission",
    );
  }
  return root;
}

// Per-project directory handles, cached against the identity of the root's
// memoized promise. This provider never renames or deletes a
// project folder (`renameFile`, `moveFile` and `removeFile` act inside one),
// so a handle for `ref.key` stays valid as long as its root does. A re-pick, a
// forget or an account change makes `getLocalRoot()` return a new promise,
// which drops this map with no cross-module event.
let dirCache: {
  rootPromise: Promise<FileSystemDirectoryHandle | null>;
  dirs: Map<string, FileSystemDirectoryHandle>;
} | null = null;

/** The project's own folder, `<ref.key>` under the root. */
async function projectDir(
  root: FileSystemDirectoryHandle,
  ref: ProjectRef,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const rootPromise = getLocalRoot();
  if (dirCache?.rootPromise !== rootPromise) {
    dirCache = { rootPromise, dirs: new Map() };
  }
  const cached = dirCache.dirs.get(ref.key);
  if (cached) return cached;
  try {
    const dir = await root.getDirectoryHandle(ref.key, { create });
    dirCache.dirs.set(ref.key, dir);
    return dir;
  } catch (err) {
    // A folder that is not under the current root is gone, not unreadable.
    // A raw `DOMException` would escape the callers' `StorageError` checks,
    // and a card whose book is in another root, or removed, would report a
    // read failure instead of a missing book. For `create: true` callers,
    // which write, a failure is a real IO error and stays one.
    if (!create)
      throw causedBy(
        new StorageError(
          "This project is no longer available.",
          "not-found",
          "storage.projectGone",
        ),
        err,
      );
    throw err;
  }
}

/** Walks to the directory at `path` in the project, creating it if asked. */
async function resolveDir(
  base: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = base;
  for (const segment of path.split("/").filter(Boolean)) {
    try {
      dir = await dir.getDirectoryHandle(segment, { create });
    } catch (err) {
      throw causedBy(
        new StorageError(
          `Folder not found: ${segment}`,
          "not-found",
          "storage.folderGone",
          { name: segment },
        ),
        err,
      );
    }
  }
  return dir;
}

/** Walks to the directory holding `path`; returns it and the last segment. */
async function resolveParent(
  base: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const name = baseName(path);
  if (!name)
    throw new StorageError("Expected a file path, got the root.", "io");
  return { dir: await resolveDir(base, parentPath(path), create), name };
}

async function fileHandleAt(
  base: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle> {
  const { dir, name } = await resolveParent(base, path, false);
  try {
    return await dir.getFileHandle(name);
  } catch (err) {
    throw causedBy(
      new StorageError(
        `File not found: ${path}`,
        "not-found",
        "storage.fileGone",
        { name: baseName(path) },
      ),
      err,
    );
  }
}

/**
 * Chromium ships `move()` on a file handle, which is atomic and keeps the
 * file's identity. It is not standard, so the fallback copies the bytes and
 * deletes the original: the same outcome, with one more step that can fail.
 */
async function relocate(
  base: FileSystemDirectoryHandle,
  fromPath: string,
  toDir: FileSystemDirectoryHandle,
  toName: string,
): Promise<void> {
  const handle = await fileHandleAt(base, fromPath);

  if (typeof handle.move === "function") {
    try {
      await handle.move(toDir, toName);
      return;
    } catch {
      // Fall through: a failed move leaves the original where it was.
    }
  }

  const content = await (await handle.getFile()).text();
  const target = await toDir.getFileHandle(toName, { create: true });
  await writeWhole(target, content);

  const { dir, name } = await resolveParent(base, fromPath, false);
  await dir.removeEntry(name);
}

/**
 * Writes `data` through one writable and closes it.
 *
 * A failed write aborts the writable. One left open keeps the file locked, so
 * the next save fails too, and an engine that truncates on open would leave
 * the half-written bytes as the file.
 */
async function writeWhole(
  handle: FileSystemFileHandle,
  data: string | Uint8Array<ArrayBuffer>,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    // An abort that throws must not replace the write's own failure.
    await writable.abort().catch(() => {});
    throw err;
  }
}

/**
 * The `localMtime` shortcut. Reading and hashing a file's whole
 * content is the expensive half of a sync check. The File System Access API
 * updates `lastModified` on every write, identical bytes included, so a file
 * whose `lastModified` matches the hint's mtime exactly has not changed since
 * that hash, and the stored hash is trusted with no grace margin. A mismatch,
 * or no hint, reads and hashes the real bytes.
 */
async function fingerprintHandle(
  file: { lastModified: number; text(): Promise<string> },
  hint?: FileHint,
): Promise<FileFingerprint> {
  if (hint && file.lastModified === hint.mtime) {
    return { hash: hint.hash, mtime: file.lastModified };
  }
  return {
    hash: await sha256Hex(await file.text()),
    mtime: file.lastModified,
  };
}

export const localProvider: StorageProvider = {
  id: LOCAL_PROVIDER_ID,
  kind: "device",
  label: () => t("sync.thisComputer"),
  icon: appIcons.local,

  isAvailable: supported,

  /**
   * Queries, never requests. `queryPermission` puts no dialog in front of the
   * writer, so this is safe for every document on the Library's first paint.
   * The ref is ignored, because no project folder has a permission of its
   * own; it is part of the port's signature.
   */
  async canAccess(ref: ProjectRef): Promise<Access> {
    void ref;
    return rootPermission();
  },

  /**
   * The pick is the permission: a fresh pick of the root grants its
   * whole subtree in every permission state, where `requestPermission` on a
   * stored handle can be blocked by the browser for good. Call it from a
   * click. Local reconnects go through the connection's own verbs.
   */
  async reopenProject(): Promise<boolean> {
    return (await ensureLocalRoot()) !== null;
  },

  /**
   * "Reveal on this device": the native picker positioned at the book's
   * folder. The book's handle needs a granted root; when the root's
   * permission has lapsed, or the book is not under it, the root handle from
   * the store serves instead, with no permission at all. `startIn` only
   * positions the dialog, so a lapsed handle is enough. The writer cancels to
   * dismiss; nothing is selected or modified.
   */
  async revealProject(ref: ProjectRef): Promise<void> {
    const handle = (await projectHandleFor(ref.key)) ?? (await getLocalRoot());
    if (!handle) return;
    try {
      await window.showDirectoryPicker?.({ startIn: handle, mode: "read" });
    } catch {
      // `AbortError` is the writer closing the picker, not a failure.
    }
  },

  async listDir(ref: ProjectRef, path: string): Promise<DirEntry[]> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const dir = path === ROOT_PATH ? base : await resolveDir(base, path, false);

    const entries: DirEntry[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (isHidden(name)) continue;
      if (entries.length >= MAX_DIR_ENTRIES) {
        throw new StorageError(
          `That folder holds more than ${MAX_DIR_ENTRIES} items — it may not be a document.`,
          "too-large",
          "storage.tooLargeFolder",
          { max: MAX_DIR_ENTRIES },
        );
      }
      entries.push({
        path: joinPath(path, name),
        name,
        kind: handle.kind === "directory" ? "folder" : "file",
      });
    }
    return entries;
  },

  async exists(ref: ProjectRef, path: string): Promise<boolean> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const name = baseName(path);
    if (!name) return true;
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await resolveDir(base, parentPath(path), false);
    } catch {
      return false;
    }
    for await (const [entryName] of dir.entries()) {
      if (entryName === name) return true;
    }
    return false;
  },

  async readFile(ref: ProjectRef, path: string): Promise<string> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const file = await (await fileHandleAt(base, path)).getFile();
    return file.text();
  },

  async writeFile(
    ref: ProjectRef,
    path: string,
    content: string,
  ): Promise<void> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, true);
    const { dir, name } = await resolveParent(base, path, true);
    try {
      const fileHandle = await dir.getFileHandle(name, { create: true });
      await writeWhole(fileHandle, content);
    } catch (err) {
      throw causedBy(new StorageError(`Could not save ${path}.`, "io"), err);
    }
  },

  async writeBytes(
    ref: ProjectRef,
    path: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, true);
    const { dir, name } = await resolveParent(base, path, true);
    try {
      const fileHandle = await dir.getFileHandle(name, { create: true });
      await writeWhole(fileHandle, bytes as Uint8Array<ArrayBuffer>);
    } catch (err) {
      throw causedBy(new StorageError(`Could not save ${path}.`, "io"), err);
    }
  },

  async createDir(ref: ProjectRef, path: string): Promise<void> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, true);
    try {
      await resolveDir(base, path, true);
    } catch (err) {
      throw causedBy(new StorageError(`Could not create ${path}.`, "io"), err);
    }
  },

  async renameFile(
    ref: ProjectRef,
    path: string,
    newName: string,
  ): Promise<void> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const dir = await resolveDir(base, parentPath(path), false);
    try {
      await relocate(base, path, dir, newName);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(`Could not rename ${path}.`, "io");
    }
  },

  async moveFile(
    ref: ProjectRef,
    fromPath: string,
    toDir: string,
  ): Promise<void> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const dir = await resolveDir(base, toDir, true);
    try {
      await relocate(base, fromPath, dir, baseName(fromPath));
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(`Could not move ${fromPath}.`, "io");
    }
  },

  async removeFile(ref: ProjectRef, path: string): Promise<void> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const { dir, name } = await resolveParent(base, path, false);
    try {
      await dir.removeEntry(name);
    } catch (err) {
      // A file already gone is a fact the layers above classify on, not an
      // io failure: the AI adapter and the queue's dead-letter logic branch
      // on the code.
      if (err instanceof DOMException && err.name === "NotFoundError")
        throw new StorageError(
          `File not found: ${path}`,
          "not-found",
          "storage.fileGone",
          { name },
        );
      throw new StorageError(`Could not remove ${path}.`, "io");
    }
  },

  /**
   * The File System Access API exposes only `lastModified`, the file's most
   * recent change. It has no creation time, and `created` is never
   * fabricated from a value that advances on every save.
   */
  async statFile(
    ref: ProjectRef,
    path: string,
  ): Promise<{ created?: string; updatedAt?: string } | null> {
    try {
      const root = await requireRoot();
      const base = await projectDir(root, ref, false);
      const handle = await fileHandleAt(base, path);
      const file = await handle.getFile();
      return { updatedAt: new Date(file.lastModified).toISOString() };
    } catch {
      return null;
    }
  },

  async fingerprintFile(
    ref: ProjectRef,
    path: string,
    hint?: FileHint,
  ): Promise<FileFingerprint> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const file = await (await fileHandleAt(base, path)).getFile();
    return fingerprintHandle(file, hint);
  },

  async fingerprintDir(
    ref: ProjectRef,
    dirPath: string,
    hints?: Map<string, FileHint>,
  ): Promise<Map<string, FileFingerprint>> {
    const root = await requireRoot();
    const base = await projectDir(root, ref, false);
    const dir =
      dirPath === ROOT_PATH ? base : await resolveDir(base, dirPath, false);

    const out = new Map<string, FileFingerprint>();
    for await (const [name, handle] of dir.entries()) {
      if (isHidden(name) || handle.kind !== "file") continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      out.set(name, await fingerprintHandle(file, hints?.get(name)));
    }
    return out;
  },
};

/**
 * Every project directly under the local root.
 *
 * No root yet, or a lapsed permission, yields `[]`; the caller decides what
 * nothing means.
 */
export async function listLocalProjects(): Promise<ProjectRef[]> {
  if (!supported()) return [];
  const root = await getLocalRoot();
  if (!root) return [];
  const permission = await rootPermission();
  if (permission !== "granted") return [];
  return listLocalProjectsIn(root);
}

/**
 * Makes a new project's folder directly inside the local root. Creation never
 * opens a picker: the mapped root is a prerequisite, and the create dialog
 * gates on it.
 *
 * No root on this device is a hard failure, not a cue to pick one: the
 * writer maps a folder in Settings first. Every caller runs inside a click,
 * where re-granting a lapsed permission is still possible.
 *
 * A folder that already holds anything is refused, not scaffolded over. An
 * existing folder full of chapters is what a writer picks by mistake, and a
 * fresh manifest written into it would orphan every one of them.
 */
export async function createLocalProject(
  folderName: string,
): Promise<ProjectRef> {
  if (!supported())
    throw new StorageError(
      "This browser cannot create local folders.",
      "unavailable",
      "storage.browserUnsupported",
    );

  const root = await getLocalRoot();
  if (!root)
    throw new StorageError(
      "Choose a local folder in Settings first — projects on this device live there.",
      "not-found",
      "storage.localRootRequired",
    );

  // The root exists but its permission may have lapsed; only a refused grant
  // fails.
  let permission = await root.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    try {
      permission = await root.requestPermission({ mode: "readwrite" });
    } catch {
      permission = "denied";
    }
  }
  if (permission !== "granted")
    throw new StorageError(
      `${PRODUCT.name} needs permission to write to this folder.`,
      "permission",
    );

  let folder: FileSystemDirectoryHandle;
  try {
    folder = await root.getDirectoryHandle(folderName, { create: true });
  } catch (err) {
    throw causedBy(
      new StorageError(`Could not create ${folderName} in that folder.`, "io"),
      err,
    );
  }

  for await (const _ of folder.keys()) {
    void _;
    throw new StorageError(
      `There is already something in ${folderName}. ${PRODUCT.name} will not write over it.`,
      "io",
      "name.folderTaken",
      { folder: folderName },
    );
  }

  return {
    providerId: LOCAL_PROVIDER_ID,
    key: folderName,
    name: folderName,
    openedAt: new Date().toISOString(),
  };
}
