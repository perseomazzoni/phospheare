// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/// <reference types="vite/client" />

// ── Build values ─────────────────────────────────────────────────────────────
// Set by `vite.config.ts` and read only by `release/compose.ts`.

/** The version this build runs, without the tag's `v`. */
declare const __APP_VERSION__: string;
/** Where the newest release is read; empty when this build checks nothing. */
declare const __RELEASE_FEED__: string;
/** The source tag of a release build, or empty for a local build. */
declare const __RELEASE_TAG__: string;

// ── File System Access API ───────────────────────────────────────────────────
// TypeScript's lib.dom ships FileSystemDirectoryHandle and createWritable, and
// lib.dom.asynciterable adds entries(). The picker and the permission methods
// are still missing, so they are declared here.

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface FileSystemHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

// Chromium ships move() but the spec has not landed it yet, so it is optional
// here — localProvider feature-detects and falls back to copy-then-delete.
interface FileSystemFileHandle {
  move?: (
    destination: FileSystemDirectoryHandle | string,
    name?: string,
  ) => Promise<void>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?:
    | FileSystemHandle
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
}

interface Window {
  showDirectoryPicker?: (
    options?: DirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandle>;
}
