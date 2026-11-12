// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";
import {
  EXPORT_DIR,
  PROPERTIES_FILE,
  STRUCTURE_FILE,
} from "../../../project/naming";
import { parseProperties } from "../../../project/properties";
import { parseStructure } from "../../../project/structure";
import { memoryProvider } from "../../../storage/memoryProvider";
import type { ProjectRef } from "../../../storage/types";

// Pins one export through the real wiring, against the demo book in memory:
// the source reads the book's files, the assembler lays them out, the TXT
// writer writes, and the sink keeps the file in the book's `export/` before
// handing the browser its copy. Only the two ends that leave the process are
// stubbed: the registry, so the sink finds the in-memory provider, and the
// browser's download.

vi.mock("../../../storage", () => ({
  getProvider: (id: string) =>
    id === memoryProvider.id ? memoryProvider : null,
}));
vi.mock("../../../project/sync/remoteFor", () => ({
  remoteFor: async () => null,
}));
const downloadFile = vi.fn();
vi.mock("../adapters/download", () => ({
  downloadFile: (...args: unknown[]) => downloadFile(...args),
}));

const { bookExport } = await import("./bookExport");

const ref: ProjectRef = {
  providerId: memoryProvider.id,
  key: "demo",
  name: "Once Dark",
  openedAt: "",
};

const t = ((key: string) => key) as unknown as TFunction;

describe("bookExport — one export, wired", () => {
  it("keeps the book's text in its export folder, then downloads the same bytes", async () => {
    const parsed = parseStructure(
      await memoryProvider.readFile(ref, STRUCTURE_FILE),
    );
    if (!parsed.ok) throw new Error("the demo structure does not parse");
    const properties = parseProperties(
      await memoryProvider.readFile(ref, PROPERTIES_FILE),
      ref.name,
    );
    const exporter = bookExport({
      storage: memoryProvider,
      ref,
      structure: () => parsed.structure,
      properties: () => properties,
      t,
      language: "en",
    });

    const first = parsed.structure.children[0];
    const outcome = await exporter.run(
      {
        format: "txt",
        layout: "book",
        page: "a4",
        techPage: false,
        toc: false,
        selection: {
          manuscript: new Set([first.id]),
          references: new Set(),
          notes: new Set(),
        },
        author: "",
        contact: "",
        runningHeader: "",
        storySeparator: "shunn",
      },
      "Once Dark",
    );

    expect(outcome).toEqual({
      fileName: "Once Dark.txt",
      homes: [{ home: "device", ok: true }],
    });
    const kept = await memoryProvider.listDir(ref, EXPORT_DIR);
    expect(kept.map((entry) => entry.name)).toContain("Once Dark.txt");
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [name, bytes] = downloadFile.mock.calls[0] as [string, Uint8Array];
    expect(name).toBe("Once Dark.txt");
    expect(new TextDecoder().decode(bytes)).toContain(first.title);
  });
});
