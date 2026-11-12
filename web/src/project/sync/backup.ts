// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { APP_CACHE_DIR } from "../naming";
import type { ProjectRef, StorageProvider } from "../../storage/types";
import { isNotFound } from "./scan";

// The conflict backup. It is always written to the local disk, whichever side
// a resolution keeps, because that is the one place the writer can look
// afterward. The dotfile filter that hides `APP_CACHE_DIR` from `listDir` on
// local (the remote has no hidden folder) keeps this folder out of sync, out
// of `copyProject`'s survey and out of stats.
//
// It is written before the resolution's `copyProject` overwrites the
// discarded side, after which the discarded bytes are gone.

interface Side {
  provider: StorageProvider;
  ref: ProjectRef;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function readOrNull(side: Side, path: string): Promise<string | null> {
  try {
    return await side.provider.readFile(side.ref, path);
  } catch (err) {
    // Nothing to preserve for a path the side never had, such as a one-sided
    // addition resolved the other way, so `not-found` is not a backup
    // failure.
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Copies the discarded side's current bytes for `paths` into
 * `local:<APP_CACHE_DIR>/conflicts/<ISO>/<path>`. Returns the backup folder's
 * path so the resolution UI can name it, or `null` when no file needed
 * saving.
 *
 * Given `kept`, the side whose bytes will overwrite these paths, a path that
 * already holds the same bytes on both sides is skipped: the overwrite loses
 * nothing there.
 */
export async function backupLoser(
  discarded: Side,
  local: Side,
  paths: readonly string[],
  kept?: Side,
): Promise<string | null> {
  const backupDir = `${APP_CACHE_DIR}/conflicts/${timestamp()}`;
  let saved = 0;

  for (const path of paths) {
    const content = await readOrNull(discarded, path);
    if (content === null) continue;
    if (kept && (await readOrNull(kept, path)) === content) continue;
    await local.provider.writeFile(local.ref, `${backupDir}${path}`, content);
    saved += 1;
  }

  return saved > 0 ? backupDir : null;
}
