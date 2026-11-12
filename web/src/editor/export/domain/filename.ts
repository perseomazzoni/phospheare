// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What an export file is called. The proposed name says what is inside and
// when it was made: the book's title alone for the manuscript, then a word for
// each further area included ("References", then "Notes"), then the local
// date and time to the second. A name the writer sends to an agent is a name
// they read, and an export never overwrites (a taken name becomes
// `name (2)`), so the clock does not have to make it unique.
//
// The writer may type any name, so the name is a path component built from
// free input, and it is anchored here before any storage sees it: no
// separator, no `..`, nothing Windows refuses, no device name, a bounded
// length. The extension is the format's, added by the code and never typed by
// the writer, so a name cannot claim to be a different kind of file.

import { isWindowsDeviceName } from "../../../text/deviceNames";

interface Included {
  manuscript: boolean;
  references: boolean;
  notes: boolean;
}

interface AreaWords {
  references: string;
  notes: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `2026-10-01 14-32-05`, local time; colons are not legal on Windows. */
export function exportTimestamp(now: Date): string {
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  );
}

export function defaultExportName(
  title: string,
  included: Included,
  words: AreaWords,
  now: Date,
): string {
  const parts = [title.trim()];
  if (included.references) parts.push(words.references);
  if (included.notes) parts.push(words.notes);
  parts.push(exportTimestamp(now));
  return sanitizeFileName(parts.filter(Boolean).join(" "));
}

/**
 * Characters no common filesystem accepts in a name, every control character
 * (`C0`, DEL and `C1`), and the bidirectional overrides and isolates. The
 * last are legal everywhere, which is the danger: the default name is built
 * from the book's title, which a shared or hand-edited properties file
 * controls, and a right-to-left override in it makes `…fdp.exe` display as
 * `…exe.pdf` in a downloads list or a file manager. The real extension is
 * still the code's; what is spoofed is what the writer believes they are
 * opening.
 */
const ILLEGAL =
  // eslint-disable-next-line no-control-regex
  /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
export const MAX_NAME_LENGTH = 180;

/**
 * The name the export is written under, or "" when nothing usable is left,
 * which disables Export rather than inventing a name the writer never saw.
 */
export function sanitizeFileName(raw: string): string {
  let name = raw
    .normalize("NFC")
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot hides the file, and Windows strips trailing dots and
    // spaces, so the file would not be called what the dialog said. Leading
    // dots and spaces go together: `../../x` is `.. .. x` by now, and
    // stripping the dots alone leaves a name that starts with a space.
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "");
  // The format's extension added after the name does not change what
  // Windows reads it as.
  if (isWindowsDeviceName(name)) name = `_${name}`;
  // Bounded by code points, never splitting a surrogate pair.
  const chars = Array.from(name);
  if (chars.length > MAX_NAME_LENGTH)
    name = chars
      .slice(0, MAX_NAME_LENGTH)
      .join("")
      .replace(/[. ]+$/, "");
  return name;
}

/** The n-th candidate when `name` is taken: `name (2)`, `name (3)` and on. */
export function numberedName(name: string, n: number): string {
  return n <= 1 ? name : `${name} (${n})`;
}
