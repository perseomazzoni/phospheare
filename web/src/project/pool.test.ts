// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { pooled } from "./pool";

/** A task that resolves only when told to, so concurrency can be observed. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("pooled", () => {
  it("returns results in the order of the items, not of completion", async () => {
    const results = await pooled([10, 20, 30, 40], 2, async (n, i) => {
      // Reverse the finishing order relative to the input.
      await new Promise((r) => setTimeout(r, (4 - i) * 5));
      return n * 2;
    });
    expect(results).toEqual([20, 40, 60, 80]);
  });

  it("never runs more than the limit at once", async () => {
    // Every item waits on its own gate, so what runs at once is set by the
    // test, never by a timer.
    const gates = Array.from({ length: 10 }, () => gate());
    let running = 0;
    let peak = 0;
    const run = pooled(
      gates.map((_, i) => i),
      4,
      async (i) => {
        running += 1;
        peak = Math.max(peak, running);
        await gates[i].promise;
        running -= 1;
        return i;
      },
    );
    const settle = async () => {
      for (let n = 0; n < 5; n++) await Promise.resolve();
    };

    await settle();
    expect(running).toBe(4);
    for (const g of gates) {
      g.release();
      await settle();
      expect(running).toBeLessThanOrEqual(4);
    }
    expect(await run).toEqual(gates.map((_, i) => i));
    expect(peak).toBe(4);
  });

  it("starts the next item as soon as a slot frees, not in fixed batches", async () => {
    const gates = [gate(), gate(), gate()];
    const started: number[] = [];

    const run = pooled([0, 1, 2], 2, async (i) => {
      started.push(i);
      await gates[i].promise;
      return i;
    });

    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    // Freeing one slot admits the third at once; a batching implementation
    // would make it wait for the second as well.
    gates[0].release();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    gates[1].release();
    gates[2].release();
    expect(await run).toEqual([0, 1, 2]);
  });

  it("reports each result as it lands", async () => {
    const seen: Array<[number, number]> = [];
    await pooled(
      [5, 6, 7],
      2,
      async (n) => n * 10,
      (result, item) => {
        seen.push([item, result]);
      },
    );
    expect(seen.sort()).toEqual([
      [5, 50],
      [6, 60],
      [7, 70],
    ]);
  });

  it("handles an empty list without starting anything", async () => {
    let called = false;
    const results = await pooled([], 4, async () => {
      called = true;
      return 1;
    });
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("treats a nonsensical limit as one at a time", async () => {
    for (const limit of [0, -3, 0.4, Number.NaN]) {
      let running = 0;
      let peak = 0;
      await pooled([1, 2, 3], limit, async (n) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
        return n;
      });
      expect(peak).toBe(1);
    }
  });

  it("does not spawn more runners than there are items", async () => {
    let starts = 0;
    await pooled([1], 8, async (n) => {
      starts += 1;
      return n;
    });
    expect(starts).toBe(1);
  });

  it("rejects the whole run when a task rejects", async () => {
    await expect(
      pooled([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("nope");
        return n;
      }),
    ).rejects.toThrow("nope");
  });

  // An `AbortSignal` stops a superseded gather's pooled read from starting
  // new items whose results its own `alive()` check would discard.
  it("rejects immediately, starting nothing, when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;

    await expect(
      pooled(
        [1, 2, 3],
        2,
        async (n) => {
          called = true;
          return n;
        },
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("stops starting new work once aborted mid-run, but lets in-flight work finish", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const g = [gate(), gate(), gate(), gate()];

    const run = pooled(
      [0, 1, 2, 3],
      2,
      async (i) => {
        started.push(i);
        await g[i].promise;
        return i;
      },
      undefined,
      controller.signal,
    );

    // Two slots fill (0, 1); abort before either finishes.
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    controller.abort();

    // Freeing a slot does not admit item 2: the abort check runs before the
    // next item starts.
    g[0].release();
    g[1].release();
    await expect(run).rejects.toThrow();
    expect(started).toEqual([0, 1]);
  });
});
