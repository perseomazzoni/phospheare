// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// An answer's Markdown tables, mended where a model broke them.
//
// `QUOTE_FORM` says a quotation in a table cell is inline, never a
// blockquote, and a model writes one anyway. Markdown has no blockquote inside
// a table, so the cell shows a bare ">", and a line break ends the row, so
// the rest of the row falls out of the table as a blockquote. The quotation
// check then reads that stray line as one long quotation not in the book.
//
// The answer is mended before it is drawn and before it is checked; the
// stored text stays what the model wrote. Each repair applies only where
// nothing else could be meant:
//   - a "> " opening a table cell is dropped, since a table has no blockquote;
//   - a line opening with ">" and holding a cell separator, straight after a
//     table row, is joined back onto that row;
//   - a row with fewer cells than the header, followed by lines that are not
//     rows, is one row broken across them, and they are joined back until it
//     has its cells;
//   - a blank line between two rows of one table is dropped, because Markdown
//     ends a table at a blank line and every later row draws as loose text.

const ROW = /^\s*\|/;
const CELL_QUOTE = /\|\s*>\s?/g;
const STRAY = /^\s*>\s?(.*\|.*)$/;
const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** How many cells a table row holds (an escaped "\|" is not a border). */
function cellCount(row: string): number {
  const inner = row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).length;
}

/** `text` with every broken table put back together. */
export function mendTables(text: string): string {
  const out: string[] = [];
  let fenced = false;
  /** The open table's column count, from its separator row; 0 when none. */
  let columns = 0;
  /** A blank line held back while a table is open, until the next line says. */
  let blank: string | null = null;
  const join = (rest: string) => {
    const previous = out[out.length - 1] ?? "";
    const joined = `${previous.replace(/\s*\|\s*$/, "")} ${rest.trim()}`;
    out[out.length - 1] = joined.replace(CELL_QUOTE, "| ");
  };
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      columns = 0;
    }
    if (!fenced && columns > 0 && line.trim() === "") {
      blank ??= line;
      continue;
    }
    if (blank !== null) {
      // A row right after the blank continues the table; anything else
      // means the blank was the table's end, and it goes back.
      if (!ROW.test(line)) {
        out.push(blank);
        columns = 0;
      }
      blank = null;
    }
    const previous = out[out.length - 1];
    const afterRow = previous !== undefined && ROW.test(previous) && !fenced;
    const stray = afterRow ? STRAY.exec(line) : null;
    if (stray) {
      join(stray[1]);
      continue;
    }
    if (
      afterRow &&
      columns > 0 &&
      line.trim() !== "" &&
      !ROW.test(line) &&
      cellCount(previous) < columns
    ) {
      join(line.replace(/^\s*>\s?/, ""));
      continue;
    }
    if (!fenced && afterRow && SEPARATOR.test(line))
      columns = cellCount(previous);
    else if (!ROW.test(line)) columns = 0;
    out.push(!fenced && ROW.test(line) ? line.replace(CELL_QUOTE, "| ") : line);
  }
  if (blank !== null) out.push(blank);
  return out.join("\n");
}
