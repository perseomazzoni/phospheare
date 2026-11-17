// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  ARC_PREFIX,
  MD_EXT,
  RECYCLE_BIN_DIR,
  REFERENCE_DIR,
  SUMMARY_PREFIX,
} from "../../project/naming";
import { characterFileNameForArc } from "../../project/reference";
import type { ProjectRef, StorageProvider } from "../../storage";
import { appLog, describeError } from "../../log";

// The one delete seam for reference documents, the twin of
// `referenceWrite.ts`.
//
// Authored material is binned; derived material is removed. A character
// sheet the writer filled in by hand is as losable as a chapter, so it goes
// to `recyclebin/` as a removed Part or Section does. A generated summary is
// removed outright: the assistant remakes it on demand.
//
// One bin. A binned document lands in `recyclebin/` beside the manuscript
// files, told apart by prefix: `referenceGroupOf` is non-null for a reference
// document and `null` for a `part--` or `section--` file. A name already in
// the bin is overwritten, because the newer deletion is what the writer
// means.

/** Whether the assistant can make this file again, unlike the writer's own. */
export function isDerivedReference(fileName: string): boolean {
  return fileName.startsWith(SUMMARY_PREFIX);
}

/**
 * Delete one reference document the way its kind deserves. Returns `false`
 * when the port refused, so the caller can say so.
 */
export async function deleteReference(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  fileName: string,
): Promise<boolean> {
  if (!projectRef) return false;
  const path = `${REFERENCE_DIR}/${fileName}`;
  const toBin = !isDerivedReference(fileName);
  try {
    if (toBin) await provider.moveFile(projectRef, path, RECYCLE_BIN_DIR);
    else await provider.removeFile(projectRef, path);
    return true;
  } catch (err) {
    appLog.warn("reference", "A reference document could not be deleted.", {
      toBin,
      ...describeError(err),
    });
    return false;
  }
}

/**
 * Put a binned reference document back.
 *
 * An arc brings its character: the pair is bound by the stem alone, and an
 * arc whose character is gone shows nowhere. The character goes first, as on
 * the way out, so a failed second move leaves a character and no arc rather
 * than an arc pointing at a character still in the bin. The character is
 * moved only when it is in the bin.
 *
 * A restore never overwrites: a move onto a taken name replaces it on every
 * backend. When any file of the restore is taken in `reference/`, every file
 * of it comes back as `<stem> (n)`, the first `n` free in both folders, so a
 * pair keeps the stems that bind it.
 */
export async function restoreReference(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  fileName: string,
): Promise<boolean> {
  if (!projectRef) return false;
  try {
    const restoring = [fileName];
    if (fileName.startsWith(ARC_PREFIX)) {
      const character = characterFileNameForArc(fileName);
      if (await provider.exists(projectRef, `${RECYCLE_BIN_DIR}/${character}`))
        restoring.unshift(character);
    }

    const free = await freeSuffix(provider, projectRef, restoring);
    for (const name of restoring) {
      const back = withSuffix(name, free);
      if (back !== name)
        await provider.renameFile(
          projectRef,
          `${RECYCLE_BIN_DIR}/${name}`,
          back,
        );
      await provider.moveFile(
        projectRef,
        `${RECYCLE_BIN_DIR}/${back}`,
        REFERENCE_DIR,
      );
    }
    return true;
  } catch (err) {
    appLog.warn("reference", "A reference document could not be restored.", {
      ...describeError(err),
    });
    return false;
  }
}

/** Above any count of same-named restores a writer makes by hand. */
const MAX_SUFFIX = 999;

/**
 * The suffix the restored files take: `0` when every name is free in
 * `reference/`, otherwise the first `n` from 2 whose suffixed names are free
 * in `reference/` and in the bin, where the rename happens.
 *
 * @throws when no suffix up to `MAX_SUFFIX` is free, so the caller reports a
 *   failure and the files stay in the bin.
 */
async function freeSuffix(
  provider: StorageProvider,
  projectRef: ProjectRef,
  names: readonly string[],
): Promise<number> {
  const taken = async (name: string, dirs: readonly string[]) => {
    for (const dir of dirs)
      if (await provider.exists(projectRef, `${dir}/${name}`)) return true;
    return false;
  };
  const anyTaken = async (n: number, dirs: readonly string[]) => {
    for (const name of names)
      if (await taken(withSuffix(name, n), dirs)) return true;
    return false;
  };

  if (!(await anyTaken(0, [REFERENCE_DIR]))) return 0;
  for (let n = 2; n <= MAX_SUFFIX; n++)
    if (!(await anyTaken(n, [REFERENCE_DIR, RECYCLE_BIN_DIR]))) return n;
  // The count, not the names: they are the writer's, and a failure can reach
  // the app's log.
  throw new Error(`no free name for ${names.length} reference files`);
}

/** `note--idea (2).md` for `note--idea.md` at `2`; the name itself at `0`. */
function withSuffix(fileName: string, n: number): string {
  if (n === 0) return fileName;
  const ext = fileName.toLowerCase().endsWith(MD_EXT)
    ? fileName.slice(-MD_EXT.length)
    : "";
  return `${fileName.slice(0, fileName.length - ext.length)} (${n})${ext}`;
}
