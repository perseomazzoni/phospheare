// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo, useRef, useState } from "react";
import type { StorageProvider } from "../../storage";
import type { WriteStamps } from "../ProjectContext";

const NO_WRITES: WriteStamps = new Map();

/**
 * The same provider, saying when it has written something, and every file
 * it wrote with the stamp of its latest write.
 *
 * Every write in the editor goes through this one object, so it sees all of
 * them with nothing to maintain. Spread rather than subclassed because
 * `StorageProvider` is a plain record of functions whose optional members
 * (`renameFolder`, `folderUrl`, `trashProject`) must stay absent when absent;
 * the app above the port reads absence as the capability answer.
 *
 * `setWrites` is React's stable setter and the counter a ref, so the memo
 * keys on `base` alone and the provider keeps its identity, which the open
 * and every action depend on.
 */
export function useStampedProvider(base: StorageProvider): {
  provider: StorageProvider;
  writes: WriteStamps;
} {
  const [writes, setWrites] = useState<WriteStamps>(NO_WRITES);
  const writeCount = useRef(0);

  const provider = useMemo<StorageProvider>(
    () => ({
      ...base,
      writeFile: async (ref, path, text) => {
        await base.writeFile(ref, path, text);
        // After the write resolves, never before: a reader told early would
        // re-read bytes still on their way out.
        const stamp = ++writeCount.current;
        setWrites((now) => new Map(now).set(path, stamp));
      },
    }),
    [base],
  );

  return { provider, writes };
}
