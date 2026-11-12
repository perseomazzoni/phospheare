// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A concurrency cap.
//
// The Library reads one properties file per document. All at once against
// Drive, that is a burst the browser queues anyway and the API may
// rate-limit; one at a time, it is slow enough to watch. A small cap answers
// both.

/**
 * Run `work` over `items`, at most `limit` at a time.
 *
 * Results come back in the order the items were given, not the order they
 * finished, so a caller can zip them against its input. A task that rejects
 * rejects the whole run, so no caller inspects a half-filled array. An
 * aborted `signal` rejects the same way, with `signal.reason`: a superseded
 * gather stops starting new work instead of resolving with a partial array.
 *
 * `onEach` fires as each result lands, so the Library paints a card the
 * moment its document is read instead of waiting for the slowest one.
 *
 * The abort check is a synchronous read before `work()` starts the next item,
 * with no `await` of its own, so it does not shift when each item starts
 * relative to an unaborted run.
 */
export async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
  onEach?: (result: R, item: T, index: number) => void,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  // A limit below one would never start, and NaN would spawn no runners and
  // resolve to a hole-filled array; both read as one at a time.
  const wanted = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const width = Math.min(wanted, items.length);

  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < items.length) {
      if (signal?.aborted) throw signal.reason;
      const index = next++;
      const result = await work(items[index], index);
      results[index] = result;
      onEach?.(result, items[index], index);
    }
  };

  await Promise.all(Array.from({ length: width }, runner));
  return results;
}
