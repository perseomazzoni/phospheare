// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The formats a manuscript can arrive in, one row per reader in
// `adapters/readers/`. A new format is a row here, a reader file and a line
// in the registry; nothing else learns its name.
//
// Extensions are the first guess and never the last word: `sniff` reads the
// bytes, and a zip package is told apart by what is inside it (`ZipProbe`),
// because a `.docx` renamed `.zip`, or a `.pages` renamed `.docx`, is the
// kind of file a writer actually has.

export type FormatId = "docx" | "odt" | "rtf" | "md" | "txt" | "html" | "epub";

export const FORMAT_IDS: readonly FormatId[] = [
  "docx",
  "odt",
  "rtf",
  "md",
  "txt",
  "html",
  "epub",
];

/** The extensions each format answers to, lower case, without the dot. */
const EXTENSIONS: Record<FormatId, readonly string[]> = {
  docx: ["docx", "docm", "dotx"],
  odt: ["odt", "ott"],
  rtf: ["rtf"],
  md: ["md", "markdown", "mdown", "mkd", "mdtext"],
  txt: ["txt", "text"],
  html: ["html", "htm", "xhtml"],
  epub: ["epub"],
};

/** Formats whose file is a zip package, read through the zip adapter. */
export const PACKAGE_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>([
  "docx",
  "odt",
  "epub",
]);

/** The file input's `accept`: every extension, so the picker offers all. */
export const ACCEPT = FORMAT_IDS.flatMap((id) =>
  EXTENSIONS[id].map((ext) => `.${ext}`),
).join(",");

/** The part of a file name after its last dot, lower case; "" when none. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** The format a name claims by its extension, or null. */
export function formatForName(name: string): FormatId | null {
  const ext = extensionOf(name);
  for (const id of FORMAT_IDS) if (EXTENSIONS[id].includes(ext)) return id;
  return null;
}

/**
 * A file name without its folder or extension: a flow's name when nothing
 * better exists.
 */
export function stemOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
