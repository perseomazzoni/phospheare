// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheSupported,
  dropOtherUserCaches,
  dropUserCache,
  userCacheDir,
  userDirName,
} from "./cacheRoot";
import { domError, fakeOpfs, type FakeOpfs } from "./fakeOpfs.fixture";

// Pins the policy half of the cache root: which names are allowed, what
// happens with no usable id, and which directories a sweep keeps. That half
// decides whether one writer's prose can reach another's session. The
// platform half (OPFS works, a digested name is a legal directory name, a
// quota rejection has the shape the layer routes on) belongs in the browser
// spec.
//
// The purge rows read the store back rather than asserting a mock was
// called: a purge that was called and left the bytes in place is the one
// failure this bucket cannot have.
//
// The fake is the shared `fakeOpfs.fixture.ts`, so each claim is paired with a
// negative control: if its `removeEntry` did not delete, "expect it gone"
// would pass trivially.

let opfs: FakeOpfs;

beforeEach(() => {
  opfs = fakeOpfs();
});

afterEach(() => {
  opfs.uninstall();
});

/** Seed one user directory per id, so a sweep has something to keep or drop. */
function seedUsers(...ids: string[]): void {
  for (const id of ids) opfs.seedDir(`cache/${id}`);
  opfs.install();
}

function userDirs(): string[] {
  return [...opfs.dirs]
    .filter((d) => d.startsWith("cache/") && d.split("/").length === 2)
    .map((d) => d.slice("cache/".length))
    .sort();
}

describe("the working copy's root", () => {
  it("refuses to build a path from an id it cannot vouch for", () => {
    // A path segment built from an untrusted string lets traversal and
    // name-shadowing in, so the check is anchored and total rather than a
    // blocklist of known shapes.
    for (const bad of ["", "..", ".", "a/b", "a\\b", "a b", "x".repeat(65)]) {
      expect(() => userDirName(bad)).toThrow();
    }
  });

  it("passes the id shapes identity issues now and might issue later", () => {
    // Ids auto-increment; a ulid or uuid must not need this file edited.
    for (const ok of ["1", "4207", "01JBQ2Z9K3", "a-b_C9"]) {
      expect(userDirName(ok)).toBe(ok);
    }
  });

  it("reports no support when the browser has no OPFS, and purges silently", async () => {
    expect(cacheSupported()).toBe(false);
    // Best-effort by contract: a purge must never block a sign-out or an
    // account deletion, on any browser.
    await expect(dropUserCache("7")).resolves.toBeUndefined();
    await expect(dropOtherUserCaches("7")).resolves.toBeUndefined();
    // …and the write path declines rather than inventing a directory.
    await expect(userCacheDir("7", { create: true })).resolves.toBeNull();
  });

  it("purges silently when nothing was ever cached at all", async () => {
    // The ordinary first-run state: OPFS is there, `cache/` is not. A purge
    // reads that as nothing to do, not as a failure, because it runs on every
    // sign-out, including the first.
    opfs.install();
    await expect(dropUserCache("7")).resolves.toBeUndefined();
    await expect(dropOtherUserCaches("7")).resolves.toBeUndefined();
    expect(opfs.dirs.has("cache")).toBe(false);
  });

  it("drops one writer's whole working copy, and the store shows it gone", async () => {
    seedUsers("7", "9");
    opfs.files.set("cache/7/seg/a.md", "prose");
    await dropUserCache("7");
    expect(userDirs()).toEqual(["9"]);
    // The negative control: the bytes underneath went with the directory.
    expect(opfs.files.has("cache/7/seg/a.md")).toBe(false);
    expect(opfs.calls.some((c) => c.call === "removeEntry")).toBe(true);
  });

  it("never names a directory for an id it refused, so nothing is dropped", async () => {
    seedUsers("7");
    await dropUserCache("../7");
    expect(userDirs()).toEqual(["7"]);
    expect(opfs.calls.some((c) => c.call === "removeEntry")).toBe(false);
  });

  it("sweeps every other writer and keeps the confirmed one", async () => {
    // The sign-in sweep of other writers' data, extended to the bucket that
    // holds body text: without it a previous writer's prose accumulates here
    // indefinitely.
    seedUsers("7", "9", "12");
    // A file two levels down, so the listing must report the user directory
    // and not the path beneath it: a sweep that yielded `7/seg/a.md` would
    // try to remove a name that is not a child of `cache/`.
    opfs.seedDir("cache/7/seg");
    opfs.files.set("cache/7/seg/a.md", "prose");
    await dropOtherUserCaches("9");
    expect(userDirs()).toEqual(["9"]);
    expect(opfs.files.size).toBe(0);
  });

  it("refuses the sweep rather than deleting everything for an unusable id", async () => {
    // An id that cannot be vouched for must not mean "keep nothing", which
    // would delete the signed-in writer's own copy.
    seedUsers("7", "9");
    await dropOtherUserCaches("");
    expect(userDirs()).toEqual(["7", "9"]);
    expect(opfs.calls.some((c) => c.call === "removeEntry")).toBe(false);
  });

  it("keeps sweeping when one entry refuses to go", async () => {
    seedUsers("7", "9", "12");
    let refusals = 0;
    opfs.hook = (call) => {
      if (call.call === "removeEntry" && refusals++ === 0) {
        throw domError("NoModificationAllowedError");
      }
    };
    await dropOtherUserCaches("9");
    // One survivor is acceptable; a thrown sweep that abandons the rest is not.
    expect(userDirs()).not.toContain("12");
    // Negative control: the refusal fired, so this is not a green run over a
    // hook that was never reached.
    expect(refusals).toBeGreaterThan(0);
  });
});

describe("userCacheDir", () => {
  it("creates the user's directory on demand, under `cache/`", async () => {
    opfs.install();
    const dir = await userCacheDir("7", { create: true });
    expect(dir).not.toBeNull();
    expect(opfs.dirs.has("cache/7")).toBe(true);
  });

  it("refuses an id it cannot vouch for, rather than creating a wild path", () => {
    opfs.install();
    // Fails closed with a throw, unlike the purges: on the write path a silent
    // `null` would let a save be reported as landed.
    return expect(userCacheDir("../evil", { create: true })).rejects.toThrow();
  });

  it("rejects rather than swallowing a real platform failure", async () => {
    opfs.install();
    opfs.hook = (call) => {
      if (call.call === "getDirectoryHandle")
        throw domError("QuotaExceededError");
    };
    await expect(userCacheDir("7", { create: true })).rejects.toThrow();
  });
});
