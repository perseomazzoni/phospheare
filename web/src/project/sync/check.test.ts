// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  ROOT_PATH,
  StorageError,
  baseName,
  joinPath,
  parentPath,
  type Access,
  type DirEntry,
  type FileFingerprint,
  type FileHint,
  type ProjectRef,
  type StorageProvider,
} from "../../storage/types";
import type { IconName } from "../../ui/icons";
import { sha256Hex } from "../../text/hash";

/** The pairing every fixture here points at: one backend, one folder. */
const TARGET = { providerId: "drive", key: "folder-1" };

// The fake backend from `apply.test.ts`: an independent in-memory store per
// instance, since `checkSync` bridges two sides that must not share state the
// way the real `memoryProvider` singleton does.

function createStore(seed: Record<string, string> = {}): StorageProvider {
  const files = new Map(Object.entries(seed));
  const emptyDirs = new Set<string>();
  // A fake `lastModified` clock, so this store honours the mtime hint as
  // `localProvider` does: only `writeFile` advances it, so a hint
  // whose mtime matches means unchanged since that hash was computed, the
  // signal `hintsFromManifest` gives `checkSync`.
  let clock = 0;
  const mtimes = new Map<string, number>();
  for (const path of files.keys()) mtimes.set(path, ++clock);

  const requireFile = (path: string): string => {
    const content = files.get(path);
    if (content === undefined)
      throw new StorageError(`File not found: ${path}`, "not-found");
    return content;
  };

  const store = {
    id: "fake-store",
    kind: "device" as const,
    label: () => "Fake store",
    icon: "mark" as IconName,
    isAvailable: () => true,
    reopenProject: async () => true,
    canAccess: async (): Promise<Access> => "granted",

    async listDir(_ref: ProjectRef, path: string): Promise<DirEntry[]> {
      const prefix = path === ROOT_PATH ? ROOT_PATH : `${path}/`;
      const seen = new Map<string, DirEntry>();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (rest.length === 0) continue;
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        seen.set(name, {
          path: joinPath(path, name),
          name,
          kind: slash === -1 ? "file" : "folder",
        });
      }
      for (const dir of emptyDirs) {
        if (parentPath(dir) === path) {
          const name = baseName(dir);
          if (!seen.has(name))
            seen.set(name, { path: dir, name, kind: "folder" });
        }
      }
      return [...seen.values()];
    },

    async exists(_ref: ProjectRef, path: string): Promise<boolean> {
      if (files.has(path) || emptyDirs.has(path)) return true;
      return [...files.keys()].some((f) => f.startsWith(`${path}/`));
    },

    readFile: async (_ref: ProjectRef, path: string) => requireFile(path),

    async writeFile(
      _ref: ProjectRef,
      path: string,
      content: string,
    ): Promise<void> {
      files.set(path, content);
      mtimes.set(path, ++clock);
      emptyDirs.delete(parentPath(path));
    },

    async createDir(_ref: ProjectRef, path: string): Promise<void> {
      emptyDirs.add(path);
    },

    async renameFile(
      _ref: ProjectRef,
      path: string,
      newName: string,
    ): Promise<void> {
      const content = requireFile(path);
      files.delete(path);
      files.set(joinPath(parentPath(path), newName), content);
    },

    async moveFile(
      _ref: ProjectRef,
      fromPath: string,
      toDir: string,
    ): Promise<void> {
      const content = requireFile(fromPath);
      files.delete(fromPath);
      files.set(joinPath(toDir, baseName(fromPath)), content);
    },

    async removeFile(_ref: ProjectRef, path: string): Promise<void> {
      files.delete(path);
    },

    async fingerprintFile(
      _ref: ProjectRef,
      path: string,
      hint?: FileHint,
    ): Promise<FileFingerprint> {
      const mtime = mtimes.get(path);
      if (hint && mtime === hint.mtime) return { hash: hint.hash, mtime };
      return { hash: await sha256Hex(requireFile(path)), mtime };
    },

    async fingerprintDir(
      _ref: ProjectRef,
      dirPath: string,
      hints?: Map<string, FileHint>,
    ): Promise<Map<string, FileFingerprint>> {
      const prefix = dirPath === ROOT_PATH ? ROOT_PATH : `${dirPath}/`;
      const out = new Map<string, FileFingerprint>();
      for (const [filePath, content] of files) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (rest.length === 0 || rest.includes("/")) continue;
        const hint = hints?.get(rest);
        const mtime = mtimes.get(filePath);
        out.set(
          rest,
          hint && mtime === hint.mtime
            ? { hash: hint.hash, mtime }
            : { hash: await sha256Hex(content), mtime },
        );
      }
      return out;
    },
  };

  return Object.assign(store, {
    // Test-only: rewrites a file's bytes without bumping its mtime, a state a
    // real filesystem never produces, to prove the mtime hint shortcut trusts
    // an unchanged mtime rather than re-reading. If it fires, the fingerprint
    // keeps the old hash despite the new bytes; if not, `sha256Hex` sees the
    // new bytes and the hash changes.
    __setContentWithoutTouchingMtime: (path: string, content: string) => {
      files.set(path, content);
    },
    __mtimeOf: (path: string) => mtimes.get(path),
  });
}

const localRef: ProjectRef = {
  providerId: "local",
  key: "local-1",
  name: "Project",
  openedAt: "",
};
const driveRef: ProjectRef = {
  providerId: "drive",
  key: "folder-1",
  name: "Project",
  openedAt: "",
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const { setCurrentUserId } = await import("../../auth/currentUser");
  setCurrentUserId("test-user");
});

afterEach(() => vi.unstubAllGlobals());

describe("checkSync", () => {
  it("returns null for a project that is not paired", async () => {
    const { checkSync } = await import("./check");
    const local = { provider: createStore(), ref: localRef };
    const drive = { provider: createStore(), ref: driveRef };

    expect(await checkSync(local, drive, "local-1")).toBeNull();
  });

  it("a clean, paired project reports no conflict", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");

    const local = {
      provider: createStore({ "/document/section--a.md": "same" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "same" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
  });

  // The `localMtime` shortcut. `checkSync` builds hints from the
  // stored manifest and hands them to the local scan, and a provider that
  // recognizes its own "unchanged since that mtime" signal trusts the stored
  // hash instead of re-reading the file. Rewriting the bytes without moving
  // the mtime shows whether the shortcut fired: it must trust the stale hint
  // and not see the new bytes.
  it("reuses the manifest's stored local hash for a file whose mtime has not moved, instead of re-hashing it", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");

    const local = createStore({
      "/document/section--a.md": "v1",
    }) as ReturnType<typeof createStore> & {
      __setContentWithoutTouchingMtime(path: string, content: string): void;
      __mtimeOf(path: string): number | undefined;
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };
    const localSide = { provider: local, ref: localRef };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    const built = await rebuildManifest(localSide, drive, TARGET);
    await putManifest("local-1", built);
    const baseline = built.files["/document/section--a.md"];
    expect(baseline.localMtime).toBe(
      local.__mtimeOf("/document/section--a.md"),
    );

    // Rewrite the bytes without touching the mtime the manifest trusts; the
    // shortcut, if it fires, never sees this change.
    local.__setContentWithoutTouchingMtime(
      "/document/section--a.md",
      "bytes changed behind the shortcut's back",
    );

    const result = await checkSync(localSide, drive, "local-1");

    // A re-hash would produce a new local hash, diverging from Drive's
    // unchanged "v1" and reporting a local change or a conflict. Trusting the
    // stale hint keeps the check clean: nothing to pull, nothing to push.
    expect(result?.verdict.conflict).toBe(false);
    expect(result?.verdict.toPull).toEqual([]);
    expect(result?.verdict.toPush).toEqual([]);
  });

  it("silently pulls a Drive-only change outside the book and persists the new baseline", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { getManifest, putManifest } = await import("./manifestStore");

    const local = {
      provider: createStore({ "/reference/notes.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/reference/notes.md": "v1" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    // Another device pushed a change to Drive since the last sync.
    await drive.provider.writeFile(
      driveRef,
      "/reference/notes.md",
      "v2 from another device",
    );

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
    expect(await local.provider.readFile(localRef, "/reference/notes.md")).toBe(
      "v2 from another device",
    );

    const manifest = await getManifest("local-1");
    expect(manifest?.files["/reference/notes.md"].local).toBe(
      manifest?.files["/reference/notes.md"].remote,
    );
  });

  it("silently pushes a local-only change and persists the new baseline", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { getManifest, putManifest } = await import("./manifestStore");

    const local = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    // A save made here, offline, which the queue could not reach.
    await local.provider.writeFile(
      localRef,
      "/document/section--a.md",
      "edited offline",
    );

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
    expect(
      await drive.provider.readFile(driveRef, "/document/section--a.md"),
    ).toBe("edited offline");

    const manifest = await getManifest("local-1");
    expect(manifest?.files["/document/section--a.md"].local).toBe(
      manifest?.files["/document/section--a.md"].remote,
    );
  });

  it("silently pushes a locally created file to Drive", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { getManifest, putManifest } = await import("./manifestStore");

    const local = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    await local.provider.writeFile(
      localRef,
      "/document/section--b.md",
      "brand new",
    );

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
    expect(
      await drive.provider.readFile(driveRef, "/document/section--b.md"),
    ).toBe("brand new");

    const manifest = await getManifest("local-1");
    expect(manifest?.files["/document/section--b.md"]).toBeDefined();
  });

  it("propagates a local deletion to Drive", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");

    const local = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    await local.provider.removeFile(localRef, "/document/section--a.md");

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
    expect(
      await drive.provider.exists(driveRef, "/document/section--a.md"),
    ).toBe(false);
  });

  it("reports a conflict and gathers per-side stats, applying nothing", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");
    const { serializeProperties, defaultProperties } =
      await import("../properties");

    const local = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    await local.provider.writeFile(
      localRef,
      "/document/section--a.md",
      "edited locally",
    );
    await drive.provider.writeFile(
      driveRef,
      "/document/section--a.md",
      "edited on another device",
    );

    const localProps = defaultProperties("Project");
    localProps.stats = {
      words: 100,
      parts: 1,
      sections: 1,
      countedAt: "2026-01-01T00:00:00.000Z",
      perNode: [],
    };
    await local.provider.writeFile(
      localRef,
      "/document-properties.json",
      serializeProperties(localProps),
    );

    const driveProps = defaultProperties("Project");
    driveProps.stats = {
      words: 200,
      parts: 1,
      sections: 1,
      countedAt: "2026-01-02T00:00:00.000Z",
      perNode: [],
    };
    await drive.provider.writeFile(
      driveRef,
      "/document-properties.json",
      serializeProperties(driveProps),
    );

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(true);
    expect(result?.localStats?.words).toBe(100);
    expect(result?.remoteStats?.words).toBe(200);
    // Neither side was touched: a conflict is never auto-applied.
    expect(
      await local.provider.readFile(localRef, "/document/section--a.md"),
    ).toBe("edited locally");
    expect(
      await drive.provider.readFile(driveRef, "/document/section--a.md"),
    ).toBe("edited on another device");
  });

  it("manifest-loss reconciliation: matching bytes adopt a fresh baseline silently", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { getManifest } = await import("./manifestStore");

    const local = {
      provider: createStore({ "/document/section--a.md": "agreed content" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "agreed content" }),
      ref: driveRef,
    };

    // Paired, but no manifest was ever written: the lost-manifest case.
    await pair("local-1", { providerId: "drive", key: "folder-1" });

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
    const manifest = await getManifest("local-1");
    expect(manifest?.files["/document/section--a.md"]).toBeDefined();
  });

  it("manifest-loss reconciliation: differing bytes are a conflict, not a silent pick", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");

    const local = {
      provider: createStore({ "/document/section--a.md": "local version" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "drive version" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(true);
  });

  it("a local save landing after the scan escalates the pull to a conflict instead of overwriting it", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");

    const local = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };

    await pair("local-1", { providerId: "drive", key: "folder-1" });
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    // Another device pushed a change to Drive since the last sync, so the
    // check wants to pull.
    await drive.provider.writeFile(
      driveRef,
      "/document/section--a.md",
      "v2 from another device",
    );

    // The racing save: a second tab writes the local file between
    // `checkSync`'s scan and its pre-pull re-check. `scan()` fingerprints
    // local through the bulk `fingerprintDir` path, so
    // `fingerprintFile` is called once per check, in the pre-pull re-check
    // inside `pathsWhereLocalMoved`, where the concurrent write lands.
    let localFingerprints = 0;
    const originalFingerprint = local.provider.fingerprintFile.bind(
      local.provider,
    );
    local.provider.fingerprintFile = async (
      ref: ProjectRef,
      path: string,
      hint?: FileHint,
    ) => {
      if (path === "/document/section--a.md") {
        localFingerprints += 1;
        if (localFingerprints === 1) {
          await local.provider.writeFile(
            localRef,
            path,
            "saved by the other tab mid-check",
          );
        }
      }
      return originalFingerprint(ref, path, hint);
    };

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(true);
    // The racing save was not overwritten by the stale Drive bytes.
    expect(
      await local.provider.readFile(localRef, "/document/section--a.md"),
    ).toBe("saved by the other tab mid-check");
    expect(
      await drive.provider.readFile(driveRef, "/document/section--a.md"),
    ).toBe("v2 from another device");
  });
});

describe("checkSync when the remote copy is gone", () => {
  const BOOK_FILES = {
    "/document-structure.yaml": "structure",
    "/document/section--a.md": "chapter one",
    "/document/section--b.md": "chapter two",
  };

  /** A synced pair, then the remote side emptied out. */
  async function pairedThenEmptied() {
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");
    const local = { provider: createStore(BOOK_FILES), ref: localRef };
    const drive = { provider: createStore(BOOK_FILES), ref: driveRef };
    await pair("local-1", TARGET);
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));
    for (const path of Object.keys(BOOK_FILES))
      await drive.provider.removeFile(driveRef, path);
    return { local, drive };
  }

  async function localFiles(local: { provider: StorageProvider }) {
    const out: Record<string, string> = {};
    for (const path of Object.keys(BOOK_FILES))
      out[path] = await local.provider.readFile(localRef, path);
    return out;
  }

  it("a trashed folder, which lists empty, is a gone remote: nothing is pulled and no local file is deleted", async () => {
    const { checkSync } = await import("./check");
    const { local, drive } = await pairedThenEmptied();

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.remoteGone).toBe(true);
    expect(result?.verdict.conflict).toBe(true);
    expect(result?.verdict.toPull).toEqual([]);
    expect(await localFiles(local)).toEqual(BOOK_FILES);
  });

  it("a deleted folder, whose root no longer lists, is a gone remote", async () => {
    const { checkSync } = await import("./check");
    const { local, drive } = await pairedThenEmptied();
    drive.provider.listDir = async () => {
      throw new StorageError("Not found: /", "not-found");
    };

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.remoteGone).toBe(true);
    expect(await localFiles(local)).toEqual(BOOK_FILES);
  });

  it("a remote listing that fails for another reason fails the check instead of reading as deletions", async () => {
    const { checkSync } = await import("./check");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");
    const local = { provider: createStore(BOOK_FILES), ref: localRef };
    const drive = { provider: createStore(BOOK_FILES), ref: driveRef };
    await pair("local-1", TARGET);
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));

    const listDir = drive.provider.listDir.bind(drive.provider);
    drive.provider.listDir = async (ref: ProjectRef, path: string) => {
      if (path === "/document")
        throw new StorageError("Remote Storage could not be reached.", "io");
      return listDir(ref, path);
    };

    await expect(checkSync(local, drive, "local-1")).rejects.toThrow();
    expect(await localFiles(local)).toEqual(BOOK_FILES);
  });
});

describe("checkSync against a baseline that trails both sides", () => {
  // The queue's drain pushes a save and levels its baseline; a check that read
  // the manifest before that, or a manifest write that lost the race, leaves
  // a baseline older than the bytes both sides now hold.
  async function trailing() {
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");
    const local = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };
    await pair("local-1", TARGET);
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));
    await local.provider.writeFile(localRef, "/document/section--a.md", "v2");
    await drive.provider.writeFile(driveRef, "/document/section--a.md", "v2");
    return { local, drive };
  }

  it("equal bytes on both sides are clean, not a conflict", async () => {
    const { checkSync } = await import("./check");
    const { local, drive } = await trailing();

    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
    expect(result?.verdict.files).toEqual([
      { path: "/document/section--a.md", status: "clean" },
    ]);
  });

  it("levels the trailing baseline, so the next one-sided edit is a push, not a conflict", async () => {
    const { checkSync } = await import("./check");
    const { getManifest } = await import("./manifestStore");
    const { local, drive } = await trailing();

    await checkSync(local, drive, "local-1");
    const levelled = (await getManifest("local-1"))?.files[
      "/document/section--a.md"
    ];
    expect(levelled?.local).toBe(await sha256Hex("v2"));
    expect(levelled?.remote).toBe(await sha256Hex("v2"));

    await local.provider.writeFile(localRef, "/document/section--a.md", "v3");
    const result = await checkSync(local, drive, "local-1");

    expect(result?.verdict.conflict).toBe(false);
    expect(result?.verdict.toPush).toEqual(["/document/section--a.md"]);
    expect(
      await drive.provider.readFile(driveRef, "/document/section--a.md"),
    ).toBe("v3");
  });

  it("a manifest write under the project sync lock while a check runs is not overwritten by the check", async () => {
    const { checkSync } = await import("./check");
    const { withSyncLock } = await import("./syncLock");
    const { getManifest, putManifest } = await import("./manifestStore");
    const { withBaseline } = await import("./manifest");
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const local = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: localRef,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "v1" }),
      ref: driveRef,
    };
    await pair("local-1", TARGET);
    await putManifest("local-1", await rebuildManifest(local, drive, TARGET));
    // A change to pull, so the check writes the manifest when it finishes.
    await drive.provider.writeFile(driveRef, "/document/section--a.md", "v2");

    // Hold the check inside its remote scan until the other writer has asked
    // for the lock.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fingerprintDir = drive.provider.fingerprintDir.bind(drive.provider);
    drive.provider.fingerprintDir = async (
      ref: ProjectRef,
      dir: string,
      hints?: Map<string, FileHint>,
    ) => {
      await gate;
      return fingerprintDir(ref, dir, hints);
    };

    const check = checkSync(local, drive, "local-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const drained = withSyncLock("local-1", async () => {
      const stored = await getManifest("local-1");
      if (!stored) throw new Error("the pairing's manifest is missing");
      await putManifest(
        "local-1",
        withBaseline(stored, "/document/section--drained.md", {
          local: "drained",
          remote: "drained",
          remoteFileId: "",
          localMtime: 0,
        }),
      );
    });
    release();
    await Promise.all([check, drained]);

    const manifest = await getManifest("local-1");
    expect(manifest?.files["/document/section--drained.md"]).toBeDefined();
  });
});

describe("a snapshot's record travels with its file", () => {
  // Three stores: device A, the remote, device B. Each step is what the
  // editor leaves on A's disk; A's check pushes it, then B's check pulls it
  // and B's copy must open with the same records.
  const AT = "2026-01-01T00:00:00.000Z";
  const FIRST = "section--one.EL1.00.md";
  const SECOND = "section--one.EL1.01.md";
  const bRef: ProjectRef = { ...localRef, key: "local-2" };

  interface Book {
    /** The live snapshots, the adopted one first, as file and title. */
    live: [string, string][];
    /** The binned snapshots, as file and title. */
    binned?: [string, string][];
    /** The Section was removed: its files are in the bin, its node in `removed:`. */
    removed?: boolean;
  }

  const records = (rows: [string, string][]) =>
    rows.map(([file, title]) => ({ file, title, created: AT }));

  /** The book's files as the editor writes them. */
  function filesOf(book: Book): Record<string, string> {
    const node = [
      `  - id: EL1`,
      `    section: One`,
      `    adopted: ${book.live[0]?.[0] ?? FIRST}`,
    ].join("\n");
    const yaml = book.removed
      ? `version: 1\ndocument: []\nremoved:\n${node}\n`
      : `version: 1\ndocument:\n${node}\n`;
    const out: Record<string, string> = {
      "/document-structure.yaml": yaml,
      "/snapshots-catalogue.json": JSON.stringify({
        snapshots: book.live.length > 0 ? { EL1: records(book.live) } : {},
        binned:
          book.binned && book.binned.length > 0
            ? { EL1: records(book.binned) }
            : {},
      }),
    };
    const liveDir = book.removed ? "/recyclebin" : "/document";
    for (const [file, title] of book.live)
      out[`${liveDir}/${file}`] = `# ${title}`;
    for (const [file, title] of book.binned ?? [])
      out[`/recyclebin/${file}`] = `# ${title}`;
    return out;
  }

  const PROPS = JSON.stringify({
    document: {
      id: "doc-1",
      title: "Once Dark",
      type: "novel",
      language: "en",
      createdAt: AT,
      updatedAt: AT,
    },
    sync: null,
    ui: { expanded: [], lastOpened: null },
    stats: { words: 0, parts: 0, sections: 0, countedAt: AT, perNode: [] },
  });

  const isRecords = (path: string) =>
    path === "/document-structure.yaml" || path === "/snapshots-catalogue.json";
  const isBook = (path: string) =>
    isRecords(path) ||
    path.startsWith("/document/") ||
    path.startsWith("/recyclebin/");

  async function allPaths(provider: StorageProvider, ref: ProjectRef) {
    const out: string[] = [];
    const walkDir = async (dir: string) => {
      for (const entry of await provider.listDir(ref, dir)) {
        if (entry.kind === "folder") await walkDir(entry.path);
        else out.push(entry.path);
      }
    };
    await walkDir(ROOT_PATH);
    return out;
  }

  /** Puts `book` on a store: files first, then the records, then removals. */
  async function write(provider: StorageProvider, ref: ProjectRef, book: Book) {
    const next = Object.entries(filesOf(book));
    for (const [path, content] of next.filter(([p]) => !isRecords(p)))
      await provider.writeFile(ref, path, content);
    for (const [path, content] of next.filter(([p]) => isRecords(p)))
      await provider.writeFile(ref, path, content);
    const keep = new Set(next.map(([path]) => path));
    for (const path of await allPaths(provider, ref))
      if (isBook(path) && !keep.has(path)) await provider.removeFile(ref, path);
  }

  async function devices(book: Book) {
    const { pair } = await import("./pairing");
    const { rebuildManifest } = await import("./apply");
    const { putManifest } = await import("./manifestStore");
    const seed = { "/document-properties.json": PROPS, ...filesOf(book) };
    const a = { provider: createStore(seed), ref: localRef };
    const remote = { provider: createStore(seed), ref: driveRef };
    const b = { provider: createStore(seed), ref: bRef };
    await pair("local-1", TARGET);
    await pair("local-2", TARGET);
    await putManifest("local-1", await rebuildManifest(a, remote, TARGET));
    await putManifest("local-2", await rebuildManifest(b, remote, TARGET));
    return { a, remote, b };
  }

  /** What B's copy opens as: its catalogue, or the refusal's codes. */
  async function reopen(side: { provider: StorageProvider; ref: ProjectRef }) {
    const { readProject } =
      await import("../../editor/project/application/projectOpener");
    const { providerReader } =
      await import("../../editor/project/storageStores");
    const { getManifest } = await import("./manifestStore");
    const reader = {
      ...providerReader(side.provider),
      pullUnfinished: async () =>
        (await getManifest("local-2"))?.pulling === true,
    };
    const verdict = await readProject(reader, side.ref, "Once Dark");
    if (!verdict?.ok) return verdict?.errors.map((e) => e.code);
    return verdict.catalogue;
  }

  const expected = (book: Book): unknown =>
    JSON.parse(filesOf(book)["/snapshots-catalogue.json"] ?? "{}");

  it("each step on one device opens with the same records on the other", async () => {
    const { checkSync } = await import("./check");
    const start: Book = { live: [[FIRST, "One"]] };
    const steps: [string, Book][] = [
      [
        "take",
        {
          live: [
            [FIRST, "One"],
            [SECOND, "Two"],
          ],
        },
      ],
      [
        "rename",
        {
          live: [
            [FIRST, "One"],
            [SECOND, "Second draft"],
          ],
        },
      ],
      ["bin", { live: [[FIRST, "One"]], binned: [[SECOND, "Second draft"]] }],
      [
        "restore",
        {
          live: [
            [FIRST, "One"],
            [SECOND, "Second draft"],
          ],
        },
      ],
      [
        "bin again",
        { live: [[FIRST, "One"]], binned: [[SECOND, "Second draft"]] },
      ],
      ["delete from the bin", { live: [[FIRST, "One"]] }],
      ["remove the node", { live: [[FIRST, "One"]], removed: true }],
    ];
    const { a, remote, b } = await devices(start);
    expect(await reopen(b)).toEqual(expected(start));

    for (const [name, book] of steps) {
      await write(a.provider, a.ref, book);
      const pushed = await checkSync(a, remote, "local-1");
      expect([name, pushed?.verdict.conflict]).toEqual([name, false]);
      const pulled = await checkSync(b, remote, "local-2");
      expect([name, pulled?.verdict.conflict, pulled?.uploading]).toEqual([
        name,
        false,
        undefined,
      ]);
      expect([name, await reopen(b)]).toEqual([name, expected(book)]);
    }
  });

  it("does not pull from a remote another device is still uploading", async () => {
    const { checkSync } = await import("./check");
    const { getManifest } = await import("./manifestStore");
    const { a, remote, b } = await devices({ live: [[FIRST, "One"]] });
    // A took a snapshot; only its file has reached the remote so far.
    await remote.provider.writeFile(remote.ref, `/document/${SECOND}`, "# Two");
    const before = await getManifest("local-2");

    const result = await checkSync(b, remote, "local-2");

    expect(result?.uploading).toBe(true);
    expect(await b.provider.exists(b.ref, `/document/${SECOND}`)).toBe(false);
    expect(await getManifest("local-2")).toEqual(before);

    // The rest arrives; the next check pulls it.
    const book: Book = {
      live: [
        [FIRST, "One"],
        [SECOND, "Two"],
      ],
    };
    await write(a.provider, a.ref, book);
    await write(remote.provider, remote.ref, book);
    const next = await checkSync(b, remote, "local-2");
    expect(next?.uploading).toBeUndefined();
    expect(await reopen(b)).toEqual(expected(book));
  });

  it.each(["local", "remote"] as const)(
    "two devices that each took a snapshot both open after keeping %s",
    async (keep) => {
      const { checkSync } = await import("./check");
      const { resolveConflict } = await import("./apply");
      const { putManifest } = await import("./manifestStore");
      const THIRD = "section--one.EL1.02.md";
      const { a, remote, b } = await devices({ live: [[FIRST, "One"]] });
      const onA: Book = {
        live: [
          [FIRST, "One"],
          [SECOND, "A's take"],
        ],
      };
      const onB: Book = {
        live: [
          [FIRST, "One"],
          [THIRD, "B's take"],
        ],
      };
      await write(a.provider, a.ref, onA);
      await checkSync(a, remote, "local-1");
      await write(b.provider, b.ref, onB);

      const clash = await checkSync(b, remote, "local-2");
      expect(clash?.verdict.conflict).toBe(true);
      if (!clash) return;
      const { manifest, backupDir } = await resolveConflict(
        keep,
        b,
        remote,
        clash.verdict,
        clash.remoteTarget,
      );
      await putManifest("local-2", manifest);
      await checkSync(a, remote, "local-1");

      const kept = keep === "local" ? onB : onA;
      const [lost, lostTitle] =
        keep === "local" ? [SECOND, "A's take"] : [THIRD, "B's take"];
      expect(await reopen(a)).toEqual(expected(kept));
      expect(await reopen(b)).toEqual(expected(kept));
      expect(
        await b.provider.readFile(b.ref, `${backupDir}/document/${lost}`),
      ).toBe(`# ${lostTitle}`);
    },
  );

  it("will not keep a remote that is still being uploaded, and both copies still open", async () => {
    const { checkSync } = await import("./check");
    const { resolveConflict, isWinnerUnsettled } = await import("./apply");
    const { remote, b } = await devices({ live: [[FIRST, "One"]] });
    // A changed the chapter and took a snapshot; the chapter and the snapshot
    // file have reached the remote, the catalogue has not.
    await remote.provider.writeFile(remote.ref, `/document/${FIRST}`, "# A");
    await remote.provider.writeFile(remote.ref, `/document/${SECOND}`, "# Two");
    // B changed the same chapter.
    await b.provider.writeFile(b.ref, `/document/${FIRST}`, "# B");

    const clash = await checkSync(b, remote, "local-2");
    expect(clash?.verdict.conflict).toBe(true);
    if (!clash) return;
    const refused = await resolveConflict(
      "remote",
      b,
      remote,
      clash.verdict,
      clash.remoteTarget,
    ).catch((err: unknown) => err);

    expect(isWinnerUnsettled(refused)).toBe(true);
    expect(await b.provider.readFile(b.ref, `/document/${FIRST}`)).toBe("# B");
    expect(await reopen(b)).toEqual(expected({ live: [[FIRST, "One"]] }));
  });

  it("a pull that stops partway says so at the open, and the next check finishes it", async () => {
    const { checkSync } = await import("./check");
    const { getManifest } = await import("./manifestStore");
    const { a, remote, b } = await devices({ live: [[FIRST, "One"]] });
    const book: Book = {
      live: [
        [FIRST, "One"],
        [SECOND, "Two"],
      ],
    };
    await write(a.provider, a.ref, book);
    await checkSync(a, remote, "local-1");

    // B's disk fails after the pull's first write.
    const writeFile = b.provider.writeFile.bind(b.provider);
    let writes = 0;
    b.provider.writeFile = async (ref, path, content) => {
      writes += 1;
      if (writes > 1) throw new Error("disk full");
      await writeFile(ref, path, content);
    };
    await expect(checkSync(b, remote, "local-2")).rejects.toThrow("disk full");
    expect(await b.provider.exists(b.ref, `/document/${SECOND}`)).toBe(true);
    expect((await getManifest("local-2"))?.pulling).toBe(true);
    expect(await reopen(b)).toEqual(["syncUnfinished"]);

    b.provider.writeFile = writeFile;
    const finished = await checkSync(b, remote, "local-2");
    expect(finished?.verdict.conflict).toBe(false);
    expect((await getManifest("local-2"))?.pulling).toBeUndefined();
    expect(await reopen(b)).toEqual(expected(book));
  });

  it("a removal the pull cannot make is retried, never uploaded back", async () => {
    const { checkSync } = await import("./check");
    const { getManifest } = await import("./manifestStore");
    const start: Book = {
      live: [
        [FIRST, "One"],
        [SECOND, "Two"],
      ],
    };
    const { a, remote, b } = await devices(start);
    // A bins the second snapshot: its file moves to the bin.
    const binnedBook: Book = {
      live: [[FIRST, "One"]],
      binned: [[SECOND, "Two"]],
    };
    await write(a.provider, a.ref, binnedBook);
    await checkSync(a, remote, "local-1");

    // B cannot remove the file the bin move left behind.
    const removeFile = b.provider.removeFile.bind(b.provider);
    b.provider.removeFile = async () => {
      throw new StorageError("Access denied", "permission");
    };
    await expect(checkSync(b, remote, "local-2")).rejects.toMatchObject({
      code: "permission",
    });
    expect((await getManifest("local-2"))?.pulling).toBe(true);
    expect(await reopen(b)).toEqual(["syncUnfinished"]);

    // A check while the removal still fails uploads nothing.
    await expect(checkSync(b, remote, "local-2")).rejects.toMatchObject({
      code: "permission",
    });
    expect(
      await remote.provider.exists(remote.ref, `/document/${SECOND}`),
    ).toBe(false);

    b.provider.removeFile = removeFile;
    await checkSync(b, remote, "local-2");
    expect(
      await remote.provider.exists(remote.ref, `/document/${SECOND}`),
    ).toBe(false);
    expect(await reopen(b)).toEqual(expected(binnedBook));
    expect(await reopen(remote)).toEqual(expected(binnedBook));
  });
});
