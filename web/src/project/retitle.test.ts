// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRef, StorageProvider } from "../storage/types";
import type { IconName } from "../ui/icons";
import {
  defaultProperties,
  parseProperties,
  serializeProperties,
} from "./properties";

// A rename is one of the Properties window's facts: `saveProjectFacts`
// writes the title and the folder follows through `followTitle`. `retitle()`
// below drives that pair.
//
// Only what the rename reaches for is mocked. Mocking the storage index rather
// than the Drive module keeps the real Drive client and its fetch out of a
// Node run. The dispatch reads `provider.renameFolder`, never a provider id.
const renameDriveProject = vi.fn(
  async (_ref: ProjectRef, name: string) => name,
);
vi.mock("../storage", () => ({
  driveProvider: {
    id: "drive",
    renameFolder: (ref: ProjectRef, name: string) =>
      renameDriveProject(ref, name),
  },
}));

const { followTitle } = await import("./retitle");
const { readProjectFacts, saveProjectFacts } = await import("./editFacts");

/** A rename as the Properties window makes one, every other fact as stored. */
async function retitle(
  provider: StorageProvider,
  at: ProjectRef,
  title: string,
): Promise<ProjectRef> {
  const facts = await readProjectFacts(provider, at);
  return saveProjectFacts(
    provider,
    provider,
    at,
    { ...facts, title },
    facts.title,
  );
}

const ref = (providerId: string): ProjectRef => ({
  providerId,
  key: "k",
  name: "once-dark",
  openedAt: "2026-07-28T10:00:00.000Z",
});

/** Just enough provider to read and write one file. */
function fakeProvider(id: string, seed: Record<string, string>) {
  const files = new Map(Object.entries(seed));
  const provider = {
    id,
    kind: "device" as const,
    label: () => id,
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
    writeFile: async (_r: ProjectRef, p: string, c: string) =>
      void files.set(p, c),
    createDir: async () => {},
    renameFile: async () => {},
    moveFile: async () => {},
    removeFile: async () => {},
    fingerprintFile: async () => ({ hash: "fake" }),
    fingerprintDir: async () => new Map(),
    // Only the Drive fake carries the folder-rename capability, as in the
    // port: the dispatch reads the capability, not the id.
    ...(id === "drive"
      ? {
          renameFolder: (r: ProjectRef, name: string) =>
            renameDriveProject(r, name),
        }
      : {}),
  } satisfies StorageProvider;
  return Object.assign(provider, { __files: files });
}

const withProject = (id: string, title = "Once Dark") =>
  fakeProvider(id, {
    "/document-properties.json": serializeProperties(defaultProperties(title)),
  });

const titleIn = (p: ReturnType<typeof fakeProvider>) =>
  parseProperties(
    p.__files.get("/document-properties.json") ?? null,
    "fallback",
  ).document.title;

// `withProject` always writes this file, so its absence is a fixture bug, not
// a case the parse must survive. `titleIn` tolerates absence through the
// fallback; these tests compare raw values and need the file.
const propertiesFile = (p: ReturnType<typeof fakeProvider>) => {
  const file = p.__files.get("/document-properties.json");
  if (file === undefined)
    throw new Error("document-properties.json not seeded");
  return file;
};

describe("renaming a project", () => {
  beforeEach(() => renameDriveProject.mockClear());

  it("writes the new title into the properties file", async () => {
    const provider = withProject("local");

    await retitle(provider, ref("local"), "Salt and Iron");

    expect(titleIn(provider)).toBe("Salt and Iron");
  });

  it("keeps everything else the properties file said", async () => {
    const provider = withProject("local");
    const before = parseProperties(propertiesFile(provider), "x");

    await retitle(provider, ref("local"), "Salt and Iron");
    const after = parseProperties(propertiesFile(provider), "x");

    expect(after.document.type).toBe(before.document.type);
    expect(after.document.language).toBe(before.document.language);
    expect(after.document.createdAt).toBe(before.document.createdAt);
    expect(after.stats).toEqual(before.stats);
  });

  // The File System Access API cannot rename a directory outside OPFS, so the
  // device provider offers no `renameFolder`, and the title is the whole
  // rename.
  it("leaves a folder on this device where it was", async () => {
    const provider = withProject("local");

    const after = await retitle(provider, ref("local"), "Salt and Iron");

    expect(renameDriveProject).not.toHaveBeenCalled();
    expect(after.name).toBe("once-dark");
  });

  it("renames the folder too on Drive, and reports the new ref", async () => {
    const provider = withProject("drive");

    const after = await retitle(provider, ref("drive"), "Salt and Iron");

    expect(renameDriveProject).toHaveBeenCalledWith(
      expect.anything(),
      "salt-and-iron",
    );
    expect(after.name).toBe("salt-and-iron");
    expect(titleIn(provider)).toBe("Salt and Iron");
  });

  it("leaves a Drive folder alone when it already carries the title's name", async () => {
    const provider = withProject("drive");

    // The ref's folder is `once-dark`, so a title that spells the same folder
    // renames the title alone.
    const after = await retitle(provider, ref("drive"), "Once Dark");

    expect(renameDriveProject).not.toHaveBeenCalled();
    expect(after).toEqual(ref("drive"));
  });

  // The title is the writer's; the folder name is what a disk can hold.
  it("derives the Drive folder name rather than using the title verbatim", async () => {
    const provider = withProject("drive");

    await retitle(provider, ref("drive"), "L'Isola: Parte Prima");

    expect(renameDriveProject).toHaveBeenCalledWith(
      expect.anything(),
      "lisola-parte-prima",
    );
  });

  // The file is written before the folder is touched. A project whose title
  // changed and whose folder did not still opens; a folder renamed for a
  // write that never landed is a change nobody asked for.
  it("does not rename the folder when the properties file cannot be written", async () => {
    const provider = withProject("drive");
    provider.writeFile = async () => {
      throw new Error("disk full");
    };

    await expect(
      retitle(provider, ref("drive"), "Salt and Iron"),
    ).rejects.toThrow();
    expect(renameDriveProject).not.toHaveBeenCalled();
  });

  it("never asks Drive for a folder a title cannot name", async () => {
    const after = await followTitle(withProject("drive"), ref("drive"), "???");
    expect(renameDriveProject).not.toHaveBeenCalled();
    expect(after).toEqual(ref("drive"));
  });

  it("can be undone by calling it again with the old title", async () => {
    const provider = withProject("local", "Once Dark");

    await retitle(provider, ref("local"), "Salt and Iron");
    await retitle(provider, ref("local"), "Once Dark");

    expect(titleIn(provider)).toBe("Once Dark");
  });
});
