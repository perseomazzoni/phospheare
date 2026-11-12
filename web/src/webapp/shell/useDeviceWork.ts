// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useSyncExternalStore } from "react";
import { pendingRecords, subscribe } from "../../project/sync/remoteQueue";
import { uncommittedFiles } from "../../project/sync/deviceWork";

// The queue's answer, as React state. `App` needs one value for
// `DeviceNotice`, and it lives outside React in the queue's module state;
// `useSyncExternalStore` is the whole adapter.
//
// It lives here rather than beside the queue because `project/` has no React
// imports, and rather than in `App.tsx` because that file has no test suite.
//
// `pendingRecords` must return a stable reference, and it does: the queue
// replaces its snapshot array only when the rows differ. A `getSnapshot`
// that allocates is re-read on every render, compares unequal to itself, and
// re-renders for ever.
//
// Nothing here reports success. The column is for things that are wrong, and
// the save chip's tick already says the work landed, where the writer is
// looking. An empty queue is not by itself good news: inferring success from
// an empty `pendingRecords()` would tell the writer their work reached its
// destination when it may have been discarded.

export type DeviceStatus = {
  kind: "held";
  files: number;
  stuck: boolean;
} | null;

export function useDeviceWork(): DeviceStatus {
  const records = useSyncExternalStore(
    subscribe,
    pendingRecords,
    pendingRecords,
  );
  const { files, stuck } = uncommittedFiles(records);
  return files > 0 ? { kind: "held", files, stuck } : null;
}

/**
 * How many files lost a queued change for good; zero at rest.
 *
 * Its own hook rather than a field on `DeviceStatus`: a loss is not held work,
 * it does not clear when the queue drains, and it is the one notice the writer
 * dismisses. Both read the same rows through the same subscription, so they
 * can never disagree about the queue.
 */
export function useLostChanges(): number {
  const records = useSyncExternalStore(
    subscribe,
    pendingRecords,
    pendingRecords,
  );
  return uncommittedFiles(records).lost;
}
