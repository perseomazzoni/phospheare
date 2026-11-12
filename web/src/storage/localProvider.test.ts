// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOT_PATH, StorageError, type ProjectRef } from "./types";
import { STRUCTURE_FILE } from "../project/naming";
import { baseName } from "./types";
import {
  __setLocalRootPickerForTest,
  __resetLocalRootCacheForTest,
} from "./localRoot";
import { sha256Hex } from "../text/hash";

// The File System Access API is Chromium-only and needs a native picker no
// test can drive, so the provider as a whole is not unit-testable. `canAccess`
// is pinned: the Library calls it for every document on its first paint, and
// it must never put a permission dialog there.
//
// `listLocalProjects` and `createLocalProject` are pinned with fake handle
// trees: the scan must read real books out of the mapped root, and creation
// goes straight into the mapped root without opening the picker. The
// picker seam is installed as a spy, so any picker call fails the test.

const getHandle = vi.fn();
vi.mock("./handleStore", () => ({
  getHandle: (key: string) => getHandle(key),
  putHandle: vi.fn(),
  removeHandle: vi.fn(),
  listHandles: vi.fn(async () => []),
}));

const { localProvider, listLocalProjects, createLocalProject } =
  await import("./localProvider");

const ref: ProjectRef = {
  providerId: "local",
  key: "abc",
  name: "Once Dark",
  openedAt: "2026-07-28T10:00:00.000Z",
};

/** A directory handle that records whether anything asked the writer. */
function handle(
  permission: PermissionState,
  opts: { queryThrows?: boolean } = {},
) {
  const requestPermission = vi.fn(async () => "granted" as PermissionState);
  return {
    requestPermission,
    queryPermission: vi.fn(async () => {
      if (opts.queryThrows) throw new Error("handle is not usable");
      return permission;
    }),
  };
}

/**
 * A fake handle tree for the root-model walk. The root carries the permission
 * surface the provider probes; every level answers getDirectoryHandle by
 * name, and the scan iterates entries().
 */
class FakeDir {
  kind = "directory" as const;
  dirs = new Map<string, FakeDir>();
  // Bytes, not just names: the read and write half of the port needs content
  // to hand back, and a fake that returns an empty handle would let every
  // round trip pass without a byte having moved.
  files = new Map<string, string>();
  // Chromium ships `move()` on a file handle and the standard does not, so the
  // provider has two paths through `relocate`. Off by default, since more
  // browsers have the standard shape, and switched on per directory by the
  // row that pins the atomic path.
  atomicMove = false;
  // How many times bytes were copied through a writable. The two rename paths
  // reach the same end state, so this is the only thing that tells them apart.
  writables = 0;
  moveRejects = false;
  // A writable whose `write` rejects, and how many writables were aborted.
  writeRejects = false;
  aborts = 0;
  queryPermission = vi.fn(async () => "granted" as PermissionState);
  requestPermission = vi.fn(async () => "granted" as PermissionState);

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDir> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!opts?.create) throw new DOMException("Not found", "NotFoundError");
    const child = new FakeDir();
    this.dirs.set(name, child);
    return child;
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FileSystemFileHandle> {
    // The real API's name contract: a `TypeError` on a name that cannot be a
    // file name. A fake that accepts any string lets the scan probe
    // `getFileHandle("/document-structure.yaml")`, a path where the API
    // demands a bare name, while every real browser skips every book.
    if (!name || name.includes("/"))
      throw new TypeError("name contains invalid characters");
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException("Not found", "NotFoundError");
      this.files.set(name, "");
    }
    return this.fileHandle(name);
  }

  /**
   * A file handle over one entry of this directory's `files` map. An arrow
   * property rather than a method so the closures below carry `this` on their
   * own, which is also what the lint gate asks for.
   */
  fileHandle = (name: string): FileSystemFileHandle => {
    const handle = {
      kind: "file" as const,
      name,
      getFile: async () => ({
        text: async () => this.files.get(name) ?? "",
        lastModified: 0,
      }),
      createWritable: async () => {
        this.writables += 1;
        return {
          write: async (content: string) => {
            if (this.writeRejects)
              throw new DOMException("full", "QuotaExceededError");
            this.files.set(name, content);
          },
          close: async () => {},
          abort: async () => {
            this.aborts += 1;
          },
        };
      },
      ...(this.atomicMove
        ? {
            move: async (toDir: FakeDir, toName: string) => {
              if (this.moveRejects)
                throw new DOMException("no", "InvalidStateError");
              toDir.files.set(toName, this.files.get(name) ?? "");
              this.files.delete(name);
            },
          }
        : {}),
    };
    return handle as unknown as FileSystemFileHandle;
  };

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name))
      throw new DOMException("Not found", "NotFoundError");
  }

  async *entries(): AsyncGenerator<[string, FakeDir | { kind: "file" }]> {
    for (const [name, dir] of this.dirs) yield [name, dir];
    for (const name of this.files.keys())
      yield [name, { kind: "file" as const }];
  }

  async *keys(): AsyncGenerator<string> {
    for (const name of this.dirs.keys()) yield name;
    for (const name of this.files.keys()) yield name;
  }
}

/** A mapped root whose own folders hold two real books and one stray. */
function mappedRoot(): FakeDir {
  const root = new FakeDir();
  const salt = new FakeDir();
  salt.files.set(baseName(STRUCTURE_FILE), "");
  root.dirs.set("once-dark", salt);
  const ember = new FakeDir();
  ember.files.set(baseName(STRUCTURE_FILE), "");
  root.dirs.set("ember", ember);
  const stray = new FakeDir();
  stray.files.set("readme.txt", "");
  root.dirs.set("not-a-project", stray);
  root.files.set("notes.md", "");
  return root;
}

const picker = vi.fn(
  async () => null as unknown as FileSystemDirectoryHandle | null,
);

beforeEach(() => {
  getHandle.mockReset();
  __resetLocalRootCacheForTest();
  // Chromium, as far as the provider can tell.
  vi.stubGlobal("window", { showDirectoryPicker: () => {} });
  // The create flow must never reach the picker; a call here fails the test.
  __setLocalRootPickerForTest(
    picker as () => Promise<FileSystemDirectoryHandle | null>,
  );
});

afterEach(() => {
  __setLocalRootPickerForTest(null);
  vi.unstubAllGlobals();
});

describe("canAccess", () => {
  it("is granted when the browser already says so", async () => {
    getHandle.mockResolvedValue(handle("granted"));
    expect(await localProvider.canAccess(ref)).toBe("granted");
  });

  it("needs a gesture when permission has lapsed to prompt", async () => {
    getHandle.mockResolvedValue(handle("prompt"));
    expect(await localProvider.canAccess(ref)).toBe("needs-gesture");
  });

  it("needs a gesture when permission was denied — the writer can still change their mind", async () => {
    getHandle.mockResolvedValue(handle("denied"));
    expect(await localProvider.canAccess(ref)).toBe("needs-gesture");
  });

  it("is gone when this browser has no handle for the document", async () => {
    getHandle.mockResolvedValue(undefined);
    expect(await localProvider.canAccess(ref)).toBe("gone");
  });

  it("is gone when the handle cannot even be queried", async () => {
    getHandle.mockResolvedValue(handle("granted", { queryThrows: true }));
    expect(await localProvider.canAccess(ref)).toBe("gone");
  });

  it("is gone where the API does not exist at all", async () => {
    vi.stubGlobal("window", {});
    getHandle.mockResolvedValue(handle("granted"));
    expect(await localProvider.canAccess(ref)).toBe("gone");
  });

  it("never asks the writer for permission", async () => {
    for (const state of ["granted", "prompt", "denied"] as PermissionState[]) {
      const h = handle(state);
      getHandle.mockResolvedValue(h);
      await localProvider.canAccess(ref);
      expect(h.requestPermission).not.toHaveBeenCalled();
    }
  });
});

describe("statFile", () => {
  /**
   * A root handle whose `<key>/reference` walk resolves to a file handle, or
   * throws for the unreachable case. Every path goes root → <folder> → path,
   * with the picked folder itself as the root.
   */
  function rootWith(file: { lastModified: number } | Error) {
    const reference = {
      getFileHandle: vi.fn(async () => {
        if (file instanceof Error) throw file;
        return { getFile: vi.fn(async () => file) };
      }),
    };
    const project = {
      getDirectoryHandle: vi.fn(async () => reference),
    };
    return {
      requestPermission: vi.fn(async () => "granted" as PermissionState),
      queryPermission: vi.fn(async () => "granted" as PermissionState),
      getDirectoryHandle: vi.fn(async () => project),
    };
  }

  it("reports updatedAt only — the File System Access API knows no birth, and lastModified must not be dressed up as one", async () => {
    const root = rootWith({
      lastModified: Date.parse("2026-01-02T03:04:05.000Z"),
    });
    getHandle.mockResolvedValue(root);
    const stat = localProvider.statFile;
    if (!stat) throw new Error("localProvider.statFile missing");
    const meta = await stat(ref, "/reference/a.md");
    expect(meta).toEqual({ updatedAt: "2026-01-02T03:04:05.000Z" });
    expect(meta && "created" in meta).toBe(false);
  });

  it("answers null when the file is unreachable — never a throw", async () => {
    getHandle.mockResolvedValue(rootWith(new Error("gone")));
    const stat = localProvider.statFile;
    if (!stat) throw new Error("localProvider.statFile missing");
    expect(await stat(ref, "/reference/a.md")).toBe(null);
  });

  it("answers null when this browser holds no handle for the project", async () => {
    getHandle.mockResolvedValue(undefined);
    const stat = localProvider.statFile;
    if (!stat) throw new Error("localProvider.statFile missing");
    expect(await stat(ref, "/reference/a.md")).toBe(null);
  });
});

describe("fingerprintFile / fingerprintDir — the localMtime shortcut", () => {
  /**
   * Root → <key> → reference, the chain `rootWith` uses in the `statFile`
   * rows, generalized to several files with independent content and
   * `lastModified`, enough to drive both the single-file and the
   * bulk-directory path.
   */
  function rootWithReferenceDir(
    entries: Record<string, { content: string; lastModified: number }>,
  ) {
    const texts = new Map(
      Object.entries(entries).map(([name, { content }]) => [
        name,
        vi.fn(async () => content),
      ]),
    );
    const handles = new Map(
      Object.entries(entries).map(([name, { lastModified }]) => [
        name,
        {
          kind: "file" as const,
          getFile: vi.fn(async () => ({
            lastModified,
            text: texts.get(name),
          })),
        },
      ]),
    );
    const reference = {
      getFileHandle: vi.fn(async (name: string) => {
        const h = handles.get(name);
        if (!h) throw new DOMException("Not found", "NotFoundError");
        return h;
      }),
      entries: async function* () {
        for (const [name, h] of handles) yield [name, h] as const;
      },
    };
    const project = { getDirectoryHandle: vi.fn(async () => reference) };
    const root = {
      requestPermission: vi.fn(async () => "granted" as PermissionState),
      queryPermission: vi.fn(async () => "granted" as PermissionState),
      getDirectoryHandle: vi.fn(async () => project),
    };
    return { root, handles, texts };
  }

  describe("fingerprintFile", () => {
    it("hashes the real bytes when no hint is given", async () => {
      const { root } = rootWithReferenceDir({
        "a.md": { content: "hello", lastModified: 1000 },
      });
      getHandle.mockResolvedValue(root);
      const fp = await localProvider.fingerprintFile(ref, "/reference/a.md");
      expect(fp).toEqual({ hash: await sha256Hex("hello"), mtime: 1000 });
    });

    it("trusts the hint's hash — and never reads the file's content — when lastModified matches exactly", async () => {
      const { root, texts } = rootWithReferenceDir({
        "a.md": { content: "hello", lastModified: 1000 },
      });
      getHandle.mockResolvedValue(root);
      const fp = await localProvider.fingerprintFile(ref, "/reference/a.md", {
        mtime: 1000,
        hash: "prior-hash-reused",
      });
      expect(fp).toEqual({ hash: "prior-hash-reused", mtime: 1000 });
      // `getFile()` still runs, as the only way to read `lastModified`, but
      // `.text()`, the expensive read-and-hash step, never does.
      expect(texts.get("a.md")).not.toHaveBeenCalled();
    });

    it("falls back to a real hash when the mtime differs by even one millisecond, with no grace margin", async () => {
      const { root } = rootWithReferenceDir({
        "a.md": { content: "changed", lastModified: 1001 },
      });
      getHandle.mockResolvedValue(root);
      const fp = await localProvider.fingerprintFile(ref, "/reference/a.md", {
        mtime: 1000,
        hash: "stale-hash",
      });
      expect(fp).toEqual({ hash: await sha256Hex("changed"), mtime: 1001 });
    });

    it("falls back to a real hash when there is no hint at all", async () => {
      const { root } = rootWithReferenceDir({
        "a.md": { content: "hello", lastModified: 1000 },
      });
      getHandle.mockResolvedValue(root);
      const fp = await localProvider.fingerprintFile(ref, "/reference/a.md");
      expect(fp.hash).toBe(await sha256Hex("hello"));
    });
  });

  describe("fingerprintDir", () => {
    it("fingerprints every file directly inside the folder, keyed by name", async () => {
      const { root } = rootWithReferenceDir({
        "a.md": { content: "aaa", lastModified: 1000 },
        "b.md": { content: "bbb", lastModified: 2000 },
      });
      getHandle.mockResolvedValue(root);
      const out = await localProvider.fingerprintDir(ref, "/reference");
      expect(out.get("a.md")).toEqual({
        hash: await sha256Hex("aaa"),
        mtime: 1000,
      });
      expect(out.get("b.md")).toEqual({
        hash: await sha256Hex("bbb"),
        mtime: 2000,
      });
    });

    it("applies each file's own hint independently — one unchanged, one genuinely edited", async () => {
      const { root, texts } = rootWithReferenceDir({
        "a.md": { content: "still v1", lastModified: 1000 },
        "b.md": { content: "now v2", lastModified: 2500 },
      });
      getHandle.mockResolvedValue(root);
      const hints = new Map([
        ["a.md", { mtime: 1000, hash: "a-reused" }],
        ["b.md", { mtime: 2000, hash: "b-stale" }],
      ]);
      const out = await localProvider.fingerprintDir(ref, "/reference", hints);

      expect(out.get("a.md")).toEqual({ hash: "a-reused", mtime: 1000 });
      expect(texts.get("a.md")).not.toHaveBeenCalled();
      // The hint mtime of `b` (2000) does not match its real one (2500), so
      // it is re-hashed, not trusted.
      expect(out.get("b.md")).toEqual({
        hash: await sha256Hex("now v2"),
        mtime: 2500,
      });
      expect(texts.get("b.md")).toHaveBeenCalledTimes(1);
    });
  });
});

describe("listLocalProjects — the shelf's scan of the mapped root", () => {
  it("reads the real books out of the mapped root, never a stray", async () => {
    getHandle.mockResolvedValue(mappedRoot());
    const refs = await listLocalProjects();
    expect(refs.map((r) => r.name).sort()).toEqual(["ember", "once-dark"]);
  });

  it("yields nothing when the root's permission has lapsed", async () => {
    const root = mappedRoot();
    root.queryPermission.mockResolvedValue("prompt");
    getHandle.mockResolvedValue(root);
    expect(await listLocalProjects()).toEqual([]);
  });

  it("yields nothing when no root is mapped", async () => {
    getHandle.mockResolvedValue(undefined);
    expect(await listLocalProjects()).toEqual([]);
  });
});

describe("projectDir caching", () => {
  it("resolves a project's folder once across two operations on the same ref", async () => {
    const root = mappedRoot();
    getHandle.mockResolvedValue(root);
    const spy = vi.spyOn(root, "getDirectoryHandle");

    await localProvider.exists({ ...ref, key: "once-dark" }, STRUCTURE_FILE);
    await localProvider.exists({ ...ref, key: "once-dark" }, STRUCTURE_FILE);

    // One root walk in total: the second `exists()` call hits the cached
    // project directory.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("still queries permission fresh on every operation, never cached", async () => {
    const root = mappedRoot();
    getHandle.mockResolvedValue(root);

    await localProvider.exists({ ...ref, key: "once-dark" }, STRUCTURE_FILE);
    await localProvider.exists({ ...ref, key: "once-dark" }, STRUCTURE_FILE);

    expect(root.queryPermission).toHaveBeenCalledTimes(2);
  });

  it("resolves the new root's project folder after a cache reset mid-session", async () => {
    const firstRoot = mappedRoot();
    getHandle.mockResolvedValue(firstRoot);
    await localProvider.exists({ ...ref, key: "once-dark" }, STRUCTURE_FILE);

    __resetLocalRootCacheForTest();
    const secondRoot = mappedRoot();
    getHandle.mockResolvedValue(secondRoot);
    const spy = vi.spyOn(secondRoot, "getDirectoryHandle");

    await localProvider.exists({ ...ref, key: "once-dark" }, STRUCTURE_FILE);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("readFile on a book that is not under the mapped root", () => {
  it("wraps the raw NotFoundError into StorageError not-found — the card settles to gone, never unreadable", async () => {
    getHandle.mockResolvedValue(mappedRoot());
    const err = await localProvider
      .readFile({ ...ref, key: "somewhere-else" }, STRUCTURE_FILE)
      .catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("not-found");
    expect((err as StorageError).key).toBe("storage.projectGone");
  });

  it("a book under the mapped root still resolves", async () => {
    getHandle.mockResolvedValue(mappedRoot());
    // `exists` walks the same `projectDir` path the reads use, against the
    // same fake tree; the not-found wrap must not fire for a real book.
    await expect(
      localProvider.exists({ ...ref, key: "once-dark" }, STRUCTURE_FILE),
    ).resolves.toBe(true);
  });
});

describe("createLocalProject — into the mapped root, never a picker", () => {
  it("creates the folder straight into the mapped root", async () => {
    const root = mappedRoot();
    getHandle.mockResolvedValue(root);
    const created = await createLocalProject("the-precipice");
    expect(created).toEqual({
      providerId: "local",
      key: "the-precipice",
      name: "the-precipice",
      openedAt: expect.any(String),
    });
    expect(root.dirs.has("the-precipice")).toBe(true);
    expect(root.requestPermission).not.toHaveBeenCalled();
    // With a root already mapped, creation never opens the folder picker.
    expect(picker).not.toHaveBeenCalled();
  });

  it("throws with the Settings hint when no root is mapped — and never opens the picker", async () => {
    getHandle.mockResolvedValue(undefined);
    const err = await createLocalProject("the-precipice").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).key).toBe("storage.localRootRequired");
    expect(picker).not.toHaveBeenCalled();
  });

  it("re-grants a lapsed permission from inside the click", async () => {
    const root = mappedRoot();
    root.queryPermission.mockResolvedValue("prompt");
    getHandle.mockResolvedValue(root);
    const created = await createLocalProject("the-precipice");
    expect(root.requestPermission).toHaveBeenCalled();
    expect(created.key).toBe("the-precipice");
  });

  it("refuses when the writer denies the re-grant", async () => {
    const root = mappedRoot();
    root.queryPermission.mockResolvedValue("prompt");
    root.requestPermission.mockResolvedValue("denied");
    getHandle.mockResolvedValue(root);
    const err = await createLocalProject("the-precipice").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("permission");
    expect(picker).not.toHaveBeenCalled();
  });

  it("refuses a folder that already holds anything", async () => {
    getHandle.mockResolvedValue(mappedRoot());
    const err = await createLocalProject("once-dark").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).key).toBe("name.folderTaken");
  });
});

// ── The port's file operations ───────────────────────────────────────────────
//
// Pinned here, where a failure names the operation that broke, rather than
// covered by editor tests through the registry. The whole
// surface goes through `requireRoot()` (the browser gate, the stored root,
// and the live permission query) and then `projectDir`, so every row walks
// root → <key> → path as a real save does.
describe("the file operations", () => {
  /** A mapped root holding one empty project folder, ready to be written to. */
  function projectRoot(): { root: FakeDir; project: FakeDir } {
    const root = new FakeDir();
    const project = new FakeDir();
    root.dirs.set(ref.key, project);
    getHandle.mockResolvedValue(root);
    return { root, project };
  }

  it("lists what is in a folder, and never what is hidden", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "");
    project.files.set(".DS_Store", "");
    project.dirs.set("chapters", new FakeDir());
    project.dirs.set("node_modules", new FakeDir());

    const entries = await localProvider.listDir(ref, ROOT_PATH);
    expect(entries).toEqual([
      { path: "/chapters", name: "chapters", kind: "folder" },
      { path: "/one.md", name: "one.md", kind: "file" },
    ]);
  });

  // The cap is the answer to a writer who points the picker at their home
  // directory: a polite refusal beats a hung tab. It counts what it has
  // already collected, so the refusal lands on the entry past the limit.
  it("refuses a folder far too large to be a document", async () => {
    const { project } = projectRoot();
    for (let i = 0; i <= 5000; i++) project.files.set(`f${i}.md`, "");
    const err = await localProvider.listDir(ref, ROOT_PATH).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("too-large");
  });

  it("says whether a path is there, and says no rather than throwing when its folder is not", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "");
    expect(await localProvider.exists(ref, "/one.md")).toBe(true);
    expect(await localProvider.exists(ref, "/two.md")).toBe(false);
    expect(await localProvider.exists(ref, "/gone/two.md")).toBe(false);
  });

  it("reads the bytes back", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "Once dark, then light.");
    expect(await localProvider.readFile(ref, "/one.md")).toBe(
      "Once dark, then light.",
    );
  });

  // A writable left open after a failed write keeps the file locked, so the
  // next save fails as well.
  it("aborts the writable when a save fails, and still reports the failure", async () => {
    const { project } = projectRoot();
    project.writeRejects = true;

    const err = await localProvider
      .writeFile(ref, "/one.md", "prose")
      .catch((e: unknown) => e);

    expect((err as StorageError).code).toBe("io");
    expect(project.aborts).toBe(1);
  });

  it("aborts the writable when the copy behind a rename fails", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "prose");
    project.writeRejects = true;

    await expect(
      localProvider.renameFile(ref, "/one.md", "two.md"),
    ).rejects.toBeInstanceOf(StorageError);
    expect(project.aborts).toBe(1);
    // The original stays where it was.
    expect(project.files.get("one.md")).toBe("prose");
  });

  // "not-found" and not "io": a file that is not there is a fact about the
  // project, and the card that reports it says so in the writer's words.
  it("names a file that is not there as gone", async () => {
    projectRoot();
    const err = await localProvider.readFile(ref, "/one.md").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("not-found");
    expect((err as StorageError).key).toBe("storage.fileGone");
  });

  it("writes, making the folders on the way", async () => {
    const { project } = projectRoot();
    await localProvider.writeFile(ref, "/document/one.md", "Act One");
    expect(project.dirs.get("document")?.files.get("one.md")).toBe("Act One");
  });

  it("creates a folder", async () => {
    const { project } = projectRoot();
    await localProvider.createDir(ref, "/document");
    expect(project.dirs.has("document")).toBe(true);
  });

  it("removes a file", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "gone soon");
    await localProvider.removeFile(ref, "/one.md");
    expect(project.files.has("one.md")).toBe(false);
  });

  it("reports a removal that could not happen as an io failure", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "");
    vi.spyOn(project, "removeEntry").mockRejectedValue(new Error("locked"));
    const err = await localProvider.removeFile(ref, "/one.md").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("io");
  });

  it("answers a removal of an already-gone file with the port's not-found code", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "");
    vi.spyOn(project, "removeEntry").mockRejectedValue(
      new DOMException("gone", "NotFoundError"),
    );
    const err = await localProvider.removeFile(ref, "/one.md").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    // Absence is a fact the layers above classify on (the AI adapter's delete
    // tolerance, the queue's dead-letter logic), not an io failure.
    expect((err as StorageError).code).toBe("not-found");
  });

  // Chromium's `move()` is atomic and keeps the file's identity, so it is
  // tried first; everywhere else the provider copies the bytes and deletes
  // the original. Both paths are pinned because only one of them runs in any
  // given browser, and the fallback is the one with more to go wrong.
  it("renames through the platform's own move when it has one", async () => {
    const { project } = projectRoot();
    project.atomicMove = true;
    project.files.set("one.md", "Act One");
    await localProvider.renameFile(ref, "/one.md", "two.md");
    expect(project.files.get("two.md")).toBe("Act One");
    expect(project.files.has("one.md")).toBe(false);
    expect(project.writables).toBe(0);
  });

  it("renames by copying the bytes where it has none", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "Act One");
    await localProvider.renameFile(ref, "/one.md", "two.md");
    expect(project.files.get("two.md")).toBe("Act One");
    expect(project.files.has("one.md")).toBe(false);
    expect(project.writables).toBe(1);
  });

  // A `move()` that rejects leaves the original where it was, so the
  // copy-and-delete fallback runs and the rename lands.
  it("falls back to copying when the platform's move rejects", async () => {
    const { project } = projectRoot();
    project.atomicMove = true;
    project.moveRejects = true;
    project.files.set("one.md", "Act One");
    await localProvider.renameFile(ref, "/one.md", "two.md");
    expect(project.files.get("two.md")).toBe("Act One");
    expect(project.writables).toBe(1);
  });

  it("moves a file into another folder, creating it if need be", async () => {
    const { project } = projectRoot();
    project.files.set("one.md", "Act One");
    await localProvider.moveFile(ref, "/one.md", "/archive");
    expect(project.dirs.get("archive")?.files.get("one.md")).toBe("Act One");
    expect(project.files.has("one.md")).toBe(false);
  });

  it("reports a move of a file that is not there as gone, not as a failed move", async () => {
    const { project } = projectRoot();
    const err = await localProvider
      .moveFile(ref, "/missing.md", "/archive")
      .catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    // The inner failure is already a StorageError and is rethrown as itself:
    // "the file is not there" is a better answer than "the move failed".
    expect((err as StorageError).code).toBe("not-found");
    expect(project.dirs.has("archive")).toBe(true);
  });

  // A lapsed grant is the ordinary state the platform produces between
  // sessions, and every operation refuses it with `permission`, the code the
  // recovery affordance is keyed on. The query is never a
  // request: `requireRoot` asks what is true, as `canAccess` does.
  it("refuses every operation while the root grant has lapsed, without asking", async () => {
    const { root } = projectRoot();
    root.queryPermission.mockResolvedValue("prompt");
    const attempts = [
      () => localProvider.readFile(ref, "/one.md"),
      () => localProvider.writeFile(ref, "/one.md", "x"),
      () => localProvider.listDir(ref, ROOT_PATH),
      () => localProvider.exists(ref, "/one.md"),
      () => localProvider.createDir(ref, "/document"),
      () => localProvider.renameFile(ref, "/one.md", "two.md"),
      () => localProvider.moveFile(ref, "/one.md", "/archive"),
      () => localProvider.removeFile(ref, "/one.md"),
    ];
    for (const attempt of attempts) {
      const err = await attempt().catch((e) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).code).toBe("permission");
    }
    expect(root.requestPermission).not.toHaveBeenCalled();
  });

  it("says the project is gone when its folder is not under this root", async () => {
    const root = new FakeDir();
    getHandle.mockResolvedValue(root);
    const err = await localProvider.readFile(ref, "/one.md").catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("not-found");
    expect((err as StorageError).key).toBe("storage.projectGone");
  });

  it("refuses to be handed the root where a file path belongs", async () => {
    projectRoot();
    const err = await localProvider.removeFile(ref, ROOT_PATH).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("io");
  });
});

// ── Binary writes for exports ────────────────────────────────────────────────
//
// `writeBytes` is the one write on the port that is not text. Its
// risk is what text never exercises: a byte that is not valid UTF-8 (0xFF),
// or a NUL a string path would treat as a terminator, rewritten on the way to
// disk. So the bytes reach the writable as bytes and must arrive identical,
// compared against a fresh array rather than the one passed in, so a
// provider that mutated its input cannot pass by agreeing with itself.
describe("writeBytes", () => {
  function projectRoot(): { root: FakeDir; project: FakeDir } {
    const root = new FakeDir();
    const project = new FakeDir();
    root.dirs.set(ref.key, project);
    getHandle.mockResolvedValue(root);
    return { root, project };
  }

  const writeBytes = localProvider.writeBytes;
  if (!writeBytes) throw new Error("localProvider.writeBytes missing");

  it("lands every byte intact, making export/ on the way", async () => {
    const { project } = projectRoot();
    await writeBytes(
      ref,
      "/export/once-dark.pdf",
      new Uint8Array([0x25, 0x50, 0x00, 0xff, 0x0a, 0x80]),
      "application/pdf",
    );
    // The map in `FakeDir` is typed for text because every other write is;
    // the writable stored what it was handed, which here is bytes.
    const stored = project.dirs
      .get("export")
      ?.files.get("once-dark.pdf") as unknown as Uint8Array;
    expect(stored).toEqual(
      new Uint8Array([0x25, 0x50, 0x00, 0xff, 0x0a, 0x80]),
    );
  });

  it("aborts the writable when the bytes cannot be written", async () => {
    const { project } = projectRoot();
    const exportDir = new FakeDir();
    exportDir.writeRejects = true;
    project.dirs.set("export", exportDir);

    await expect(
      writeBytes(
        ref,
        "/export/once-dark.pdf",
        new Uint8Array([1]),
        "application/pdf",
      ),
    ).rejects.toBeInstanceOf(StorageError);
    expect(exportDir.aborts).toBe(1);
  });

  it("overwrites a file already at the path — the port promises create-or-overwrite", async () => {
    const { project } = projectRoot();
    const exportDir = new FakeDir();
    exportDir.files.set("once-dark.pdf", "an older export");
    project.dirs.set("export", exportDir);
    await writeBytes(
      ref,
      "/export/once-dark.pdf",
      new Uint8Array([1, 2, 3]),
      "application/pdf",
    );
    expect(
      exportDir.files.get("once-dark.pdf") as unknown as Uint8Array,
    ).toEqual(new Uint8Array([1, 2, 3]));
  });

  // The export reports each home's outcome, so the provider's failure has to
  // be the port's own error, not whatever DOMException the disk produced.
  it("reports a write the disk refused as an io failure", async () => {
    const { project } = projectRoot();
    const exportDir = new FakeDir();
    project.dirs.set("export", exportDir);
    vi.spyOn(exportDir, "getFileHandle").mockRejectedValue(
      new DOMException("full", "QuotaExceededError"),
    );
    const err = await writeBytes(
      ref,
      "/export/once-dark.pdf",
      new Uint8Array([1]),
      "application/pdf",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("io");
  });

  // The same entry point every text write goes through: a lapsed grant refuses,
  // and the refusal never becomes a prompt the writer did not ask for.
  it("refuses while the root grant has lapsed, without asking", async () => {
    const { root } = projectRoot();
    root.queryPermission.mockResolvedValue("prompt");
    const err = await writeBytes(
      ref,
      "/export/once-dark.pdf",
      new Uint8Array([1]),
      "application/pdf",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).code).toBe("permission");
    expect(root.requestPermission).not.toHaveBeenCalled();
  });
});
