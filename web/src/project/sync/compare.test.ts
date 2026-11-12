// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { compare } from "./compare";
import { emptyManifest, withBaseline, type SyncManifest } from "./manifest";
import type { Scan } from "./scan";

const PATH = "/document/section--opening.md";

function scanOf(
  entries: Record<string, { hash: string; weak?: boolean }>,
): Scan {
  return new Map(Object.entries(entries));
}

function manifestWith(
  folderKey: string,
  path: string,
  local: string,
  remote: string,
): SyncManifest {
  return withBaseline(
    emptyManifest({ providerId: "drive", key: folderKey }),
    path,
    { local, remote, remoteFileId: "file-1", localMtime: 0 },
  );
}

describe("compare", () => {
  it("clean: neither side changed since the baseline", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({ [PATH]: { hash: "hash-a" } });
    const drive = scanOf({ [PATH]: { hash: "hash-a" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "clean" }]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPull).toEqual([]);
    expect(verdict.toPush).toEqual([]);
  });

  it("local-only: local changed, Drive did not", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({ [PATH]: { hash: "hash-b" } });
    const drive = scanOf({ [PATH]: { hash: "hash-a" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "local-changed" }]);
    expect(verdict.conflict).toBe(false);
    // Safe to push; a pull would be pointless here.
    expect(verdict.toPull).toEqual([]);
    expect(verdict.toPush).toEqual([PATH]);
  });

  it("drive-only: Drive changed, local did not — safe to pull", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({ [PATH]: { hash: "hash-a" } });
    const drive = scanOf({ [PATH]: { hash: "hash-b" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "remote-changed" }]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPull).toEqual([PATH]);
    expect(verdict.toPush).toEqual([]);
  });

  it("both: a real conflict, and nothing is offered for silent pull", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({ [PATH]: { hash: "hash-b" } });
    const drive = scanOf({ [PATH]: { hash: "hash-c" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "conflict" }]);
    expect(verdict.conflict).toBe(true);
    expect(verdict.toPull).toEqual([]);
    expect(verdict.toPush).toEqual([]);
  });

  it("equal bytes on both sides are clean even when the baseline trails both", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({ [PATH]: { hash: "hash-b" } });
    const drive = scanOf({ [PATH]: { hash: "hash-b" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "clean" }]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPull).toEqual([]);
    expect(verdict.toPush).toEqual([]);
  });

  it("a weak remote fingerprint never proves equal bytes", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "stamp-1");
    const local = scanOf({ [PATH]: { hash: "stamp-2" } });
    const drive = scanOf({ [PATH]: { hash: "stamp-2", weak: true } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "conflict" }]);
  });

  it("added-local: a brand new file with no baseline, present only locally", () => {
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    const local = scanOf({ [PATH]: { hash: "hash-a" } });
    const drive = scanOf({});

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "local-changed" }]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPush).toEqual([PATH]);
  });

  it("added-remote: a brand new file with no baseline, present only on Drive", () => {
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    const local = scanOf({});
    const drive = scanOf({ [PATH]: { hash: "hash-a" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "remote-changed" }]);
    expect(verdict.toPull).toEqual([PATH]);
    expect(verdict.toPush).toEqual([]);
  });

  it("deleted-remote: known to both, gone from Drive, unchanged locally — pull the deletion", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({ [PATH]: { hash: "hash-a" } });
    const drive = scanOf({});

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "remote-changed" }]);
    expect(verdict.toPull).toEqual([PATH]);
    expect(verdict.toPush).toEqual([]);
  });

  it("deleted-local: known to both, gone locally, unchanged on Drive — not a conflict", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({});
    const drive = scanOf({ [PATH]: { hash: "hash-a" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "local-changed" }]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPush).toEqual([PATH]);
  });

  it("deleted on both sides at once is clean, not a conflict", () => {
    const manifest = manifestWith("folder-1", PATH, "hash-a", "hash-a");
    const local = scanOf({});
    const drive = scanOf({});

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "clean" }]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPush).toEqual([]);
  });

  it("missing-baseline (unknown): no baseline, present on both sides with different bytes", () => {
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    const local = scanOf({ [PATH]: { hash: "hash-a" } });
    const drive = scanOf({ [PATH]: { hash: "hash-b" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "unknown" }]);
    expect(verdict.conflict).toBe(true);
    expect(verdict.toPush).toEqual([]);
  });

  it("missing-baseline, but the bytes already agree: adopted as clean, not flagged", () => {
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    const local = scanOf({ [PATH]: { hash: "hash-a" } });
    const drive = scanOf({ [PATH]: { hash: "hash-a" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "clean" }]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPush).toEqual([]);
  });

  it("missing-checksum (weak): a weak Drive fingerprint still compares correctly", () => {
    const manifest = manifestWith(
      "folder-1",
      PATH,
      "hash-a",
      "2026-01-01T00:00:00.000Z",
    );
    const local = scanOf({ [PATH]: { hash: "hash-a" } });
    const drive = scanOf({
      [PATH]: { hash: "2026-01-02T00:00:00.000Z", weak: true },
    });

    const verdict = compare(local, drive, manifest);

    expect(verdict.files).toEqual([{ path: PATH, status: "remote-changed" }]);
    expect(verdict.toPull).toEqual([PATH]);
    expect(verdict.toPush).toEqual([]);
  });

  it("document-properties.json is never in scope", () => {
    // `compare()` has no special case for it: `scan()` never includes it, as
    // `scan.test.ts` pins, so it appears in neither scan nor the manifest.
    // At `compare()`'s own seam, a path on neither scan and absent from the
    // manifest never appears in the verdict.
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });
    const verdict = compare(scanOf({}), scanOf({}), manifest);

    expect(verdict.files).toEqual([]);
    expect(verdict.conflict).toBe(false);
    expect(verdict.toPush).toEqual([]);
  });

  it("several files at once: only the genuinely conflicting one blocks the pull list", () => {
    const manifest = withBaseline(
      withBaseline(
        emptyManifest({ providerId: "drive", key: "folder-1" }),
        "/a.md",
        {
          local: "a1",
          remote: "a1",
          remoteFileId: "f1",
          localMtime: 0,
        },
      ),
      "/b.md",
      { local: "b1", remote: "b1", remoteFileId: "f2", localMtime: 0 },
    );
    const local = scanOf({ "/a.md": { hash: "a1" }, "/b.md": { hash: "b2" } });
    const drive = scanOf({ "/a.md": { hash: "a2" }, "/b.md": { hash: "b1" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.conflict).toBe(false);
    expect(verdict.toPull).toEqual(["/a.md"]);
    expect(verdict.toPush).toEqual(["/b.md"]);
  });

  it("a single conflicting file blocks the pull list for the whole project", () => {
    const manifest = withBaseline(
      withBaseline(
        emptyManifest({ providerId: "drive", key: "folder-1" }),
        "/a.md",
        {
          local: "a1",
          remote: "a1",
          remoteFileId: "f1",
          localMtime: 0,
        },
      ),
      "/b.md",
      { local: "b1", remote: "b1", remoteFileId: "f2", localMtime: 0 },
    );
    const local = scanOf({ "/a.md": { hash: "a2" }, "/b.md": { hash: "b2" } });
    const drive = scanOf({ "/a.md": { hash: "a1" }, "/b.md": { hash: "b3" } });

    const verdict = compare(local, drive, manifest);

    expect(verdict.conflict).toBe(true);
    expect(verdict.toPull).toEqual([]);
    expect(verdict.toPush).toEqual([]);
  });
});
