// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { extensionOf, formatForName, type FormatId } from "./formats";

// What a file really is. The extension is a claim; the first bytes are
// evidence. A writer's "manuscript.docx" may be a 1997 .doc renamed, a PDF, a
// .pages package, or an online document's .gdoc shortcut that holds no text
// at all, and each of those deserves a sentence that says so and what to do
// instead, never "could not read the file".
//
// A zip is not a format: docx, odt, epub and .pages are all zips. A zip with a
// package extension is taken at its word and checked by the reader; a zip
// with any other name goes to the `ZipProbe`, which looks inside.

export type Refusal =
  /** A legacy binary .doc, or a password-protected docx (both OLE files). */
  | "doc"
  | "pdf"
  | "pages"
  /** A `.gdoc` is a link to a document in Drive, not the document. */
  | "gdoc"
  | "scrivener"
  /** Bytes that are not text, under a text format's name. */
  | "binary"
  /** Nothing the import knows how to read. */
  | "unknown"
  | "empty"
  | "tooLarge"
  /** An epub whose text is encrypted (DRM). */
  | "drm"
  /** A package that does not open, or opens to the wrong insides. */
  | "damaged"
  /** A zip that would inflate past the caps (`domain/limits.ts`). */
  | "bomb"
  /** An epub among other files: a book is one epub, never a chapter of one. */
  | "mixed"
  /** Past `MAX_FILES` in one import. */
  | "tooMany";

export type SniffResult =
  | { kind: "format"; format: FormatId }
  | { kind: "zip" }
  | { kind: "refused"; reason: Refusal };

const startsWith = (head: Uint8Array, bytes: readonly number[]): boolean =>
  bytes.every((byte, i) => head[i] === byte);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PDF = [0x25, 0x50, 0x44, 0x46];
const RTF = [0x7b, 0x5c, 0x72, 0x74, 0x66];

const REFUSED_BY_NAME: Record<string, Refusal> = {
  doc: "doc",
  dot: "doc",
  wps: "doc",
  pdf: "pdf",
  pages: "pages",
  gdoc: "gdoc",
  scriv: "scrivener",
  scrivx: "scrivener",
};

/**
 * Whether the head of a file looks like text: no NUL bytes, and few control
 * characters. UTF-16 text has NULs everywhere, so a UTF-16 byte-order mark
 * vouches for the file first.
 */
export function looksLikeText(head: Uint8Array): boolean {
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff]))
    return true;
  let control = 0;
  for (const byte of head) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b))
      control += 1;
  }
  return control <= head.length / 100;
}

/** Decides what a file is from its name and its first few kilobytes. */
export function sniff(name: string, head: Uint8Array): SniffResult {
  if (head.length === 0) return { kind: "refused", reason: "empty" };
  const ext = extensionOf(name);
  const claimed = formatForName(name);

  if (startsWith(head, OLE)) return { kind: "refused", reason: "doc" };
  if (startsWith(head, PDF)) return { kind: "refused", reason: "pdf" };
  if (startsWith(head, ZIP)) {
    if (ext === "pages") return { kind: "refused", reason: "pages" };
    if (claimed === "docx" || claimed === "odt" || claimed === "epub")
      return { kind: "format", format: claimed };
    return { kind: "zip" };
  }
  // A real RTF file begins with its signature, whatever it is called.
  if (startsWith(head, RTF)) return { kind: "format", format: "rtf" };

  const byName = REFUSED_BY_NAME[ext];
  if (byName) return { kind: "refused", reason: byName };

  if (claimed === "docx" || claimed === "odt" || claimed === "epub")
    // A package extension on something that is not a zip at all.
    return { kind: "refused", reason: "damaged" };
  if (claimed === "rtf") return { kind: "refused", reason: "damaged" };
  if (!looksLikeText(head)) return { kind: "refused", reason: "binary" };
  if (claimed) return { kind: "format", format: claimed };
  // Text with no known name: an HTML page saved without its extension
  // still says so in its first bytes; anything else is read as plain text.
  const start = new TextDecoder("latin1")
    .decode(head.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  if (start.startsWith("<!doctype html") || start.startsWith("<html"))
    return { kind: "format", format: "html" };
  return { kind: "refused", reason: "unknown" };
}
