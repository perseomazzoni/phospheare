// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// One line of the app's log, in the format the desktop program and the
// identity service write (`desktop/internal/adapters/logs/format.go`), so the
// three logs read alike and sort together:
//
//   2026-11-15T15:21:40.008+01:00  ERROR  spa       Q2x5bmF0dGhlRXhhbXBs    sync      Sync stopped at a change.  code=quota
//
// the time, the level, the source, the writer account, the area, the
// message, and the fields.

export type LogLevel = "info" | "warn" | "error";

/** The levels from the least to the most severe. */
export const LEVELS: readonly LogLevel[] = ["info", "warn", "error"];

export type FieldValue = string | number | boolean;

export interface LogEntry {
  /** Epoch milliseconds. */
  at: number;
  level: LogLevel;
  /** The part of the app, one short lowercase word: `fault`, `sync`. */
  area: string;
  message: string;
  /** The writer account id, or `null` before an account is open. */
  account: string | null;
  fields: Readonly<Record<string, FieldValue>>;
}

/** The source this log names on every line. */
export const SOURCE = "spa";

const LEVEL_WIDTH = 5;
const SOURCE_WIDTH = 8;
const ACCOUNT_WIDTH = 22;
const AREA_WIDTH = 8;

/** Whether `level` is `floor` or more severe. */
export function atLeast(level: LogLevel, floor: LogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(floor);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `at` as local time with milliseconds and the offset, as RFC 3339 writes it. */
export function formatTime(at: number): string {
  const d = new Date(at);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** A column: `s` padded to `width`, then two spaces. A longer `s` keeps its length. */
const column = (s: string, width: number) => s.padEnd(width) + "  ";

/**
 * Keeps one event on one line, and keeps out the control characters that
 * could move a terminal's cursor or colour a line.
 */
export function escape(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => {
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}

/**
 * A field's value: quoted when it holds a space, a quote or an equals sign,
 * or is empty, so a line splits back into its fields.
 */
export function fieldValue(v: FieldValue): string {
  const s = String(v);
  if (s === "" || /[\s"=]/.test(s)) {
    return `"${escape(s.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))}"`;
  }
  return escape(s);
}

/** The line `entry` reads as, without its newline. */
export function formatLine(entry: LogEntry): string {
  let line =
    formatTime(entry.at) +
    "  " +
    column(entry.level.toUpperCase(), LEVEL_WIDTH) +
    column(SOURCE, SOURCE_WIDTH) +
    column(entry.account ?? "-", ACCOUNT_WIDTH) +
    column(entry.area || "-", AREA_WIDTH) +
    escape(entry.message.trim());
  const fields = Object.entries(entry.fields);
  fields.forEach(([key, value], i) => {
    line += (i === 0 ? "  " : " ") + key + "=" + fieldValue(value);
  });
  return line;
}

/** The first line of a downloaded log. */
export function header(
  product: string,
  version: string,
  saved: number,
): string {
  return `━━ ${product} ${version} · browser · ${SOURCE} · log saved ${formatTime(saved)} ━━`;
}
