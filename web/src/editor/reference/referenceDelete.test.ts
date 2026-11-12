// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import {
  deleteReference,
  isDerivedReference,
  restoreReference,
} from "./referenceDelete";
import type { ProjectRef, StorageProvider } from "../../storage";

const REF: ProjectRef = {
  providerId: "memory",
  key: "demo",
  name: "Demo",
  openedAt: "",
};

function provider(overrides: Partial<StorageProvider> = {}): StorageProvider {
  return {
    exists: vi.fn(async () => false),
    moveFile: vi.fn(async () => undefined),
    removeFile: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StorageProvider;
}

/** An `exists` reading: the pair is in the bin and `reference/` is clear. */
const inBin = (path: string) => path.startsWith("/recyclebin/");

// The one delete seam for reference documents, pinned at its own level: which
// kind is binned and which is removed, the failure shape every caller
// reports, and the character/arc pair that travels together in
// both directions.

describe("deleteReference", () => {
  it("bins what the writer authored", async () => {
    const p = provider();
    expect(await deleteReference(p, REF, "character--Maren Voss.md")).toBe(
      true,
    );
    expect(p.moveFile).toHaveBeenCalledWith(
      REF,
      "/reference/character--Maren Voss.md",
      "/recyclebin",
    );
    expect(p.removeFile).not.toHaveBeenCalled();
  });

  it("removes what the assistant can make again", async () => {
    // A summary regenerates on demand, so binning it would fill the bin with
    // the one thing nobody restores.
    const p = provider();
    expect(await deleteReference(p, REF, "summary--EL1.md")).toBe(true);
    expect(p.removeFile).toHaveBeenCalledWith(
      REF,
      "/reference/summary--EL1.md",
    );
    expect(p.moveFile).not.toHaveBeenCalled();
    expect(isDerivedReference("summary--EL1.md")).toBe(true);
    expect(isDerivedReference("note--idea.md")).toBe(false);
  });

  it("says the port refused rather than swallowing it", async () => {
    const p = provider({
      moveFile: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    expect(await deleteReference(p, REF, "note--idea.md")).toBe(false);
  });
});

describe("restoreReference", () => {
  it("puts a binned document back with no slot to choose", async () => {
    const p = provider();
    expect(await restoreReference(p, REF, "note--idea.md")).toBe(true);
    expect(p.moveFile).toHaveBeenCalledWith(
      REF,
      "/recyclebin/note--idea.md",
      "/reference",
    );
  });

  it("brings the character back with the arc, character first", async () => {
    // An arc whose character is gone is an arc drawn for nobody: the
    // Characters card never returns it, so an arc restored alone lands in a
    // folder where nothing will show it again.
    const p = provider({ exists: vi.fn(async (_ref, path) => inBin(path)) });
    expect(await restoreReference(p, REF, "arc--Maren Voss.md")).toBe(true);
    const calls = (p.moveFile as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[1])).toEqual([
      "/recyclebin/character--Maren Voss.md",
      "/recyclebin/arc--Maren Voss.md",
    ]);
  });

  it("leaves an arc deleted on its own alone", async () => {
    // The writer who binned only the arc gets only the arc back: the character
    // is still in the folder, and nothing else is touched.
    const p = provider({ exists: vi.fn(async () => false) });
    expect(await restoreReference(p, REF, "arc--Maren Voss.md")).toBe(true);
    const calls = (p.moveFile as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[1])).toEqual(["/recyclebin/arc--Maren Voss.md"]);
  });

  it("does not drag the character back when the arc's own move fails", async () => {
    const p = provider({
      exists: vi.fn(async (_ref, path) => inBin(path)),
      moveFile: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("offline")),
    });
    expect(await restoreReference(p, REF, "arc--Maren Voss.md")).toBe(false);
    const calls = (p.moveFile as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => c[1])).toEqual([
      "/recyclebin/character--Maren Voss.md",
      "/recyclebin/arc--Maren Voss.md",
    ]);
  });
});

// A restore lands on a folder the writer has kept using since the delete. The
// fake below moves and renames the way every backend does, onto whatever is
// there, so an overwrite shows as lost text.
describe("restoreReference — a name taken since the delete", () => {
  function folder(entries: Record<string, string>) {
    const files = new Map(Object.entries(entries));
    const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
    const dir = (path: string) => path.slice(0, path.lastIndexOf("/"));
    const p = {
      exists: vi.fn(async (_ref: ProjectRef, path: string) => files.has(path)),
      moveFile: vi.fn(async (_ref: ProjectRef, from: string, to: string) => {
        const text = files.get(from);
        if (text === undefined) throw new Error(`missing ${from}`);
        files.delete(from);
        files.set(`${to}/${base(from)}`, text);
      }),
      renameFile: vi.fn(
        async (_ref: ProjectRef, from: string, name: string) => {
          const text = files.get(from);
          if (text === undefined) throw new Error(`missing ${from}`);
          files.delete(from);
          files.set(`${dir(from)}/${name}`, text);
        },
      ),
    } as unknown as StorageProvider;
    return { p, files };
  }

  it("brings the document back under a free name, keeping the new one", async () => {
    const { p, files } = folder({
      "/recyclebin/note--idea.md": "old",
      "/reference/note--idea.md": "new",
    });
    expect(await restoreReference(p, REF, "note--idea.md")).toBe(true);
    expect(Object.fromEntries(files)).toEqual({
      "/reference/note--idea.md": "new",
      "/reference/note--idea (2).md": "old",
    });
  });

  it("skips a suffix already used in either folder", async () => {
    const { p, files } = folder({
      "/recyclebin/note--idea.md": "old",
      "/recyclebin/note--idea (2).md": "older",
      "/reference/note--idea.md": "new",
      "/reference/note--idea (3).md": "newer",
    });
    expect(await restoreReference(p, REF, "note--idea.md")).toBe(true);
    expect(files.get("/reference/note--idea (4).md")).toBe("old");
    expect(files.get("/recyclebin/note--idea (2).md")).toBe("older");
    expect(files.get("/reference/note--idea (3).md")).toBe("newer");
    expect(files.get("/reference/note--idea.md")).toBe("new");
  });

  it("moves a character and its arc to the same free stem", async () => {
    // The pair is bound by the stem, so a clash on either one moves both.
    const { p, files } = folder({
      "/recyclebin/character--Maren Voss.md": "old sheet",
      "/recyclebin/arc--Maren Voss.md": "old arc",
      "/reference/character--Maren Voss.md": "new sheet",
    });
    expect(await restoreReference(p, REF, "arc--Maren Voss.md")).toBe(true);
    expect(Object.fromEntries(files)).toEqual({
      "/reference/character--Maren Voss.md": "new sheet",
      "/reference/character--Maren Voss (2).md": "old sheet",
      "/reference/arc--Maren Voss (2).md": "old arc",
    });
  });

  it("keeps the plain name when nothing has taken it", async () => {
    const { p, files } = folder({ "/recyclebin/note--idea.md": "old" });
    expect(await restoreReference(p, REF, "note--idea.md")).toBe(true);
    expect(Object.fromEntries(files)).toEqual({
      "/reference/note--idea.md": "old",
    });
    expect(p.renameFile).not.toHaveBeenCalled();
  });
});
