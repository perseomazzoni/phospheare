// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  ROOT_PATH,
  parentPath,
  type DirEntry,
  type ProjectRef,
  type StorageProvider,
} from "../storage";
import type { IconName } from "../ui/icons";
import { copyProject } from "./transfer";

// A provider over a Map, so the copy runs in Node. The real ones need a folder
// picker or a network, and neither is under test here.
function fakeProvider(
  id: string,
  seed: Record<string, string> = {},
): StorageProvider {
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
      const under = (p: string) => parentPath(p) === path;
      for (const file of files.keys()) {
        if (under(file)) {
          // A path always ends in a name segment, so `pop()` is defined.
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
        // The folder one level below `path` that this entry sits inside.
        let at = parentPath(file);
        while (at !== ROOT_PATH && parentPath(at) !== path) at = parentPath(at);
        if (at !== ROOT_PATH && parentPath(at) === path) {
          // A folder path always ends in a name segment too, so `pop()` is
          // defined here.
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
    writeFile: async (_r: ProjectRef, p: string, content: string) =>
      void files.set(p, content),
    createDir: async (_r: ProjectRef, p: string) => void dirs.add(p),
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async (_r: ProjectRef, p: string) => void files.delete(p),
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
  } satisfies StorageProvider;

  return Object.assign(provider, { __files: files, __dirs: dirs });
}

const peek = (p: StorageProvider) =>
  (p as unknown as { __files: Map<string, string> }).__files;
const peekDirs = (p: StorageProvider) =>
  (p as unknown as { __dirs: Set<string> }).__dirs;

const ref = (providerId: string): ProjectRef => ({
  providerId,
  key: "k",
  name: "once-dark",
  openedAt: "2026-07-28T10:00:00.000Z",
});

const PROJECT = {
  "/document-properties.json": "{}",
  "/document-structure.yaml": "version: 1",
  "/document/part--act-one.md": "one",
  "/document/section--opening.md": "the house had been empty",
  "/reference/notes.md": "notes",
};

const sides = (seed: Record<string, string> = PROJECT) => {
  const from = fakeProvider("local", seed);
  const to = fakeProvider("drive");
  return {
    from: { provider: from, ref: ref("local") },
    to: { provider: to, ref: ref("drive") },
  };
};

describe("copyProject", () => {
  it("copies every file, content and all", async () => {
    const { from, to } = sides();
    const result = await copyProject(from, to);

    expect(result).toEqual({ copied: 5, total: 5, cancelled: false });
    expect(Object.fromEntries(peek(to.provider))).toEqual(PROJECT);
  });

  it("makes the folders before the files that go in them", async () => {
    const { from, to } = sides();
    await copyProject(from, to);
    expect([...peekDirs(to.provider)].sort()).toEqual([
      "/document",
      "/reference",
    ]);
  });

  it("counts the whole job before it starts, so progress is never a guess", async () => {
    const { from, to } = sides();
    const seen: { done: number; total: number; path: string }[] = [];
    await copyProject(from, to, { onProgress: (p) => seen.push(p) });

    expect(seen).toHaveLength(5);
    expect(seen.every((p) => p.total === 5)).toBe(true);
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2, 3, 4]);
  });

  // `export/` holds binary files, and this copy reads every file as text, so
  // a PDF would arrive as garbage. Exports are also the one thing the app can
  // make again, so the copy passes the folder by.
  it("passes the book's export folder by", async () => {
    const { from, to } = sides({
      ...PROJECT,
      "/export/Once Dark 2026-10-01 14-32-05-123.pdf": "%PDF-binary",
    });
    const result = await copyProject(from, to);

    expect(result).toEqual({ copied: 5, total: 5, cancelled: false });
    expect(Object.fromEntries(peek(to.provider))).toEqual(PROJECT);
    expect(peekDirs(to.provider).has("/export")).toBe(false);
  });

  it("leaves the original completely alone", async () => {
    const { from, to } = sides();
    await copyProject(from, to);
    expect(Object.fromEntries(peek(from.provider))).toEqual(PROJECT);
  });

  describe("cancelling", () => {
    it("stops, and says how far it got", async () => {
      const { from, to } = sides();
      const control = new AbortController();
      const result = await copyProject(from, to, {
        onProgress: (p) => {
          if (p.done === 2) control.abort();
        },
        signal: control.signal,
      });

      expect(result.cancelled).toBe(true);
      expect(result.copied).toBe(2);
      expect(result.total).toBe(5);
    });

    // The app never destroys the writer's files. Half a project they can see
    // and finish copying is recoverable; a tidy-up that erased it would not
    // be.
    it("leaves what it already wrote in place", async () => {
      const { from, to } = sides();
      const control = new AbortController();
      await copyProject(from, to, {
        onProgress: (p) => {
          if (p.done === 2) control.abort();
        },
        signal: control.signal,
      });

      expect(peek(to.provider).size).toBe(2);
    });

    // The dialog names a file and the writer hits Cancel: that file is not
    // written, so the dialog's last line stays true.
    it("does not write the file it had just named", async () => {
      const { from, to } = sides();
      const control = new AbortController();
      await copyProject(from, to, {
        onProgress: () => control.abort(),
        signal: control.signal,
      });

      expect(peek(to.provider).size).toBe(0);
    });

    it("writes whole files or none — never a partial one", async () => {
      const { from, to } = sides();
      const control = new AbortController();
      await copyProject(from, to, {
        onProgress: (p) => {
          if (p.done === 2) control.abort();
        },
        signal: control.signal,
      });

      for (const [path, content] of peek(to.provider)) {
        expect(content).toBe(peek(from.provider).get(path));
      }
    });

    it("does nothing at all when it is aborted before it starts", async () => {
      const { from, to } = sides();
      const control = new AbortController();
      control.abort();
      const result = await copyProject(from, to, { signal: control.signal });

      expect(result).toEqual({ copied: 0, total: 5, cancelled: true });
      expect(peek(to.provider).size).toBe(0);
    });
  });

  it("handles an empty project without inventing a total", async () => {
    const { from, to } = sides({});
    expect(await copyProject(from, to)).toEqual({
      copied: 0,
      total: 0,
      cancelled: false,
    });
  });
});
