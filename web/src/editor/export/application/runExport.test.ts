// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ExportDocument } from "../domain/model";
import type {
  ExportSink,
  ExportSource,
  FormatWriter,
  HomeReport,
} from "../ports";
import type { ExportRequest } from "./assemble";
import { EXPORT_EMPTY, runExport, type ExportDeps } from "./runExport";

// Pins one export end to end against fakes. `runExport` runs in order
// (assemble, write, keep, hand over) and refuses twice: no empty file and no
// overwritten one. The sink records every call in one log, so the order is
// asserted, not inferred.

const BOOK = {
  id: "b",
  title: "T",
  author: "",
  type: "Novel",
  language: "en",
  languageLabel: "English",
  genres: [],
  ageCategory: null,
  tropes: [],
  structure: null,
  createdAt: "",
  updatedAt: "",
};

function source(text: string): ExportSource {
  return {
    book: () => BOOK,
    manuscript: () => [{ id: "s", kind: "section", title: "S", children: [] }],
    references: async () => [],
    readNode: async () => ({ text, words: 1 }),
    readReference: async () => "",
  };
}

const parsers = {
  manuscript: {
    parse: (text: string) =>
      text
        ? [
            {
              kind: "paragraph" as const,
              inlines: [{ text }],
              align: "left" as const,
            },
          ]
        : [],
  },
  markdown: { parse: () => [] },
};

function sink(
  taken: string[] = [],
  homes: HomeReport[] = [{ home: "device", ok: true }],
) {
  const log: string[] = [];
  const fake: ExportSink = {
    exists: async (name) => taken.includes(name),
    save: async (name) => {
      log.push(`save ${name}`);
      return homes;
    },
    download: (name) => {
      log.push(`download ${name}`);
    },
  };
  return { fake, log };
}

const request: ExportRequest = {
  format: "txt",
  layout: "book",
  page: "a4",
  techPage: false,
  toc: false,
  selection: {
    manuscript: new Set(["s"]),
    references: new Set(),
    notes: new Set(),
  },
  author: "",
  contact: "",
  runningHeader: "",
  storySeparator: "shunn",
};

function deps(over: Partial<ExportDeps> = {}): ExportDeps {
  const writer: FormatWriter = {
    format: "txt",
    write: async (doc: ExportDocument) =>
      new TextEncoder().encode(String(doc.chapters.length)),
  };
  return {
    source: source("Hello."),
    parsers,
    sink: sink().fake,
    labels: { t: (key) => key, date: (iso) => iso, number: String },
    loadWriter: async () => writer,
    now: () => new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

describe("an export", () => {
  it("keeps the file in the book before it hands the browser its copy", async () => {
    const { fake, log } = sink();
    const outcome = await runExport(deps({ sink: fake }), request, "Book");
    expect(log).toEqual(["save Book.txt", "download Book.txt"]);
    expect(outcome).toEqual({
      fileName: "Book.txt",
      homes: [{ home: "device", ok: true }],
    });
  });

  it("never overwrites: a taken name is numbered", async () => {
    const { fake, log } = sink(["Book.txt", "Book (2).txt"]);
    const outcome = await runExport(deps({ sink: fake }), request, "Book");
    expect(outcome.fileName).toBe("Book (3).txt");
    expect(log[0]).toBe("save Book (3).txt");
  });

  it("downloads even when a home could not be written, and says which", async () => {
    const homes: HomeReport[] = [
      { home: "device", ok: true },
      { home: "remote", ok: false },
    ];
    const { fake, log } = sink([], homes);
    const outcome = await runExport(deps({ sink: fake }), request, "Book");
    expect(log).toContain("download Book.txt");
    expect(outcome.homes).toEqual(homes);
  });

  it("refuses to write a file with nothing in it", async () => {
    // An empty Section still prints its heading; only a pick of unfilled
    // templates leaves nothing.
    const { fake, log } = sink();
    const loadWriter = vi.fn();
    const empty: ExportSource = {
      ...source(""),
      references: async () => [
        { fileName: "world--x.md", group: "world", title: "X" },
      ],
    };
    await expect(
      runExport(
        deps({ sink: fake, source: empty, loadWriter }),
        {
          ...request,
          selection: {
            manuscript: new Set(),
            references: new Set(["world--x.md"]),
            notes: new Set(),
          },
        },
        "Book",
      ),
    ).rejects.toThrow("export-empty");
    // Not even the writer is fetched for a file that will not exist.
    expect(loadWriter).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  // Only the book's own chapters count. A tech page and an EPUB's contents
  // are chapters too, and counting them would let the window's defaults pass
  // the guard and write a file holding nothing else.
  it.each([
    ["behind a tech page", { techPage: true }],
    ["as an EPUB, whose contents are always there", { format: "epub" }],
  ] as const)("refuses a file about nothing %s", async (_, change) => {
    const { fake, log } = sink();
    const loadWriter = vi.fn();
    const empty: ExportSource = {
      ...source(""),
      references: async () => [
        { fileName: "world--x.md", group: "world", title: "X" },
      ],
    };
    await expect(
      runExport(
        deps({ sink: fake, source: empty, loadWriter }),
        {
          ...request,
          ...change,
          selection: {
            manuscript: new Set(),
            references: new Set(["world--x.md"]),
            notes: new Set(),
          },
        },
        "Book",
      ),
    ).rejects.toThrow(EXPORT_EMPTY);
    expect(loadWriter).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it("gives up rather than loop when every candidate name is taken", async () => {
    const fake: ExportSink = {
      exists: async () => true,
      save: vi.fn(),
      download: vi.fn(),
    };
    await expect(
      runExport(deps({ sink: fake }), request, "Book"),
    ).rejects.toThrow("export-name-exhausted");
    expect(fake.save).not.toHaveBeenCalled();
  });

  it("loads the writer for the format asked for", async () => {
    const loadWriter = vi.fn(deps().loadWriter);
    await runExport(deps({ loadWriter }), { ...request, format: "md" }, "Book");
    expect(loadWriter).toHaveBeenCalledWith("md");
  });
});
