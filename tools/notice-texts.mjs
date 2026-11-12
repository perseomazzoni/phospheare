// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The license and notice texts one dependency carries into the notices file.
// MIT and BSD require the copyright and permission notice to travel with
// copies, and Apache-2.0 its `NOTICE` file, so a package's own texts come first.
// A package that ships none needs a kept text, `tools/notices/<name>@<version>.txt`,
// read by hand from its repository at that version; without one the notices
// run fails rather than ship a reference in place of the text.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const NOTICE_FILE = /^(licen[cs]e|copying|patents|notice|thirdpartynotice|copyrightnotice)/i;

export const KEPT_DIR = join(import.meta.dirname, "notices");

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n").trimEnd();

/** The license and notice files at the top of `dir`, sorted by name. */
export function noticeFiles(dir) {
  return readdirSync(dir)
    .filter((f) => NOTICE_FILE.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => ({ file: f, text: read(join(dir, f)) }));
}

/**
 * The texts for one npm package: its own files, or else its kept text, or
 * `null` when it has neither.
 */
export function packageTexts(dir, name, version, keptDir = KEPT_DIR) {
  const own = noticeFiles(dir);
  if (own.length > 0) return own;
  const kept = join(keptDir, `${name.replace("/", "+")}@${version}.txt`);
  return existsSync(kept) ? [{ file: basename(kept), text: read(kept) }] : null;
}
