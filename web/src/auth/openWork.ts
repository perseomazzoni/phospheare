// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Unsaved work open in this tab, written before the account is cleared.
//
// Clearing the account unmounts the editor, and the editor has no save on
// unmount: a writer who chose "Don't save" means it. A sign-out is not that
// choice, whether it starts in this tab or another, so the account layer asks
// every holder of open work to write it first. A module rather than a
// context, because the account layer sits above the editor and cannot read
// its state.

import { appLog, describeError } from "../log";

const holders = new Set<() => Promise<unknown>>();

/**
 * How long the account layer waits for open work, in milliseconds. A write
 * that hangs ends the attempt without clearing the account. A timeout is not
 * evidence of preservation; the open editor retains its buffer for retry.
 */
const OPEN_WORK_WAIT_MS = 5_000;

/** Registers a write of open work; the returned function unregisters it. */
export function holdOpenWork(write: () => Promise<unknown>): () => void {
  holders.add(write);
  return () => {
    holders.delete(write);
  };
}

/**
 * True only when every holder confirms preservation within the wait: a
 * holder confirms by resolving to anything but `false`. Never rejects.
 */
export async function writeOpenWork(): Promise<boolean> {
  if (holders.size === 0) return true;
  let failed = 0;
  let firstError: unknown = null;
  const writes = [...holders].map(async (write) => {
    try {
      return (await write()) !== false;
    } catch (err) {
      if (failed === 0) firstError = err;
      failed += 1;
      return false;
    }
  });
  const holderCount = writes.length;
  // One line for every failed write, once all have settled.
  void Promise.all(writes).then(() => {
    if (failed > 0) {
      appLog.warn("account", "Open work could not be written.", {
        holders: holderCount,
        failed,
        ...describeError(firstError),
      });
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), OPEN_WORK_WAIT_MS);
  });
  try {
    return await Promise.race([
      Promise.all(writes).then((results) => results.every(Boolean)),
      waited,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
