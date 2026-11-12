// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

/**
 * `Saved · Today, 14:32`, or `Saved · Aug 4, 14:32` once the day has turned.
 * `today` is the locale file's word, so the time and the month are formatted
 * in the same `language`, never the browser's.
 */
export function formatSavedAt(
  at: number,
  language: string,
  today: string,
  now: Date = new Date(),
): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (when.toDateString() === now.toDateString()) return `${today}, ${time}`;
  return `${when.toLocaleDateString(language, { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * A short date and short time in the app's `language`, never the browser's,
 * so the stamp reads in the language of the sentence around it. When `when`
 * is not a parseable date (a hand-edited yaml, a Drive quirk), the raw
 * string comes back, so the row never misstates the stamp.
 */
export function formatWhen(when: string, language: string): string {
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return when;
  return date.toLocaleString(language, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
