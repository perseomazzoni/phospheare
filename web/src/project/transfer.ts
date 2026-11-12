// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  ROOT_PATH,
  type ProjectRef,
  type StorageProvider,
} from "../storage/types";
import { EXPORT_DIR } from "./naming";

// Copying a project between backends.
//
// How a writer moves a manuscript off their disk and into Remote Storage. It
// works under the minimal `drive.file` scope, because the app creates every
// file at the destination.
//
// It takes minutes over dozens of small files, so it runs in two passes. The
// first only walks the source and counts, so the dialog says "9 of 41"
// instead of spinning, and Cancel reports how far it got.
//
// Cancelling never deletes: whatever reached the destination stays. Half a
// project in a folder the writer can see is recoverable; a tidy-up that
// erases it is not, and the app does not destroy the writer's files.

export interface CopyProgress {
  /** Files written so far. */
  done: number;
  total: number;
  /** The file being written right now. */
  path: string;
}

export interface CopyResult {
  copied: number;
  total: number;
  /** True when the writer stopped it; the files written stay. */
  cancelled: boolean;
}

export interface CopyOptions {
  onProgress?: (progress: CopyProgress) => void;
  /** Aborting stops before the next file. It never unwinds what is written. */
  signal?: AbortSignal;
  /** Called with each file's bytes once the destination holds them. */
  onCopied?: (path: string, content: string) => void;
}

interface Side {
  provider: StorageProvider;
  ref: ProjectRef;
}

export async function copyProject(
  from: Side,
  to: Side,
  { onProgress, signal, onCopied }: CopyOptions = {},
): Promise<CopyResult> {
  const { dirs, files } = await survey(from, ROOT_PATH);
  const total = files.length;

  // Depth order, so a parent is always made before its child.
  for (const dir of dirs) {
    if (signal?.aborted) return { copied: 0, total, cancelled: true };
    await to.provider.createDir(to.ref, dir);
  }

  let copied = 0;
  for (const path of files) {
    // Checked before the file rather than after, so a cancel never leaves a
    // half-written one behind.
    if (signal?.aborted) return { copied, total, cancelled: true };

    onProgress?.({ done: copied, total, path });
    // Again after announcing it: a writer who cancels while the dialog names
    // a file expects that file not to be written.
    if (signal?.aborted) return { copied, total, cancelled: true };

    const content = await from.provider.readFile(from.ref, path);
    await to.provider.writeFile(to.ref, path, content);
    onCopied?.(path, content);
    copied += 1;
  }

  return { copied, total, cancelled: false };
}

/** Every folder and every file under `path`, without writing anything. */
export async function survey(
  from: Side,
  path: string,
): Promise<{ dirs: string[]; files: string[] }> {
  const dirs: string[] = [];
  const files: string[] = [];

  const walk = async (at: string): Promise<void> => {
    for (const entry of await from.provider.listDir(from.ref, at)) {
      // Exports are binary, and this copy reads every file as text, so a PDF
      // would arrive corrupted. The app can make them again at will, so the
      // copy skips them.
      if (entry.path === EXPORT_DIR) continue;
      if (entry.kind === "folder") {
        dirs.push(entry.path);
        await walk(entry.path);
      } else {
        files.push(entry.path);
      }
    }
  };

  await walk(path);
  return { dirs, files };
}
