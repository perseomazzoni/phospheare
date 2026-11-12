// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeOpfs, type FakeOpfs } from "./fakeOpfs.fixture";
import {
  CACHE_BUDGET_BYTES,
  SWEEP_DELAY_MS,
  enforceBudget,
  guardSegments,
  measureUserCache,
  resetBudgetState,
  sweepSoon,
} from "./budget";
import { userDirName } from "./cacheRoot";

// Pins the byte budget over the working copy. The bucket it
// bounds is the only disposable one of the five, and also the queue's only
// source, so the rows that matter are about the interlock: a sweep that
// evicts a project with work still queued destroys the writer's only copy of
// that work.

const USER = "u1";
const HOME = `cache/${userDirName(USER)}`;

let fake: FakeOpfs;

/** A segment of `bytes` bytes, seeded newest-write-last across calls. */
function seedSegment(segment: string, bytes: number): void {
  fake.seedFile(`${HOME}/${segment}/document/body.md`, "x".repeat(bytes));
}

const totalBytes = async () =>
  (await measureUserCache(USER)).reduce((sum, u) => sum + u.bytes, 0);

beforeEach(() => {
  fake = fakeOpfs();
  fake.install();
  resetBudgetState();
  // Nothing queued unless a test says so. The default refuses to evict at
  // all, which suits a boot that has not wired its interlock but not tests
  // about eviction.
  guardSegments(async () => new Set());
});

afterEach(() => {
  resetBudgetState();
  fake.uninstall();
  vi.useRealTimers();
});

describe("measuring what the working copy holds", () => {
  it("answers empty for a browser that has never cached anything", async () => {
    // Creates nothing on the way: a measurement that scaffolds
    // `cache/<userId>/` makes the sweep a writer and leaves a directory for
    // the sign-out sweep to find.
    expect(await measureUserCache(USER)).toEqual([]);
    expect(fake.dirs.has(HOME)).toBe(false);
  });

  it("counts bytes per project, walking whatever depth the project has", async () => {
    fake.seedFile(`${HOME}/aaa/document/one.md`, "12345");
    fake.seedFile(`${HOME}/aaa/document/deep/two.md`, "123");
    fake.seedFile(`${HOME}/bbb/document/one.md`, "1");
    const used = await measureUserCache(USER);
    expect(Object.fromEntries(used.map((u) => [u.segment, u.bytes]))).toEqual({
      aaa: 8,
      bbb: 1,
    });
  });

  it("counts UTF-8 bytes, not characters", async () => {
    // The budget is stated in bytes, and prose is full of characters that are
    // not one byte. A cache measured in code units under-counts every writer
    // whose language is not English, the unsafe direction for a bound that
    // protects four irreplaceable stores.
    fake.seedFile(`${HOME}/aaa/document/one.md`, "èèè");
    const [used] = await measureUserCache(USER);
    expect(used.bytes).toBe(6);
  });

  it("takes the newest write in a project as its recency", async () => {
    fake.seedFile(`${HOME}/aaa/old.md`, "x");
    fake.seedFile(`${HOME}/bbb/anything.md`, "x");
    fake.seedFile(`${HOME}/aaa/new.md`, "x");
    const used = await measureUserCache(USER);
    const aaa = used.find((u) => u.segment === "aaa");
    const bbb = used.find((u) => u.segment === "bbb");
    // The second file of `aaa` is the newest write in the cache, so `aaa` is
    // the more recently used project although its first file is the oldest.
    expect(aaa?.usedAt).toBeGreaterThan(bbb?.usedAt ?? 0);
  });
});

describe("staying under the ceiling", () => {
  it("does nothing at all while there is room", async () => {
    fake.seedFile(`${HOME}/aaa/one.md`, "small");
    expect(await enforceBudget(USER)).toEqual([]);
    expect(fake.files.has(`${HOME}/aaa/one.md`)).toBe(true);
  });

  it("drops least-recently-written projects until it is back under", async () => {
    const half = Math.ceil(CACHE_BUDGET_BYTES / 2);
    seedSegment("oldest", half);
    seedSegment("middle", half);
    seedSegment("newest", half);
    expect(await totalBytes()).toBeGreaterThan(CACHE_BUDGET_BYTES);

    // One drop is enough to get under, so one happens: the ceiling is a
    // target to return to, not a level to clear by a margin.
    expect(await enforceBudget(USER)).toEqual(["oldest"]);
    expect(await totalBytes()).toBeLessThanOrEqual(CACHE_BUDGET_BYTES);
    expect(fake.files.has(`${HOME}/newest/document/body.md`)).toBe(true);
  });

  it("takes the whole project, never a file out of one", async () => {
    // A half-cached project is one whose next read is a miss the queue has to
    // treat as recoverable: the shape of a real eviction, self-inflicted. The
    // port carries `dropProject` for this.
    seedSegment("oldest", CACHE_BUDGET_BYTES);
    fake.seedFile(`${HOME}/oldest/document/second.md`, "still here?");
    seedSegment("newest", 1024);
    await enforceBudget(USER);
    expect(
      [...fake.files.keys()].filter((k) => k.includes("/oldest/")),
    ).toEqual([]);
  });

  it("skips a file that vanishes under the walk rather than abandoning the count", async () => {
    // An eviction mid-measure, or a file another tab is writing. Skipping it
    // undercounts by one file, which errs toward keeping data, the safe
    // direction for a routine that deletes. A walk abandoned would measure
    // the cache as empty, and its oldest project as the cheapest to keep.
    fake.seedFile(`${HOME}/aaa/gone.md`, "12345");
    fake.seedFile(`${HOME}/aaa/here.md`, "123");
    fake.hook = (call) => {
      if (call.call === "getFile" && call.path.endsWith("gone.md"))
        throw new DOMException("fake: evicted", "NotFoundError");
    };
    const [used] = await measureUserCache(USER);
    expect(used.bytes).toBe(3);
  });

  it("ignores a stray file sitting where projects go", async () => {
    // Nothing in the app writes one, but a browser, a devtools export or a
    // later build can leave something there. Only directories are projects;
    // a loose file treated as one asks `removeEntry` for a segment that is
    // not a segment.
    fake.seedFile(`${HOME}/stray.txt`, "not a project");
    fake.seedFile(`${HOME}/aaa/document/body.md`, "12345");
    const used = await measureUserCache(USER);
    expect(used.map((u) => u.segment)).toEqual(["aaa"]);
  });

  it("gives up quietly when the whole cache goes between the walk and the drop", async () => {
    // The sign-out sweep, or a browser eviction, lands inside one pass, while
    // the interlock is consulted. Nothing is left to evict and nothing went
    // wrong; a throw here would surface a failure to tidy up as a failure to
    // save.
    seedSegment("aaa", CACHE_BUDGET_BYTES * 2);
    guardSegments(async () => {
      fake.evictAll();
      return new Set();
    });
    expect(await enforceBudget(USER)).toEqual([]);
  });

  it("NEVER evicts a project the queue is still holding work for", async () => {
    // The working copy is the queue's only source: dropping a segment
    // with ops waiting destroys the only copy of that work.
    guardSegments(async () => new Set(["oldest"]));
    seedSegment("oldest", CACHE_BUDGET_BYTES);
    seedSegment("newest", CACHE_BUDGET_BYTES);

    expect(await enforceBudget(USER)).toEqual(["newest"]);
    expect(fake.files.has(`${HOME}/oldest/document/body.md`)).toBe(true);
  });

  it("stays over the ceiling rather than evict the last protected project", async () => {
    // An offline writer has queued work in every project they touched, so
    // every segment is protected and nothing may go. Being over budget is the
    // correct outcome: the ceiling is a target, never a licence to destroy
    // work.
    guardSegments(async () => new Set(["a", "b"]));
    seedSegment("a", CACHE_BUDGET_BYTES);
    seedSegment("b", CACHE_BUDGET_BYTES);

    expect(await enforceBudget(USER)).toEqual([]);
    expect(await totalBytes()).toBeGreaterThan(CACHE_BUDGET_BYTES);
  });

  it("refuses to evict anything before the interlock is registered", async () => {
    // `budget.ts` cannot import the queue, which already imports it, so the
    // queue registers itself at module load. Until it has, this module cannot
    // know what is unsafe, so it refuses outright.
    resetBudgetState();
    seedSegment("aaa", CACHE_BUDGET_BYTES * 2);
    await expect(enforceBudget(USER)).rejects.toThrow(/interlock/);
    expect(fake.files.has(`${HOME}/aaa/document/body.md`)).toBe(true);
  });

  it("skips a project it cannot remove and leaves it for the next sweep", async () => {
    // A locked directory, or one gone between the walk and the drop. A sweep
    // that fought it would never end.
    seedSegment("locked", CACHE_BUDGET_BYTES);
    seedSegment("free", CACHE_BUDGET_BYTES);
    fake.hook = (call) => {
      if (call.call === "removeEntry" && call.path.endsWith("/locked"))
        throw new DOMException("fake: locked", "NoModificationAllowedError");
    };
    expect(await enforceBudget(USER)).toEqual(["free"]);
    expect(fake.files.has(`${HOME}/locked/document/body.md`)).toBe(true);
  });
});

describe("the trailing sweep", () => {
  it("collapses a burst of writes into one walk", async () => {
    // Every save is a write and every write asks. The delay keeps the sweep
    // from walking the whole cache per keystroke.
    vi.useFakeTimers();
    guardSegments(async () => new Set());
    seedSegment("aaa", 32);

    for (let i = 0; i < 20; i++) sweepSoon(USER);
    fake.calls.length = 0;

    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);
    await vi.waitFor(() =>
      expect(fake.calls.some((c) => c.call === "keys")).toBe(true),
    );
    // One walk of the user's directory, not twenty.
    expect(
      fake.calls.filter((c) => c.call === "keys" && c.path === HOME),
    ).toHaveLength(1);
  });

  it("does not start a second walk over the top of one still running", async () => {
    // A walk is slower than the delay on a large cache, and two overlapping
    // passes would race each other's `removeEntry`: one deletes a segment the
    // other already counted as freed, and the sweep evicts past its target.
    vi.useFakeTimers();
    let release = () => {};
    guardSegments(
      () =>
        new Promise<ReadonlySet<string>>((r) => (release = () => r(new Set()))),
    );
    seedSegment("aaa", CACHE_BUDGET_BYTES * 2);

    sweepSoon(USER);
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);
    const during = fake.calls.filter((c) => c.call === "keys").length;

    // The first pass is parked inside the interlock. A second ask must not
    // start another walk.
    sweepSoon(USER);
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS);
    expect(fake.calls.filter((c) => c.call === "keys").length).toBe(during);

    release();
  });

  it("does nothing before its delay is up", async () => {
    vi.useFakeTimers();
    seedSegment("aaa", 32);
    sweepSoon(USER);
    fake.calls.length = 0;
    await vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS - 1);
    expect(fake.calls).toEqual([]);
  });

  it("swallows a failure rather than letting it reach the save that asked", async () => {
    // Fire-and-forget by contract. Housekeeping must not fail a save, and the
    // failure it would report is only that the browser refused a tidy-up.
    vi.useFakeTimers();
    resetBudgetState(); // no interlock: `enforceBudget` throws
    // Over the ceiling, or the sweep returns early before the interlock
    // refuses, and the row passes against a rejection that never happened.
    seedSegment("aaa", CACHE_BUDGET_BYTES * 2);
    expect(() => sweepSoon(USER)).not.toThrow();
    await expect(
      vi.advanceTimersByTimeAsync(SWEEP_DELAY_MS),
    ).resolves.not.toThrow();
  });
});
