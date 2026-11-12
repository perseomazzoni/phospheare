// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The export's ports: what the assembler needs from the world, and what a
// format writer and the place the file lands must provide. The host
// (`editor/export/host/`) implements the two that touch the project, where the
// book is read and where the file is written, so nothing inside the hexagon
// knows that a storage provider, a project file name or React exists.

import type { BookFacts, ManuscriptNode, ReferenceEntry } from "../domain/book";
import type { FormatId } from "../domain/formats";
import type { Block, ExportDocument } from "../domain/model";

/** The book as its files hold it at this moment. */
export interface ExportSource {
  book(): BookFacts;
  /** The current structure, in reading order. */
  manuscript(): ManuscriptNode[];
  /** Every reference document and note, in the order the shelf shows them. */
  references(): Promise<ReferenceEntry[]>;
  /**
   * A node's text in the manuscript dialect, with the writer's `<!-- -->`
   * asides taken out because an aside is not content, and its word
   * count by the app's one counting rule.
   */
  readNode(id: string): Promise<{ text: string; words: number }>;
  /**
   * A reference document's Markdown, with its template hints, unanswered
   * template questions and summary metadata taken out.
   */
  readReference(fileName: string): Promise<string>;
}

/** Text in, the export model out. One per source dialect. */
export interface BlockParser {
  parse(text: string): Block[];
}

export interface Parsers {
  /** The manuscript dialect: `{align:…}`, `{pagebreak}`, two heading levels. */
  manuscript: BlockParser;
  /** General Markdown, for references and notes. */
  markdown: BlockParser;
}

/** Serialises the export model into one format's bytes. */
export interface FormatWriter {
  readonly format: FormatId;
  write(doc: ExportDocument): Promise<Uint8Array>;
}

/** Where the file is kept, and how it reaches the writer's Downloads. */
export interface ExportSink {
  /** Whether any of the book's homes already holds `export/<fileName>`. */
  exists(fileName: string): Promise<boolean>;
  /** Writes `export/<fileName>` into every home the book has. */
  save(
    fileName: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<HomeReport[]>;
  /** Hands the bytes to the browser as a download. */
  download(fileName: string, bytes: Uint8Array, mime: string): void;
}

/** How writing to one home went. A failed home never stops the download. */
export interface HomeReport {
  home: "device" | "remote";
  ok: boolean;
}

/** The words the export prints that are not the writer's. */
export interface ExportLabels {
  t(key: string, vars?: Record<string, string | number>): string;
  /** An ISO 8601 date in the writer's locale. */
  date(iso: string): string;
  /** A count in the writer's locale. */
  number(value: number): string;
}
