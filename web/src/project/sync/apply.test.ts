// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  baselinesForUpload,
  isWinnerUnsettled,
  pull,
  push,
  rebuildManifest,
  resolveConflict,
} from "./apply";
import { compare } from "./compare";
import { emptyManifest, withBaseline } from "./manifest";
import { scan } from "./scan";
import { sha256Hex } from "../../text/hash";
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

/** The pairing every fixture here points at: one backend, one folder. */
const TARGET = { providerId: "drive", key: "folder-1" };

// An independent in-memory backend per instance: `memoryProvider.ts`'s logic
// (path-prefix `listDir`, sha256 fingerprints) as a factory, because
// `apply.ts` bridges two sides and the real `memoryProvider` is one shared
// singleton.

function createStore(seed: Record<string, string> = {}): StorageProvider {
  const files = new Map(Object.entries(seed));
  const emptyDirs = new Set<string>();

  const requireFile = (path: string): string => {
    const content = files.get(path);
    if (content === undefined)
      throw new StorageError(`File not found: ${path}`, "not-found");
    return content;
  };

  return {
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
      void hint;
      return { hash: await sha256Hex(requireFile(path)) };
    },

    async fingerprintDir(
      _ref: ProjectRef,
      dirPath: string,
      hints?: Map<string, FileHint>,
    ): Promise<Map<string, FileFingerprint>> {
      void hints;
      const prefix = dirPath === ROOT_PATH ? ROOT_PATH : `${dirPath}/`;
      const out = new Map<string, FileFingerprint>();
      for (const [filePath, content] of files) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (rest.length === 0 || rest.includes("/")) continue;
        out.set(rest, { hash: await sha256Hex(content) });
      }
      return out;
    },
  };
}

const ref: ProjectRef = {
  providerId: "fake-store",
  key: "k",
  name: "Project",
  openedAt: "",
};

/** A store whose removals fail with `code`, leaving the file in place. */
function refusingRemoval(
  seed: Record<string, string>,
  code: "not-found" | "permission",
): StorageProvider {
  return {
    ...createStore(seed),
    removeFile: async () => {
      throw new StorageError("Cannot remove", code);
    },
  };
}

/** A manifest holding one agreed baseline for `path`. */
const agreedOn = (path: string) =>
  withBaseline(emptyManifest(TARGET), path, {
    local: "x",
    remote: "x",
    remoteFileId: "",
    localMtime: 0,
  });

describe("pull", () => {
  it("writes a Drive-changed file down to local", async () => {
    const local = {
      provider: createStore({ "/document/section--a.md": "old" }),
      ref,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "new" }),
      ref,
    };
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });

    const next = await pull(
      local,
      drive,
      ["/document/section--a.md"],
      manifest,
    );

    expect(await local.provider.readFile(ref, "/document/section--a.md")).toBe(
      "new",
    );
    expect(next.files["/document/section--a.md"]).toBeDefined();
  });

  it("deletes locally when Drive no longer has the file", async () => {
    const local = {
      provider: createStore({ "/document/section--a.md": "still here" }),
      ref,
    };
    const drive = { provider: createStore({}), ref };
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });

    await pull(local, drive, ["/document/section--a.md"], manifest);

    expect(await local.provider.exists(ref, "/document/section--a.md")).toBe(
      false,
    );
  });

  it("stops on a removal that fails, so the next check retries it", async () => {
    const path = "/snapshots/section--a--first.md";
    const local = {
      provider: refusingRemoval({ [path]: "draft" }, "permission"),
      ref,
    };
    // The remote still holds the book, so its copy is not gone.
    const drive = {
      provider: createStore({ "/document-structure.yaml": "structure" }),
      ref,
    };

    await expect(
      pull(local, drive, [path], agreedOn(path)),
    ).rejects.toMatchObject({ code: "permission" });
    expect(await local.provider.readFile(ref, path)).toBe("draft");
  });

  it("takes a removal that finds nothing as done", async () => {
    const path = "/snapshots/section--a--first.md";
    const local = { provider: refusingRemoval({}, "not-found"), ref };
    const drive = {
      provider: createStore({ "/document-structure.yaml": "structure" }),
      ref,
    };

    const next = await pull(local, drive, [path], agreedOn(path));

    expect(next.files[path]).toBeUndefined();
  });

  it("drops the baseline for a path now gone from both sides", async () => {
    const local = { provider: createStore({}), ref };
    const drive = { provider: createStore({}), ref };
    const manifest = withBaseline(
      emptyManifest({ providerId: "drive", key: "folder-1" }),
      "/gone.md",
      {
        local: "x",
        remote: "x",
        remoteFileId: "",
        localMtime: 0,
      },
    );

    const next = await pull(local, drive, ["/gone.md"], manifest);

    expect(next.files["/gone.md"]).toBeUndefined();
  });

  it("refuses to delete anything when the remote copy is gone", async () => {
    const local = {
      provider: createStore({
        "/document-structure.yaml": "structure",
        "/document/section--a.md": "chapter one",
      }),
      ref,
    };
    // Trashed: the folder still answers, but lists nothing.
    const drive = { provider: createStore(), ref };

    await expect(
      pull(
        local,
        drive,
        ["/document/section--a.md"],
        emptyManifest({ providerId: "drive", key: "folder-1" }),
      ),
    ).rejects.toThrow();
    expect(await local.provider.readFile(ref, "/document/section--a.md")).toBe(
      "chapter one",
    );
  });

  it("leaves the rest of the manifest untouched", async () => {
    const local = {
      provider: createStore({ "/a.md": "old", "/b.md": "unrelated" }),
      ref,
    };
    const drive = {
      provider: createStore({ "/a.md": "new", "/b.md": "unrelated" }),
      ref,
    };
    const manifest = withBaseline(
      emptyManifest({ providerId: "drive", key: "folder-1" }),
      "/b.md",
      {
        local: "keep-me",
        remote: "keep-me",
        remoteFileId: "",
        localMtime: 0,
      },
    );

    const next = await pull(local, drive, ["/a.md"], manifest);

    expect(next.files["/b.md"]).toEqual(manifest.files["/b.md"]);
  });

  it("records the drive file id it resolved, when the drive side reports one", async () => {
    const baseDrive = createStore({ "/document/section--a.md": "new" });
    const drive = {
      provider: { ...baseDrive, fileIdOf: async () => "drive-id-1" },
      ref,
    };
    const local = {
      provider: createStore({ "/document/section--a.md": "old" }),
      ref,
    };

    const next = await pull(
      local,
      drive,
      ["/document/section--a.md"],
      emptyManifest({ providerId: "drive", key: "folder-1" }),
    );

    expect(next.files["/document/section--a.md"].remoteFileId).toBe(
      "drive-id-1",
    );
  });
});

describe("push", () => {
  it("writes a local-changed file up to Drive", async () => {
    const local = {
      provider: createStore({ "/document/section--a.md": "edited offline" }),
      ref,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "old" }),
      ref,
    };
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });

    const next = await push(
      local,
      drive,
      ["/document/section--a.md"],
      manifest,
    );

    expect(await drive.provider.readFile(ref, "/document/section--a.md")).toBe(
      "edited offline",
    );
    expect(next.files["/document/section--a.md"]).toBeDefined();
  });

  it("creates a brand-new local file on Drive", async () => {
    const local = {
      provider: createStore({ "/document/section--b.md": "brand new" }),
      ref,
    };
    const drive = { provider: createStore({}), ref };
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });

    await push(local, drive, ["/document/section--b.md"], manifest);

    expect(await drive.provider.readFile(ref, "/document/section--b.md")).toBe(
      "brand new",
    );
  });

  it("removes from Drive a file that no longer exists locally", async () => {
    const local = { provider: createStore({}), ref };
    const drive = {
      provider: createStore({ "/document/section--a.md": "gone locally" }),
      ref,
    };
    const manifest = emptyManifest({ providerId: "drive", key: "folder-1" });

    await push(local, drive, ["/document/section--a.md"], manifest);

    expect(await drive.provider.exists(ref, "/document/section--a.md")).toBe(
      false,
    );
  });

  it("stops on a removal that fails, so the next check retries it", async () => {
    const path = "/snapshots/section--a--first.md";
    const local = { provider: createStore({}), ref };
    const drive = {
      provider: refusingRemoval({ [path]: "draft" }, "permission"),
      ref,
    };

    await expect(
      push(local, drive, [path], agreedOn(path)),
    ).rejects.toMatchObject({ code: "permission" });
    expect(await drive.provider.readFile(ref, path)).toBe("draft");
  });

  it("takes a removal that finds nothing as done", async () => {
    const path = "/snapshots/section--a--first.md";
    const local = { provider: createStore({}), ref };
    const drive = { provider: refusingRemoval({}, "not-found"), ref };

    const next = await push(local, drive, [path], agreedOn(path));

    expect(next.files[path]).toBeUndefined();
  });

  it("drops the baseline for a path now gone from both sides", async () => {
    const local = { provider: createStore({}), ref };
    const drive = { provider: createStore({}), ref };
    const manifest = withBaseline(
      emptyManifest({ providerId: "drive", key: "folder-1" }),
      "/gone.md",
      {
        local: "x",
        remote: "x",
        remoteFileId: "",
        localMtime: 0,
      },
    );

    const next = await push(local, drive, ["/gone.md"], manifest);

    expect(next.files["/gone.md"]).toBeUndefined();
  });

  it("records the id the drive side reports for a write", async () => {
    const baseDrive = createStore({});
    const drive = {
      provider: {
        ...baseDrive,
        writeFile: async (r: ProjectRef, p: string, c: string) => {
          await baseDrive.writeFile(r, p, c);
          return "drive-id-2";
        },
      },
      ref,
    };
    const local = {
      provider: createStore({ "/document/section--a.md": "brand new" }),
      ref,
    };

    const next = await push(
      local,
      drive,
      ["/document/section--a.md"],
      emptyManifest({ providerId: "drive", key: "folder-1" }),
    );

    expect(next.files["/document/section--a.md"].remoteFileId).toBe(
      "drive-id-2",
    );
  });
});

describe("rebuildManifest", () => {
  it("records a baseline for every path both sides agree on after a copy", async () => {
    const local = {
      provider: createStore({ "/document/section--a.md": "same" }),
      ref,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "same" }),
      ref,
    };

    const manifest = await rebuildManifest(local, drive, TARGET);

    expect(manifest.remote).toEqual({ providerId: "drive", key: "folder-1" });
    const baseline = manifest.files["/document/section--a.md"];
    expect(baseline).toBeDefined();
    expect(baseline.local).toBe(baseline.remote);
  });

  it("a fresh manifest built this way reports no conflict against the same scans", async () => {
    const local = {
      provider: createStore({ "/document/section--a.md": "same" }),
      ref,
    };
    const drive = {
      provider: createStore({ "/document/section--a.md": "same" }),
      ref,
    };

    const manifest = await rebuildManifest(local, drive, TARGET);
    const verdict = compare(
      await scan(local.provider, ref),
      await scan(drive.provider, ref),
      manifest,
    );

    expect(verdict.conflict).toBe(false);
    expect(verdict.files.every((f) => f.status === "clean")).toBe(true);
  });
});

describe("baselinesForUpload", () => {
  const A = "/document/section--a.md";
  const B = "/document/section--b.md";

  /** A remote that answers every fingerprint with a time, not a digest. */
  function weakStore(seed: Record<string, string>): StorageProvider {
    const store = createStore(seed);
    const weak = async (): Promise<FileFingerprint> => ({
      hash: "2026-10-25T10:00:00Z",
      weak: true,
    });
    return {
      ...store,
      fingerprintFile: weak,
      async fingerprintDir(r, dir) {
        const out = new Map<string, FileFingerprint>();
        for (const name of (await store.fingerprintDir(r, dir)).keys())
          out.set(name, await weak());
        return out;
      },
    };
  }

  it("records what the copy sent on both sides, and the next scan reads clean", async () => {
    const local = { provider: createStore({ [A]: "prose" }), ref };
    const drive = { provider: createStore({ [A]: "prose" }), ref };

    const files = await baselinesForUpload(
      local,
      drive,
      new Map([[A, "prose"]]),
    );

    const digest = await sha256Hex("prose");
    expect(files[A]).toMatchObject({ local: digest, remote: digest });
    const verdict = compare(
      await scan(local.provider, ref),
      await scan(drive.provider, ref),
      { ...emptyManifest(TARGET), files },
    );
    expect(verdict.files.map((f) => f.status)).toEqual(["clean"]);
  });

  it("records a weak remote's own fingerprint, marked weak", async () => {
    const local = { provider: createStore({ [A]: "prose" }), ref };
    const drive = { provider: weakStore({ [A]: "prose" }), ref };

    const files = await baselinesForUpload(
      local,
      drive,
      new Map([[A, "prose"]]),
    );

    expect(files[A]).toMatchObject({
      local: await sha256Hex("prose"),
      remote: "2026-10-25T10:00:00Z",
      weak: true,
    });
  });

  it("gives no baseline to a file the writer changed after the copy read it", async () => {
    const local = { provider: createStore({ [A]: "edited", [B]: "b" }), ref };
    const drive = { provider: createStore({ [A]: "prose", [B]: "b" }), ref };

    const files = await baselinesForUpload(
      local,
      drive,
      new Map([
        [A, "prose"],
        [B, "b"],
      ]),
    );

    expect(files[A]).toBeUndefined();
    expect(files[B]).toBeDefined();
  });
});

describe("resolveConflict", () => {
  // A kept side must open as it is, so each side here is a real book: one
  // Section, whose snapshots its catalogue lists.
  const book = (...files: string[]) => ({
    "/document-structure.yaml": [
      "version: 1",
      "document:",
      "  - id: EL1",
      "    section: A",
      `    adopted: ${files[0]}`,
      "",
    ].join("\n"),
    "/snapshots-catalogue.json": JSON.stringify({
      snapshots: {
        EL1: files.map((file, i) => ({
          file,
          title: `Draft ${i}`,
          created: "2026-01-01T00:00:00.000Z",
        })),
      },
      binned: {},
    }),
  });
  const ONE = book("section--a.EL1.00.md");
  const TWO = book("section--a.EL1.00.md", "section--a.EL1.01.md");

  it("refuses a kept side that does not agree with itself, and changes nothing", async () => {
    const localFiles = {
      ...ONE,
      "/document/section--a.EL1.00.md": "local chapter",
    };
    // Another device's snapshot file has arrived; its record has not.
    const driveFiles = {
      ...ONE,
      "/document/section--a.EL1.00.md": "drive chapter",
      "/document/section--a.EL1.01.md": "a snapshot on its way",
    };
    const local = { provider: createStore(localFiles), ref };
    const drive = { provider: createStore(driveFiles), ref };
    const verdict = {
      files: [
        { path: "/document/section--a.EL1.00.md", status: "conflict" as const },
      ],
      conflict: true,
      toPull: [],
      toPush: [],
    };

    const refused = await resolveConflict(
      "remote",
      local,
      drive,
      verdict,
      TARGET,
    ).catch((err: unknown) => err);

    expect(isWinnerUnsettled(refused)).toBe(true);
    for (const [path, bytes] of Object.entries(localFiles))
      expect(await local.provider.readFile(ref, path)).toBe(bytes);
    expect(
      await local.provider.exists(ref, "/document/section--a.EL1.01.md"),
    ).toBe(false);
    for (const [path, bytes] of Object.entries(driveFiles))
      expect(await drive.provider.readFile(ref, path)).toBe(bytes);

    // The device's copy agrees with itself, so it can win.
    await resolveConflict("local", local, drive, verdict, TARGET);
    expect(
      await drive.provider.exists(ref, "/document/section--a.EL1.01.md"),
    ).toBe(false);
  });

  it('"keep local" overwrites Drive with local\'s content', async () => {
    const local = {
      provider: createStore({
        ...ONE,
        "/document/section--a.EL1.00.md": "local wins here",
      }),
      ref,
    };
    const drive = {
      provider: createStore({
        ...ONE,
        "/document/section--a.EL1.00.md": "drive version",
      }),
      ref,
    };
    const manifest = withBaseline(
      emptyManifest({ providerId: "drive", key: "folder-1" }),
      "/document/section--a.EL1.00.md",
      {
        local: "base-local",
        remote: "base-drive",
        remoteFileId: "",
        localMtime: 0,
      },
    );
    const verdict = compare(
      await scan(local.provider, ref),
      await scan(drive.provider, ref),
      manifest,
    );
    expect(verdict.conflict).toBe(true);

    const { manifest: rebuilt, backupDir } = await resolveConflict(
      "local",
      local,
      drive,
      verdict,
      TARGET,
    );

    expect(
      await drive.provider.readFile(ref, "/document/section--a.EL1.00.md"),
    ).toBe("local wins here");
    expect(backupDir).not.toBeNull();
    // The discarded Drive content survives, backed up on local.
    expect(
      await local.provider.readFile(
        ref,
        `${backupDir}/document/section--a.EL1.00.md`,
      ),
    ).toBe("drive version");
    expect(rebuilt.files["/document/section--a.EL1.00.md"].local).toBe(
      rebuilt.files["/document/section--a.EL1.00.md"].remote,
    );
  });

  it("\"keep drive\" overwrites local with Drive's content, backing up local's version first", async () => {
    const local = {
      provider: createStore({
        ...ONE,
        "/document/section--a.EL1.00.md": "local version",
      }),
      ref,
    };
    const drive = {
      provider: createStore({
        ...ONE,
        "/document/section--a.EL1.00.md": "drive wins here",
      }),
      ref,
    };
    const manifest = withBaseline(
      emptyManifest({ providerId: "drive", key: "folder-1" }),
      "/document/section--a.EL1.00.md",
      {
        local: "base-local",
        remote: "base-drive",
        remoteFileId: "",
        localMtime: 0,
      },
    );
    const verdict = compare(
      await scan(local.provider, ref),
      await scan(drive.provider, ref),
      manifest,
    );

    const { backupDir } = await resolveConflict(
      "remote",
      local,
      drive,
      verdict,
      TARGET,
    );

    expect(
      await local.provider.readFile(ref, "/document/section--a.EL1.00.md"),
    ).toBe("drive wins here");
    expect(
      await local.provider.readFile(
        ref,
        `${backupDir}/document/section--a.EL1.00.md`,
      ),
    ).toBe("local version");
  });

  it("backs up every file the copy overwrites with different bytes, not only the verdict's paths", async () => {
    const local = {
      provider: createStore({
        ...TWO,
        "/document/section--a.EL1.00.md": "local chapter",
        "/document-properties.json": "local properties",
        "/document-history.json": "local history",
        "/recyclebin/section--old.md": "local binned",
        "/document/section--a.EL1.01.md": "same on both",
      }),
      ref,
    };
    const drive = {
      provider: createStore({
        ...TWO,
        "/document/section--a.EL1.00.md": "drive chapter",
        "/document-properties.json": "drive properties",
        "/document-history.json": "drive history",
        "/recyclebin/section--old.md": "drive binned",
        "/document/section--a.EL1.01.md": "same on both",
      }),
      ref,
    };
    // The verdict names only the scanned chapter, as a check produces it.
    const verdict = {
      files: [
        { path: "/document/section--a.EL1.00.md", status: "conflict" as const },
      ],
      conflict: true,
      toPull: [],
      toPush: [],
    };

    const { backupDir } = await resolveConflict(
      "remote",
      local,
      drive,
      verdict,
      TARGET,
    );

    expect(backupDir).not.toBeNull();
    for (const [path, bytes] of [
      ["/document/section--a.EL1.00.md", "local chapter"],
      ["/document-properties.json", "local properties"],
      ["/document-history.json", "local history"],
      ["/recyclebin/section--old.md", "local binned"],
    ]) {
      expect(await local.provider.readFile(ref, `${backupDir}${path}`)).toBe(
        bytes,
      );
    }
    // Equal bytes lose nothing to the overwrite and are not copied.
    expect(
      await local.provider.exists(
        ref,
        `${backupDir}/document/section--a.EL1.01.md`,
      ),
    ).toBe(false);
    expect(
      await local.provider.readFile(ref, "/document-properties.json"),
    ).toBe("drive properties");
  });

  it("backs up, then removes, the scanned files only the losing side holds", async () => {
    const local = {
      provider: createStore({
        ...TWO,
        "/document/section--a.EL1.00.md": "both",
        "/document/section--a.EL1.01.md": "local only snapshot",
        "/recyclebin/section--a.EL1.02.md": "local only binned",
        "/document/notes.txt": "the writer's own file",
      }),
      ref,
    };
    const drive = {
      provider: createStore({
        ...book("section--a.EL1.00.md", "section--a.EL1.03.md"),
        "/document/section--a.EL1.00.md": "both",
        "/document/section--a.EL1.03.md": "drive only snapshot",
      }),
      ref,
    };
    const verdict = {
      files: [
        { path: "/snapshots-catalogue.json", status: "conflict" as const },
      ],
      conflict: true,
      toPull: [],
      toPush: [],
    };

    const { backupDir } = await resolveConflict(
      "remote",
      local,
      drive,
      verdict,
      TARGET,
    );

    for (const path of [
      "/document/section--a.EL1.01.md",
      "/recyclebin/section--a.EL1.02.md",
      "/document/notes.txt",
    ]) {
      expect(await local.provider.exists(ref, path)).toBe(false);
      expect(await local.provider.exists(ref, `${backupDir}${path}`)).toBe(
        true,
      );
    }
    expect(
      await local.provider.readFile(ref, "/snapshots-catalogue.json"),
    ).toBe(
      book("section--a.EL1.00.md", "section--a.EL1.03.md")[
        "/snapshots-catalogue.json"
      ],
    );
    expect(
      await local.provider.readFile(ref, "/document/section--a.EL1.03.md"),
    ).toBe("drive only snapshot");
    // The kept side is untouched.
    expect(
      await drive.provider.exists(ref, "/document/section--a.EL1.01.md"),
    ).toBe(false);
  });

  it("keeping local removes the remote's losing-only files the same way", async () => {
    const local = {
      provider: createStore({
        ...ONE,
        "/document/section--a.EL1.00.md": "both",
      }),
      ref,
    };
    const drive = {
      provider: createStore({
        ...book("section--a.EL1.00.md", "section--a.EL1.03.md"),
        "/document/section--a.EL1.00.md": "both",
        "/document/section--a.EL1.03.md": "drive only snapshot",
      }),
      ref,
    };
    const verdict = {
      files: [
        { path: "/document/section--a.EL1.03.md", status: "conflict" as const },
      ],
      conflict: true,
      toPull: [],
      toPush: [],
    };

    const { backupDir } = await resolveConflict(
      "local",
      local,
      drive,
      verdict,
      TARGET,
    );

    expect(
      await drive.provider.exists(ref, "/document/section--a.EL1.03.md"),
    ).toBe(false);
    expect(
      await local.provider.readFile(
        ref,
        `${backupDir}/document/section--a.EL1.03.md`,
      ),
    ).toBe("drive only snapshot");
  });

  it("refuses a gone remote's verdict and touches neither side", async () => {
    const { remoteGoneVerdict } = await import("./compare");
    const local = {
      provider: createStore({
        ...TWO,
        "/document/section--a.EL1.00.md": "local chapter",
      }),
      ref,
    };
    const drive = { provider: createStore(), ref };

    await expect(
      resolveConflict("remote", local, drive, remoteGoneVerdict(), TARGET),
    ).rejects.toThrow();
    expect(
      await local.provider.readFile(ref, "/document/section--a.EL1.00.md"),
    ).toBe("local chapter");
  });

  it("no backup folder when nothing had actually diverged", async () => {
    const same = { ...ONE, "/document/section--a.EL1.00.md": "same" };
    const local = { provider: createStore(same), ref };
    const drive = { provider: createStore(same), ref };
    const manifest = await rebuildManifest(local, drive, TARGET);
    const verdict = compare(
      await scan(local.provider, ref),
      await scan(drive.provider, ref),
      manifest,
    );

    const { backupDir } = await resolveConflict(
      "local",
      local,
      drive,
      verdict,
      TARGET,
    );

    expect(backupDir).toBeNull();
  });
});
