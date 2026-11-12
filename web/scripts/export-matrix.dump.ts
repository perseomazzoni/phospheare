// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseProperties } from "../src/project/properties";
import { parseStructure } from "../src/project/structure";
import { memoryProvider } from "../src/storage/memoryProvider";
import { manuscriptParser } from "../src/editor/export/adapters/manuscriptBlocks";
import { markdownParser } from "../src/editor/export/adapters/markdownBlocks";
import { loadWriter } from "../src/editor/export/adapters/writers";
import {
  assembleExport,
  type ExportRequest,
} from "../src/editor/export/application/assemble";
import { FORMAT_IDS, FORMATS } from "../src/editor/export/domain/formats";
import { LAYOUT_IDS } from "../src/editor/export/domain/layout";
import {
  manuscriptForest,
  notesForest,
  referenceForest,
  selectableIds,
} from "../src/editor/export/domain/selection";
import { projectExportSource } from "../src/editor/export/host/projectSource";

// Writes every format in every layout of the demo book for outside
// validators. The unit tests prove each writer's structure from the inside;
// they cannot prove that EPUBCheck accepts the EPUB, or that an office suite
// opens the DOCX, ODT and RTF and lays them out as intended. The matrix goes
// to `test-results/export-matrix`, or `$PHOSPHEARE_EXPORT_DUMP`, for those
// tools to run over.
//
// A tool, not a test: it lives outside `src` and runs only through its own
// config (`npm run export:matrix`), because it writes to disk and needs
// Node's file system, which the app and its type-checked tree never have.

const OUT =
  process.env.PHOSPHEARE_EXPORT_DUMP ??
  join(__dirname, "../test-results/export-matrix");
const FONTS = join(__dirname, "../public/fonts/export");

const ref = {
  providerId: "memory",
  key: "demo",
  name: "Once Dark",
  openedAt: "",
};

const labels = {
  // The key itself, with its variables: readable enough for a layout check.
  t: (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key} ${Object.values(vars).join(" ")}` : key,
  date: (iso: string) => iso.slice(0, 10),
  number: (value: number) => String(value),
};

describe("the export matrix of the demo book", () => {
  it("writes every format in every layout", async () => {
    mkdirSync(OUT, { recursive: true });
    const structureResult = parseStructure(
      await memoryProvider.readFile(ref, "/document-structure.yaml"),
    );
    if (!structureResult.ok) throw new Error("demo structure does not parse");
    const structure = structureResult.structure;
    const properties = parseProperties(
      await memoryProvider.readFile(ref, "/document-properties.json"),
      "Once Dark",
    );
    properties.document.author = "Test Writer";
    const source = projectExportSource({
      storage: memoryProvider,
      ref,
      structure: () => structure,
      properties: () => properties,
      t: ((key: string) => key) as never,
    });
    const entries = await source.references();
    const selection = {
      manuscript: selectableIds(manuscriptForest(source.manuscript())),
      references: selectableIds(referenceForest(entries, (group) => group)),
      notes: selectableIds(notesForest(entries)),
    };
    const loadFont = async (file: string) =>
      new Uint8Array(readFileSync(join(FONTS, file)));

    for (const format of FORMAT_IDS) {
      const layouts = FORMATS[format].paged ? LAYOUT_IDS : (["book"] as const);
      for (const layout of layouts) {
        for (const type of FORMATS[format].paged &&
        layout.startsWith("manuscript")
          ? ["Novel", "Short Story"]
          : ["Novel"]) {
          properties.document.type = type;
          const request: ExportRequest = {
            format,
            layout,
            page: "a4",
            techPage: true,
            toc: true,
            selection,
            author: "Test Writer",
            contact:
              "Test Writer\n1 Main Street\nSpringfield\nwriter@example.com",
            runningHeader: "Writer / Once Dark",
            storySeparator: "shunn",
          };
          const doc = await assembleExport(
            source,
            { manuscript: manuscriptParser, markdown: markdownParser },
            request,
            labels,
            new Date("2026-10-01T12:00:00Z"),
          );
          const writer = await loadWriter(format, loadFont);
          const bytes = await writer.write(doc);
          expect(bytes.length).toBeGreaterThan(0);
          const suffix = type === "Novel" ? "" : "-story";
          writeFileSync(
            join(OUT, `${layout}${suffix}.${FORMATS[format].extension}`),
            bytes,
          );
        }
      }
    }
  }, 120_000);
});
