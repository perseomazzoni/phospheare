// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type { ProjectRef, StorageProvider } from "../storage/types";
import type { IconName } from "../ui/icons";
import {
  FACTS_UNREADABLE,
  readProjectFacts,
  saveProjectFacts,
} from "./editFacts";
import type { ProjectFacts } from "./facts";
import {
  defaultProperties,
  parseProperties,
  serializeProperties,
} from "./properties";

// The Properties window's read and write. Two providers: `storage` is
// where the file goes, the working copy for a book with a remote, and
// `folders` is the bare backend, the only one that can rename a folder. A
// device backend has no `renameFolder`, so its folder stays.

const ref: ProjectRef = {
  providerId: "drive",
  key: "k",
  name: "once-dark",
  openedAt: "2026-07-28T10:00:00.000Z",
};

const PROPS = "/document-properties.json";

/** Just enough provider to hold one book's files. */
function holder(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const provider = {
    id: "holder",
    kind: "device" as const,
    label: () => "holder",
    icon: "mark" as IconName,
    isAvailable: () => true,
    reopenProject: async () => true,
    canAccess: async () => "granted" as const,
    listDir: async () => [],
    exists: async (_r: ProjectRef, p: string) => files.has(p),
    readFile: async (_r: ProjectRef, p: string) => {
      const found = files.get(p);
      if (found === undefined) throw new Error(`no such file ${p}`);
      return found;
    },
    writeFile: vi.fn(async (_r: ProjectRef, p: string, c: string) => {
      files.set(p, c);
    }),
    createDir: async () => {},
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async () => {},
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
  } satisfies StorageProvider;
  return Object.assign(provider, { files });
}

const book = (title = "Once Dark") => {
  const props = defaultProperties(title);
  props.stats.words = 1200;
  return holder({ [PROPS]: serializeProperties(props) });
};

/** A backend that can rename a folder, the way Drive does. */
const renamingBackend = () => {
  const renameFolder = vi.fn(async (_r: ProjectRef, name: string) => name);
  return Object.assign(holder(), { renameFolder });
};

const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  title: "Once Dark",
  author: "",
  type: "Novel",
  goal: 80000,
  language: "en",
  structure: null,
  genres: [],
  ageCategory: null,
  tropes: [],
  ...over,
});

const stored = (p: ReturnType<typeof holder>) =>
  parseProperties(p.files.get(PROPS) ?? null, "fallback");

describe("readProjectFacts", () => {
  it("reads the book's facts", async () => {
    const storage = book();
    const read = await readProjectFacts(storage, ref);
    expect(read.title).toBe("Once Dark");
    expect(read.type).toBe("Novel");
  });

  it("refuses a folder whose properties file is not a book's", async () => {
    const storage = holder({ [PROPS]: "{ not json" });
    await expect(readProjectFacts(storage, ref)).rejects.toThrow(
      FACTS_UNREADABLE,
    );
  });
});

describe("saveProjectFacts", () => {
  it("writes every fact through the storage, and keeps the rest of the file", async () => {
    const storage = book();
    const next = facts({
      author: "M. Rossi",
      type: "Novella",
      goal: 30000,
      language: "it",
      structure: "threeact",
      genres: ["mystery"],
      ageCategory: "adult",
      tropes: ["locked room"],
    });

    const result = await saveProjectFacts(
      storage,
      holder(),
      ref,
      next,
      "Once Dark",
    );

    const after = stored(storage);
    expect(after.document).toMatchObject(next);
    expect(after.stats.words).toBe(1200);
    // The title did not change, so the folder was not asked about.
    expect(result).toBe(ref);
  });

  it("lets the folder follow a new title where the backend can rename one", async () => {
    const storage = book();
    const folders = renamingBackend();

    const result = await saveProjectFacts(
      storage,
      folders,
      ref,
      facts({ title: "Salt and Iron" }),
      "Once Dark",
    );

    expect(stored(storage).document.title).toBe("Salt and Iron");
    expect(folders.renameFolder).toHaveBeenCalledWith(ref, "salt-and-iron");
    expect(result).toEqual({ ...ref, name: "salt-and-iron" });
    // The file went through the storage, never the bare backend.
    expect(folders.writeFile).not.toHaveBeenCalled();
  });

  it("leaves a device folder where it is: only the title changes", async () => {
    const storage = book();

    const result = await saveProjectFacts(
      storage,
      holder(),
      ref,
      facts({ title: "Salt and Iron" }),
      "Once Dark",
    );

    expect(stored(storage).document.title).toBe("Salt and Iron");
    expect(result).toBe(ref);
  });

  it("renames no folder when the properties file cannot be written", async () => {
    const storage = book();
    storage.writeFile.mockRejectedValueOnce(new Error("disk full"));
    const folders = renamingBackend();

    await expect(
      saveProjectFacts(
        storage,
        folders,
        ref,
        facts({ title: "Salt" }),
        "Once Dark",
      ),
    ).rejects.toThrow("disk full");
    expect(folders.renameFolder).not.toHaveBeenCalled();
  });

  // The Properties window stays open on a failed save so the writer can press
  // Save again. When the file was written and the folder rename failed, the
  // second Save reads a file whose title already matches and still lets the
  // folder follow, as the window promised "Folder becomes …" both times.
  it("a retry after a failed folder rename still renames the folder", async () => {
    const storage = book();
    const folders = renamingBackend();
    folders.renameFolder.mockRejectedValueOnce(new Error("network"));
    const next = facts({ title: "Salt and Iron" });

    // The window still holds the title it opened on: both Saves measure the
    // change against it.
    await expect(
      saveProjectFacts(storage, folders, ref, next, "Once Dark"),
    ).rejects.toThrow("network");
    const result = await saveProjectFacts(
      storage,
      folders,
      ref,
      next,
      "Once Dark",
    );

    expect(folders.renameFolder).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ...ref, name: "salt-and-iron" });
  });

  it("refuses to write over a folder that is not a book", async () => {
    const storage = holder({ [PROPS]: "[]" });
    await expect(
      saveProjectFacts(storage, holder(), ref, facts(), "Once Dark"),
    ).rejects.toThrow(FACTS_UNREADABLE);
    expect(storage.writeFile).not.toHaveBeenCalled();
  });
});
