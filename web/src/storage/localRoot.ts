// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getHandle, putHandle, removeHandle } from "./handleStore";
import { onUserChange } from "../auth/currentUser";
import { appLog, describeError } from "../log";
import {
  LOCAL_PROVIDER_ID,
  StorageError,
  type Access,
  type ProjectRef,
} from "./types";

// ── The one local root ───────────────────────────────────────────────────────
//
// Local disk has one folder, chosen once, and the folder the writer picks is
// the root: projects are created and scanned directly inside it, with nothing
// nested and nothing scaffolded. Unlike a remote, local disk has no
// `APP_DIR` folder.
//
// Picking a different root stops scanning the old root's books, which stay
// on disk untouched, and the shelf reconciles to the new one.

export const LOCAL_ROOT_KEY = "root";

/**
 * The root's ref: the picked folder itself. `name` is the folder's own name,
 * as a file manager shows it, never an app label: on local disk the app made
 * and named no folder.
 */
function rootRef(name: string): ProjectRef {
  return {
    providerId: LOCAL_PROVIDER_ID,
    key: LOCAL_ROOT_KEY,
    name,
    openedAt: new Date().toISOString(),
  };
}

// ── The picker seam ──────────────────────────────────────────────────────────
//
// The File System Access API needs a native picker no test can drive, so the
// seam is a swap-in picker that only dev builds accept.
//
// The browser shows the picker only inside a user gesture, so every caller of
// `ensureLocalRoot` runs straight out of a click.

type RootPicker = () => Promise<FileSystemDirectoryHandle | null>;
let testPicker: RootPicker | null = null;

export function __setLocalRootPickerForTest(picker: RootPicker | null): void {
  if (!import.meta.env.DEV) return;
  testPicker = picker;
}

async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (testPicker) return testPicker();
  const picker = window.showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker.call(window, {
      mode: "readwrite",
      // The browser remembers the last folder per id, within this origin
      // only, so a neutral id is enough.
      id: "library-root",
    });
  } catch (err) {
    // `AbortError` means the writer closed the picker, not a failure.
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw new StorageError(
      "Could not open that folder.",
      "io",
      "library.openFailed",
    );
  }
}

/**
 * Picks a folder and stores it as the root, the one-time setup or a re-setup.
 * Re-picking replaces the stored root.
 *
 * Resolves the root's ref, or `null` when the writer closed the picker.
 * Throws on a real failure (permission denied by the platform, an unreadable
 * folder).
 */
export async function ensureLocalRoot(): Promise<ProjectRef | null> {
  const picked = await pickFolder();
  if (!picked) return null;

  await putHandle(LOCAL_ROOT_KEY, picked);
  invalidateRootCache();
  return rootRef(picked.name);
}

// ── Root handle memoization ──────────────────────────────────────────────────
//
// The root changes only on a re-pick or a forget, both through this module,
// so the IndexedDB read is memoized between them. The permission
// verdict is not memoized: `rootPermission` queries it live.

let cachedRootPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

function invalidateRootCache(): void {
  cachedRootPromise = null;
}

// The memo must not outlive its writer: the handle in IndexedDB is keyed per
// writer, but module state is not, so the next writer's `getLocalRoot()` would
// answer with the previous writer's handle.
onUserChange(() => invalidateRootCache());

/** Test-only: drops the cached root so the next `getLocalRoot()` re-reads. */
export function __resetLocalRootCacheForTest(): void {
  if (!import.meta.env.DEV) return;
  invalidateRootCache();
}

/** The root handle, or `null` when this device has no local root. */
export function getLocalRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!cachedRootPromise) {
    cachedRootPromise = getHandle(LOCAL_ROOT_KEY).catch((err: unknown) => {
      invalidateRootCache();
      throw err;
    });
  }
  return cachedRootPromise;
}

/**
 * Forgets the mapped root, the local twin of the Remote Storage disconnect.
 * The handle leaves IndexedDB; the books stay on disk untouched. The caller
 * drops the local cards and re-gathers, so the row returns to "Choose local
 * folder": a remap is Forget then Choose, never a silent swap under the
 * writer.
 */
export async function forgetLocalRoot(): Promise<void> {
  await removeHandle(LOCAL_ROOT_KEY);
  invalidateRootCache();
}

/**
 * The handle of one project folder, `<key>` under the root, or `null` when
 * the root or the folder is missing. As a picker's `startIn`, it is the
 * closest the web platform gets to revealing a book in a file manager.
 */
export async function projectHandleFor(
  key: string,
): Promise<FileSystemDirectoryHandle | null> {
  const root = await getLocalRoot();
  if (!root) return null;
  try {
    return await root.getDirectoryHandle(key);
  } catch {
    return null;
  }
}

/** Whether this browser can open a folder (File System Access API). */
export function localFoldersSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

/**
 * Whether the root can be read now, without asking the writer.
 *
 * Queries, never requests: the Library calls it for every local card at once,
 * where a permission dialog would be unbidden and refused. File System Access
 * grants descend, so one answer holds for every book under the root.
 */
export async function rootPermission(): Promise<Access> {
  if (!localFoldersSupported()) return "gone";
  const root = await getLocalRoot();
  if (!root) return "gone";
  try {
    const permission = await root.queryPermission({ mode: "readwrite" });
    return permission === "granted" ? "granted" : "needs-gesture";
  } catch (err) {
    // A handle the browser will not answer about cannot be used. The Library
    // asks for every local card at once, so the failure is written once.
    if (!permissionFailureLogged) {
      permissionFailureLogged = true;
      appLog.warn(
        "storage",
        "The browser would not say whether the local folder can be read.",
        { ...describeError(err) },
      );
    }
    return "gone";
  }
}

let permissionFailureLogged = false;

// The folder picker is the one way access is granted or re-granted.
// A fresh pick grants its subtree in every permission state, so reconnect is
// `ensureLocalRoot`: the writer chooses the folder again and the work
// unlocks. This module never calls `requestPermission` on a stored handle,
// because Chrome remembers a block and then silently denies forever.
