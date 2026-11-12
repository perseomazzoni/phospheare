// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// One export, end to end: assemble, write, keep, hand over, in that order.
// The file is in the book's `export/` folder before the browser gets its copy,
// so "downloaded" never stands for a file the book does not also hold. A home
// that cannot be written, such as unreachable Remote Storage, is reported and does
// not stop the download: the writer asked for a file and gets one.
//
// The writer is loaded per export (`loadWriter`), so only a writer who
// exports to those formats fetches the zip and PDF libraries.

import { numberedName } from "../domain/filename";
import { FORMATS } from "../domain/formats";
import type { Chapter } from "../domain/model";
import type {
  ExportLabels,
  ExportSink,
  ExportSource,
  FormatWriter,
  HomeReport,
  Parsers,
} from "../ports";
import type { FormatId } from "../domain/formats";
import { assembleExport, type ExportRequest } from "./assemble";

export interface ExportDeps {
  source: ExportSource;
  parsers: Parsers;
  sink: ExportSink;
  labels: ExportLabels;
  loadWriter: (format: FormatId) => Promise<FormatWriter>;
  now: () => Date;
}

export interface ExportOutcome {
  /** The file name the export was written and downloaded under. */
  fileName: string;
  homes: HomeReport[];
}

/**
 * The reasons an export stops, as the window reads them.
 */
export const EXPORT_EMPTY = "export-empty";
export const EXPORT_NAME_EXHAUSTED = "export-name-exhausted";

/** How many `name (n)` candidates are tried before the export gives up. */
const MAX_CANDIDATES = 100;

export async function runExport(
  deps: ExportDeps,
  request: ExportRequest,
  name: string,
): Promise<ExportOutcome> {
  const format = FORMATS[request.format];
  const doc = await assembleExport(
    deps.source,
    deps.parsers,
    request,
    deps.labels,
    deps.now(),
  );
  // Everything ticked turned out empty, such as unfilled templates, so no
  // file is worth writing. The count is of the book's own chapters: a tech,
  // title or contents page is about the text, and the tech page and an EPUB's
  // contents are there by default, so a file holding only those is a file
  // about nothing.
  if (!doc.chapters.some(isContent)) throw new Error(EXPORT_EMPTY);
  const writer = await deps.loadWriter(request.format);
  const bytes = await writer.write(doc);
  const fileName = await freeName(deps.sink, name, format.extension);
  const homes = await deps.sink.save(fileName, bytes, format.mime);
  deps.sink.download(fileName, bytes, format.mime);
  return { fileName, homes };
}

/**
 * The first of `name.ext`, `name (2).ext` and so on that no home holds yet.
 * An export never overwrites: a file in `export/` may be the one the writer
 * already sent.
 */
async function freeName(
  sink: ExportSink,
  name: string,
  extension: string,
): Promise<string> {
  for (let n = 1; n <= MAX_CANDIDATES; n += 1) {
    const candidate = `${numberedName(name, n)}.${extension}`;
    if (!(await sink.exists(candidate))) return candidate;
  }
  throw new Error(EXPORT_NAME_EXHAUSTED);
}

const isContent = (chapter: Chapter) =>
  chapter.kind !== "tech" && chapter.kind !== "title" && chapter.kind !== "toc";
