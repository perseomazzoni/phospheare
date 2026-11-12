// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The import's ports: what the application needs from the world. The readers
// are the adapter port the import is built around: one per format, all making
// the same `SourceDocument`. The rest are the few facts the application may
// not know for itself (how the engine writes a paragraph, how the app counts
// a word, what a generated title says in the book's language), so nothing
// inside the hexagon imports the project, the engine or i18n.

import type { DraftParagraph } from "../domain/draft";
import type { FormatId } from "../domain/formats";
import type { SniffResult } from "../domain/sniff";
import type { MatterKind, SourceDocument } from "../domain/source";

/** A file the writer chose: the browser's `File`, or a test's own. */
export interface InputFile {
  readonly name: string;
  readonly size: number;
  bytes(): Promise<Uint8Array>;
}

export interface ReadContext {
  /**
   * Hands the page back for a frame, so a long read never freezes the
   * window.
   */
  yield(): Promise<void>;
  /**
   * Set when the writer closes the window mid-read; readers stop at the next
   * yield.
   */
  signal?: AbortSignal;
}

/** One format's reader: bytes in, the general internal structure out. */
export interface FormatReader {
  readonly format: FormatId;
  read(
    bytes: Uint8Array,
    name: string,
    ctx: ReadContext,
  ): Promise<SourceDocument>;
}

/** Loads a reader on demand: one chunk per format, fetched only when used. */
export type ReaderLoader = (format: FormatId) => Promise<FormatReader>;

/** Looks inside a zip of unknown kind and says which package it is. */
export type ZipProbe = (bytes: Uint8Array) => Promise<SniffResult>;

/**
 * The engine's own serialiser, so imported text is written the way the
 * editor writes.
 */
export interface ManuscriptWriter {
  serialize(paragraphs: readonly DraftParagraph[]): string;
  /**
   * The paragraphs the editor will show for this text, as plain text: what
   * a comment's passage is found in, so an imported comment is anchored to
   * the words the margin will look for.
   */
  visibleParagraphs(text: string): string[];
}

/** The project's rules the import must agree with. */
export interface ProjectRules {
  /** The app's one word count, over serialised manuscript text. */
  countWords(markdown: string): number;
  /** Why a title cannot be used, or null. */
  titleProblem(title: string): string | null;
  /**
   * The document type a book of this length is, by the creation dialog's
   * ranges.
   */
  typeForWords(words: number): string;
  /** That type's default goal, when it has one. */
  typeGoal(type: string): number | undefined;
}

/** Words the import writes into the book, in the book's language. */
export interface TitleWords {
  /**
   * The name of a piece the source gave no title ("Untitled"). Never a
   * number: a made-up "Chapter 1" in front of the book's own Chapter 1
   * would read as the book's numbering, and lie about it.
   */
  readonly untitled: string;
  /** A heading for matter that came without one ("Copyright", "Contents"). */
  matter(kind: MatterKind): string;
  /** A scene the source gave no title: "LEV, scene 2". */
  scene(chapter: string, n: number): string;
  /** A row cut from another, by its place after it: "LEV split 2". */
  split(row: string, n: number): string;
  /** A title two nodes would share, by its place among them: "Anna - 2". */
  shared(title: string, n: number): string;
}
