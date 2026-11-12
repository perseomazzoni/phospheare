// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { renameReference } from "./referenceRename";
import type { ProjectRef, StorageProvider } from "../../storage";

const REF: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "",
};

// A rename lands on a folder the panel listed some time ago. The fake renames
// the way every backend does, onto whatever is there, so an overwrite shows
// as lost text.
function folder(entries: Record<string, string>) {
  const files = new Map(Object.entries(entries));
  const dir = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const p = {
    exists: vi.fn(async (_ref: ProjectRef, path: string) => files.has(path)),
    renameFile: vi.fn(async (_ref: ProjectRef, from: string, name: string) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`missing ${from}`);
      files.delete(from);
      files.set(`${dir(from)}/${name}`, text);
    }),
  } as unknown as StorageProvider;
  return { p, files };
}

describe("renameReference — a character and its arc", () => {
  it("renames the pair together", async () => {
    const { p, files } = folder({
      "/reference/character--Maren.md": "sheet",
      "/reference/arc--Maren.md": "arc",
    });
    expect(await renameReference(p, REF, "character--Maren.md", "Ilse")).toBe(
      "character--Ilse.md",
    );
    expect(Object.fromEntries(files)).toEqual({
      "/reference/character--Ilse.md": "sheet",
      "/reference/arc--Ilse.md": "arc",
    });
  });

  it("refuses when the arc's new name is taken, and touches nothing", async () => {
    // An arc already named for the new stem belongs to no character; renaming
    // the pair onto it would replace its text.
    const { p, files } = folder({
      "/reference/character--Maren.md": "sheet",
      "/reference/arc--Maren.md": "arc",
      "/reference/arc--Ilse.md": "someone else's arc",
    });
    expect(
      await renameReference(p, REF, "character--Maren.md", "Ilse"),
    ).toBeNull();
    expect(Object.fromEntries(files)).toEqual({
      "/reference/character--Maren.md": "sheet",
      "/reference/arc--Maren.md": "arc",
      "/reference/arc--Ilse.md": "someone else's arc",
    });
  });

  it("renames a character with no arc, whatever arc names exist", async () => {
    const { p, files } = folder({
      "/reference/character--Maren.md": "sheet",
      "/reference/arc--Ilse.md": "someone else's arc",
    });
    expect(await renameReference(p, REF, "character--Maren.md", "Ilse")).toBe(
      "character--Ilse.md",
    );
    expect(files.get("/reference/arc--Ilse.md")).toBe("someone else's arc");
    expect(files.get("/reference/character--Ilse.md")).toBe("sheet");
  });
});
