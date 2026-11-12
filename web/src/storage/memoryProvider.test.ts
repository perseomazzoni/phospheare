// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { memoryProvider } from "./memoryProvider";
import { StorageError } from "./types";

const ref = {
  providerId: "memory",
  key: "demo",
  name: "Once Dark",
  openedAt: "",
};

// The demo book's own coherence: a part file's H1 is the title the structure
// yaml carries ("Ki - Void"), never an ordinal that drifts from the tree's
// name, so the two naming schemes stay one. The structure's `part:`
// rows and the part files live in the same seed map; this pin walks both
// sides and compares.
describe("the demo book's part files", () => {
  it("open with the same title the structure tree carries", async () => {
    const structure = await memoryProvider.readFile(
      ref,
      "/document-structure.yaml",
    );
    const titles = new Map<string, string>();
    for (const match of structure.matchAll(
      /part:\s*"([^"]+)"\s*\n\s*adopted:\s*(part--[\w-]+\.EL\d+\.\d+\.md)/g,
    )) {
      titles.set(match[2], match[1]);
    }
    expect(titles.size).toBeGreaterThan(0);

    for (const [file, title] of titles) {
      const body = await memoryProvider.readFile(ref, `/document/${file}`);
      const h1 = /^\{align:center\}#\s+(.+)$/m.exec(body)?.[1];
      expect(h1, `${file} opens with the tree's title`).toBe(title);
    }
  });
});

// An export written into a memory book, the home the export host tests write
// to. The provider keeps binaries apart from its text map, so the
// risk is the seam between the two. An export the sink just wrote must be a
// file `exists` and `listDir` can see, because the next export picks a free
// `name (2)` that way, and it must never be served back through `readFile`
// as text. Paths are unique per row because the provider is a module-level
// singleton.
describe("writeBytes — exports in memory", () => {
  const writeBytes = memoryProvider.writeBytes;
  if (!writeBytes) throw new Error("memoryProvider.writeBytes missing");

  it("is a file exists and listDir both see, under a folder that was not there", async () => {
    // Its own folder: the other rows write under `/export` in the same
    // singleton, so asserting `/export` absent would hold only when this row
    // runs first.
    expect(await memoryProvider.exists(ref, "/export-first")).toBe(false);
    await writeBytes(
      ref,
      "/export-first/once-dark.pdf",
      new Uint8Array([0x00, 0xff]),
      "application/pdf",
    );

    expect(
      await memoryProvider.exists(ref, "/export-first/once-dark.pdf"),
    ).toBe(true);
    expect(await memoryProvider.exists(ref, "/export-first")).toBe(true);
    expect(await memoryProvider.listDir(ref, "/export-first")).toEqual([
      {
        path: "/export-first/once-dark.pdf",
        name: "once-dark.pdf",
        kind: "file",
      },
    ]);
    expect(await memoryProvider.listDir(ref, "/")).toContainEqual({
      path: "/export-first",
      name: "export-first",
      kind: "folder",
    });
  });

  it("is never read back as text", async () => {
    await writeBytes(
      ref,
      "/export/never-text.epub",
      new Uint8Array([0x50, 0x4b]),
      "application/epub+zip",
    );
    await expect(
      memoryProvider.readFile(ref, "/export/never-text.epub"),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("fills a folder that was created empty, which then lists its file", async () => {
    await memoryProvider.createDir(ref, "/export-empty");
    await writeBytes(
      ref,
      "/export-empty/a.rtf",
      new Uint8Array([0x7b]),
      "application/rtf",
    );
    expect(await memoryProvider.listDir(ref, "/export-empty")).toEqual([
      { path: "/export-empty/a.rtf", name: "a.rtf", kind: "file" },
    ]);
  });

  it("is gone once removed, so the next export may take its name", async () => {
    await writeBytes(
      ref,
      "/export/removed.txt",
      new Uint8Array([0x41]),
      "text/plain",
    );
    await memoryProvider.removeFile(ref, "/export/removed.txt");
    expect(await memoryProvider.exists(ref, "/export/removed.txt")).toBe(false);
  });
});
