// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { listLocalProjectsIn, listProjectsInFolder } from "./projectScan";
import { STRUCTURE_FILE } from "../project/naming";
import {
  MAX_DIR_ENTRIES,
  baseName,
  type DirEntry,
  type ProjectRef,
  type StorageProvider,
} from "./types";

// The scan is provider-agnostic: one primitive, two backends. A small
// in-memory provider stands in for both: Drive identifies folders by id
// (`fileIdOf` resolves), local disk by name (no `fileIdOf`). The folder tree
// is a Map of path → kind, with `/<name>/document-structure.yaml` marking a
// project; the scan's root is the projects folder itself (`APP_DIR` on
// Drive, the picked root on disk).

const files = new Map<string, "folder" | "file">();

function fakeProvider(withIds: boolean): StorageProvider & {
  fileIdOf?: (ref: ProjectRef, path: string) => Promise<string | null>;
} {
  const provider: StorageProvider & {
    fileIdOf?: (ref: ProjectRef, path: string) => Promise<string | null>;
  } = {
    id: withIds ? "drive" : "local",
    kind: "device" as const,
    label: () => (withIds ? "Drive" : "Local"),
    icon: "folder" as never,
    isAvailable: () => true,
    reopenProject: async () => true,
    canAccess: async () => "granted" as const,
    async listDir(_ref: ProjectRef, path: string): Promise<DirEntry[]> {
      const prefix = path === "/" ? "/" : `${path}/`;
      const seen = new Map<string, DirEntry>();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        const name = slash === -1 ? rest : rest.slice(0, slash);
        if (seen.has(name)) continue;
        const kind = files.get(`${prefix}${name}`) ?? "folder";
        seen.set(name, {
          path: `${path === "/" ? "" : path}/${name}`,
          name,
          kind,
        });
      }
      return [...seen.values()];
    },
    async exists(ref: ProjectRef, path: string): Promise<boolean> {
      // As in the real providers, the path is project-relative and resolved
      // against the project's own folder. For Drive the key is the folder's
      // id, so the fake strips its own id prefix back to the name.
      const name = withIds ? ref.key.replace(/^id-of-/, "") : ref.key;
      return files.has(`/${name}${path}`);
    },
    readFile: async () => "",
    writeFile: async () => {},
    createDir: async () => {},
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async () => {},
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
  };
  if (withIds) {
    provider.fileIdOf = async (_ref: ProjectRef, path: string) =>
      `id-of-${path.slice(path.lastIndexOf("/") + 1)}`;
  }
  return provider;
}

function reset(): void {
  files.clear();
}

function project(name: string): void {
  files.set(`/${name}/document-structure.yaml`, "file");
}

describe("listProjectsInFolder", () => {
  it("finds every folder under the dir that holds a structure manifest", async () => {
    reset();
    project("once-dark");
    project("ember");
    files.set("/not-a-project/readme.txt", "file");
    files.set("/stray-file.yaml", "file");

    const refs = await listProjectsInFolder(
      fakeProvider(false),
      { providerId: "local", key: "root", name: "", openedAt: "" },
      "/",
    );

    expect(refs.map((r) => r.name).sort()).toEqual(["ember", "once-dark"]);
  });

  it("keys Drive folders by their id, local folders by their name", async () => {
    reset();
    project("once-dark");

    const drive = await listProjectsInFolder(
      fakeProvider(true),
      { providerId: "drive", key: "root-id", name: "", openedAt: "" },
      "/",
    );
    expect(drive[0].key).toBe("id-of-once-dark");
    expect(drive[0].providerId).toBe("drive");

    const local = await listProjectsInFolder(
      fakeProvider(false),
      { providerId: "local", key: "root", name: "", openedAt: "" },
      "/",
    );
    expect(local[0].key).toBe("once-dark");
    expect(local[0].providerId).toBe("local");
  });

  it("returns nothing for a folder that cannot be listed — never throws", async () => {
    reset();
    files.clear();
    expect(
      await listProjectsInFolder(
        fakeProvider(false),
        { providerId: "local", key: "root", name: "", openedAt: "" },
        "/",
      ),
    ).toEqual([]);
  });

  it("skips files that are not folders", async () => {
    reset();
    files.set("/notes.md", "file");
    files.set("/notes.md/document-structure.yaml", "file");
    expect(
      await listProjectsInFolder(
        fakeProvider(false),
        { providerId: "local", key: "root", name: "", openedAt: "" },
        "/",
      ),
    ).toEqual([]);
  });
});

// The local half of the scan walks a real handle tree, with no provider port
// and no sentinel ref, as `projectScan.ts` states. The handle shape it needs
// is small: `getDirectoryHandle` by name, `entries()`, and the probe's
// `getFileHandle`.

class FakeHandle {
  kind = "directory" as const;
  dirs = new Map<string, FakeHandle>();
  files = new Set<string>();

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeHandle> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (!opts?.create) throw new DOMException("Not found", "NotFoundError");
    const child = new FakeHandle();
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
    if (this.files.has(name)) return {} as FileSystemFileHandle;
    if (!opts?.create) throw new DOMException("Not found", "NotFoundError");
    this.files.add(name);
    return {} as FileSystemFileHandle;
  }

  async *entries(): AsyncGenerator<[string, FakeHandle | { kind: "file" }]> {
    for (const [name, dir] of this.dirs) yield [name, dir];
    for (const name of this.files) yield [name, { kind: "file" as const }];
  }
}

function projectFolder(files: string[] = []): FakeHandle {
  const dir = new FakeHandle();
  for (const file of files) dir.files.add(file);
  return dir;
}

// The manifest lives on disk under its bare name; the port's `STRUCTURE_FILE`
// constant is the path form ("/document-structure.yaml"). Fixtures hold what
// a real directory would hold.
const MANIFEST = baseName(STRUCTURE_FILE);

describe("listLocalProjectsIn — the handle-based local scan", () => {
  it("returns the root's children that hold a structure manifest", async () => {
    const root = new FakeHandle();
    root.dirs.set("once-dark", projectFolder([MANIFEST]));
    root.dirs.set("ember", projectFolder([MANIFEST]));
    root.dirs.set("not-a-project", projectFolder(["readme.txt"]));
    root.files.add("notes.md");

    const refs = await listLocalProjectsIn(
      root as unknown as FileSystemDirectoryHandle,
    );

    expect(refs.map((r) => r.name).sort()).toEqual(["ember", "once-dark"]);
    // Local folders are keyed by their own name: what a file manager shows is
    // what the card points at.
    expect(refs[0].key).toBe(refs[0].name);
    expect(refs[0].providerId).toBe("local");
  });

  it("returns nothing when the root holds no project folder", async () => {
    const root = new FakeHandle();
    root.dirs.set("recipes", projectFolder(["readme.txt"]));
    root.files.add("notes.md");
    expect(
      await listLocalProjectsIn(root as unknown as FileSystemDirectoryHandle),
    ).toEqual([]);
  });

  it("refuses a root holding more entries than the shared ceiling", async () => {
    const root = new FakeHandle();
    for (let i = 0; i <= MAX_DIR_ENTRIES; i++) root.files.add(`f${i}.md`);
    await expect(
      listLocalProjectsIn(root as unknown as FileSystemDirectoryHandle),
    ).rejects.toMatchObject({ code: "too-large" });
  });
});
