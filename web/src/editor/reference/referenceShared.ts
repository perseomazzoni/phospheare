// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RECYCLE_BIN_DIR, REFERENCE_DIR } from "../../project/naming";
import { referenceGroupOf } from "../../project/reference";
import type { ProjectRef, StorageProvider } from "../../storage";

// Reading the reference folder. Every reader of it (the dock's reference and
// notes faces, the tree's notes link) must agree on what changed, so a
// revision counter coordinates them: any consumer's `reload()` bumps the
// global and every mounted consumer re-lists.

let globalRevision = 0;
const globalListeners = new Set<() => void>();

/**
 * Say the reference folder changed, to every mounted reader of it. Any code
 * that writes into `reference/` from outside these hooks calls this after the
 * write lands, or the shelf shows the file only after a remount.
 */
export function referenceFolderChanged(): void {
  globalRevision += 1;
  for (const l of globalListeners) l();
}

/**
 * The folder's revision, for a consumer that reads a file in it rather than
 * the listing: the reader, whose open summary an update rewrites in place
 * under the same name, which a listing alone would not notice.
 */
export function useReferenceRevision(): number {
  const [revision, setRevision] = useState(globalRevision);
  useEffect(() => {
    const listener = () => setRevision(globalRevision);
    globalListeners.add(listener);
    // A bump between the first render and this subscription is caught here.
    setRevision(globalRevision);
    return () => {
      globalListeners.delete(listener);
    };
  }, []);
  return revision;
}

/**
 * Read the folder.
 *
 * `listDir` is shallow and throws on a missing folder, the ordinary case on
 * Remote Storage, where a folder nobody has written to may not exist. That reads as an
 * empty list, not an error.
 */
export function useReferenceFiles(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
): { files: string[]; reload: () => void } {
  return useFolderFiles(provider, projectRef, REFERENCE_DIR);
}

/**
 * The binned reference documents, from the project's one recycle bin, told
 * apart from manuscript files by prefix. Do not add a subfolder, which would
 * be a second naming scheme to keep in step.
 *
 * It shares the revision counter, so binning a document refreshes the shelf
 * and the bin in the same pass.
 */
export function useBinnedReferenceFiles(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
): { files: string[]; reload: () => void } {
  const { files, reload } = useFolderFiles(
    provider,
    projectRef,
    RECYCLE_BIN_DIR,
  );
  const binned = useMemo(
    () => files.filter((name) => referenceGroupOf(name) !== null),
    [files],
  );
  return { files: binned, reload };
}

function useFolderFiles(
  provider: StorageProvider,
  projectRef: ProjectRef | null,
  dir: string,
): { files: string[]; reload: () => void } {
  const [files, setFiles] = useState<string[]>([]);
  const revision = useReferenceRevision();
  const reload = useCallback(() => referenceFolderChanged(), []);

  useEffect(() => {
    if (!projectRef) {
      setFiles([]);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const entries = await provider.listDir(projectRef, dir);
        if (live)
          setFiles(entries.filter((e) => e.kind === "file").map((e) => e.name));
      } catch {
        if (live) setFiles([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [provider, projectRef, dir, revision]);

  return { files, reload };
}
