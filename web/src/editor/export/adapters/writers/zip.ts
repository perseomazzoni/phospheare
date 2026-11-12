// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Zips the EPUB, DOCX and ODT packages. EPUB and ODF identify themselves by a
// `mimetype` file that must be the archive's first entry and stored, not
// compressed, so a reader can sniff the type from fixed bytes at the start of
// the file. Either mistake makes a valid-looking EPUB that every validator
// rejects. fflate keeps insertion order, so the entry passed first is written
// first.

import { zipSync, type Zippable } from "fflate";
import { utf8 } from "./xml";

export interface ZipEntry {
  path: string;
  data: string | Uint8Array;
}

/**
 * The archive's bytes. With `mimetype`, a stored `mimetype` entry leads it;
 * every other entry is deflated.
 */
export function zipPackage(
  entries: readonly ZipEntry[],
  mimetype?: string,
): Uint8Array {
  const files: Zippable = {};
  if (mimetype !== undefined) files.mimetype = [utf8(mimetype), { level: 0 }];
  for (const entry of entries)
    files[entry.path] =
      typeof entry.data === "string" ? utf8(entry.data) : entry.data;
  // A fixed timestamp, so the same book exported twice is the same file byte
  // for byte, apart from what the book itself says, its modified date.
  return zipSync(files, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
}
