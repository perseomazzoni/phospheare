// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  ROOT_PATH,
  parentPath,
  type DirEntry,
  type ProjectRef,
  type StorageProvider,
} from "../storage/types";
import type { IconName } from "../ui/icons";
import {
  defaultProperties,
  parseProperties,
  serializeProperties,
} from "./properties";

// The storage index is mocked, as in `retitle.test.ts`: the folder-follows
// step (`followTitle`) sits beside the Drive client, which a Node run must
// not load. Both sides here are local, so no folder is renamed.
vi.mock("../storage", async () => ({
  ...(await vi.importActual<typeof import("../storage/types")>(
    "../storage/types",
  )),
  driveProvider: { id: "drive" },
  renameDriveProject: vi.fn(),
}));

const { duplicateProject } = await import("./duplicate");

/** A provider over a Map, the shape `transfer.test.ts` drives the copy with. */
function fakeProvider(id: string, seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const dirs = new Set<string>();

  const provider = {
    id,
    kind: "device" as const,
    label: () => id,
    icon: "mark" as IconName,
    isAvailable: () => true,
    reopenProject: async () => true,
    canAccess: async () => "granted" as const,

    async listDir(_ref: ProjectRef, path: string): Promise<DirEntry[]> {
      const out = new Map<string, DirEntry>();
      for (const file of files.keys()) {
        if (parentPath(file) === path) {
          // A path always ends in a name segment, so `pop()` cannot return
          // undefined; the throw is for the compiler.
          const name = file.split("/").pop();
          if (name === undefined) throw new Error(`no name for ${file}`);
          out.set(file, {
            path: file,
            name,
            kind: "file",
          });
        }
      }
      for (const file of [...files.keys(), ...dirs]) {
        let at = parentPath(file);
        while (at !== ROOT_PATH && parentPath(at) !== path) at = parentPath(at);
        if (at !== ROOT_PATH && parentPath(at) === path) {
          // A folder path always ends in a name segment too, so `pop()` cannot
          // be undefined here.
          const name = at.split("/").pop();
          if (name === undefined) throw new Error(`no name for ${at}`);
          out.set(at, { path: at, name, kind: "folder" });
        }
      }
      return [...out.values()];
    },

    exists: async (_r: ProjectRef, p: string) => files.has(p),
    readFile: async (_r: ProjectRef, p: string) => {
      const found = files.get(p);
      if (found === undefined) throw new Error(`no such file ${p}`);
      return found;
    },
    writeFile: async (_r: ProjectRef, p: string, c: string) =>
      void files.set(p, c),
    createDir: async (_r: ProjectRef, p: string) => void dirs.add(p),
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async (_r: ProjectRef, p: string) => void files.delete(p),
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
  } satisfies StorageProvider;

  return Object.assign(provider, { __files: files });
}

const ref = (key: string): ProjectRef => ({
  providerId: "local",
  key,
  name: key,
  openedAt: "2026-07-28T10:00:00.000Z",
});

const project = (title = "Once Dark") => ({
  "/document-properties.json": serializeProperties(defaultProperties(title)),
  "/document-structure.yaml": "version: 1",
  "/document/part--act-one.md": "one",
  "/document/section--opening.md": "the house had been empty",
  "/reference/notes.md": "notes",
});

const syncedProject = (
  title = "Once Dark",
  remoteTarget = "drive-folder-1",
) => ({
  ...project(title),
  "/document-properties.json": serializeProperties({
    ...defaultProperties(title),
    sync: { remote: { providerId: "drive", key: remoteTarget } },
  }),
});

const sides = (seed = project()) => ({
  from: { provider: fakeProvider("local", seed), ref: ref("source") },
  to: { provider: fakeProvider("local"), ref: ref("copy") },
});

const titleIn = (p: ReturnType<typeof fakeProvider>) =>
  parseProperties(
    p.__files.get("/document-properties.json") ?? null,
    "fallback",
  ).document.title;

describe("duplicating a project", () => {
  it("copies every file across", async () => {
    const { from, to } = sides();

    const result = await duplicateProject(from, to, "Once Dark (copy)");

    expect(result).toMatchObject({ copied: 5, total: 5, cancelled: false });
    expect([...to.provider.__files.keys()].sort()).toEqual(
      [...from.provider.__files.keys()].sort(),
    );
  });

  // Without this the shelf shows two cards with the same name.
  it("gives the copy its own title", async () => {
    const { from, to } = sides();

    await duplicateProject(from, to, "Once Dark (copy)");

    expect(titleIn(to.provider)).toBe("Once Dark (copy)");
  });

  it("leaves the original alone", async () => {
    const { from, to } = sides();

    await duplicateProject(from, to, "Once Dark (copy)");

    expect(titleIn(from.provider)).toBe("Once Dark");
  });

  it("copies the prose, not just the shape", async () => {
    const { from, to } = sides();

    await duplicateProject(from, to, "A copy");

    expect(to.provider.__files.get("/document/section--opening.md")).toBe(
      "the house had been empty",
    );
  });

  it("reports progress a dialog can count with", async () => {
    const { from, to } = sides();
    const seen: number[] = [];

    await duplicateProject(from, to, "A copy", {
      onProgress: (p) => seen.push(p.total),
    });

    expect(seen).toEqual([5, 5, 5, 5, 5]);
  });

  // The uuid is the project's identity everywhere, so a duplicate
  // that kept it would be a second book at the first one's address: two rows
  // on one shelf answering one `/app/project/<id>` link. `copyProject` copies
  // `document-properties.json` byte for byte, so the duplicate mints a new
  // one.
  it("mints the copy an identity of its own", async () => {
    const { from, to } = sides(syncedProject());

    await duplicateProject(from, to, "Once Dark (copy)");

    const before = parseProperties(
      from.provider.__files.get("/document-properties.json") ?? null,
      "fallback",
    ).document.id;
    const after = parseProperties(
      to.provider.__files.get("/document-properties.json") ?? null,
      "fallback",
    ).document.id;

    expect(after).not.toBe(before);
    // A real one, not an empty string or a placeholder: a URL and a shelf row
    // are keyed on it.
    expect(after).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("leaves the original's identity alone", async () => {
    // The original keeps its uuid, so every link and bookmark to it still
    // lands on it.
    const { from, to } = sides(syncedProject());
    const before = parseProperties(
      from.provider.__files.get("/document-properties.json") ?? null,
      "fallback",
    ).document.id;

    await duplicateProject(from, to, "Once Dark (copy)");

    expect(
      parseProperties(
        from.provider.__files.get("/document-properties.json") ?? null,
        "fallback",
      ).document.id,
    ).toBe(before);
  });

  it("gives two duplicates of one project two identities", async () => {
    // Duplicating twice is the ordinary way to end up with three books, and a
    // mint once per source rather than once per copy would put the two copies
    // at one address.
    const source = syncedProject();
    const first = sides(source);
    await duplicateProject(first.from, first.to, "Once Dark (copy)");
    const second = sides(source);
    await duplicateProject(second.from, second.to, "Once Dark (copy 2)");

    const idOf = (side: { provider: { __files: Map<string, string> } }) =>
      parseProperties(
        side.provider.__files.get("/document-properties.json") ?? null,
        "fallback",
      ).document.id;

    expect(idOf(first.to)).not.toBe(idOf(second.to));
  });

  // A duplicate always starts Local-only, never inheriting the Drive pairing:
  // `copyProject` copies `document-properties.json` byte for byte, and the
  // `sync` field would otherwise point a new folder at the original's Drive
  // folder.
  it("does not inherit the original's Drive pairing", async () => {
    const { from, to } = sides(syncedProject());

    await duplicateProject(from, to, "Once Dark (copy)");

    expect(
      parseProperties(
        to.provider.__files.get("/document-properties.json") ?? null,
        "fallback",
      ).sync,
    ).toBeNull();
  });

  it("leaves the original's own pairing untouched", async () => {
    const { from, to } = sides(syncedProject());

    await duplicateProject(from, to, "Once Dark (copy)");

    expect(
      parseProperties(
        from.provider.__files.get("/document-properties.json") ?? null,
        "fallback",
      ).sync,
    ).toEqual({ remote: { providerId: "drive", key: "drive-folder-1" } });
  });

  describe("when the writer cancels", () => {
    // The destination is a fresh folder, so everything in it came from this
    // copy. A half copy left there would be a book nobody asked for.
    it("removes what already landed, and leaves the original alone", async () => {
      const { from, to } = sides();
      const before = new Map(from.provider.__files);
      const control = new AbortController();

      const result = await duplicateProject(from, to, "A copy", {
        signal: control.signal,
        onProgress: (p) => {
          if (p.done === 2) control.abort();
        },
      });

      expect(result.cancelled).toBe(true);
      expect(to.provider.__files.size).toBe(0);
      expect(from.provider.__files).toEqual(before);
    });
  });

  // A copy that stops partway on a failure keeps whatever landed. Its
  // properties must already name a book of its own, or a later sweep finds a
  // second folder claiming the original's uuid.
  it("writes the new identity with the first properties write, before the rest of the copy", async () => {
    const source = syncedProject();
    const { from, to } = sides(source);
    const writeFile = to.provider.writeFile;
    to.provider.writeFile = async (r, p, c) => {
      if (p === "/document/section--opening.md") throw new Error("disk full");
      return writeFile(r, p, c);
    };

    await expect(
      duplicateProject(from, to, "Once Dark (copy)"),
    ).rejects.toThrow("disk full");

    const original = parseProperties(
      source["/document-properties.json"],
      "fallback",
    );
    const landed = parseProperties(
      to.provider.__files.get("/document-properties.json") ?? null,
      "fallback",
    );
    expect(landed.document.id).not.toBe(original.document.id);
    expect(landed.document.title).toBe("Once Dark (copy)");
    expect(landed.sync).toBeNull();
  });
});
