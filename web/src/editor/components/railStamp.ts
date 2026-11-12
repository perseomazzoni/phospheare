// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The rail's step stamp: the walked step's wall-clock moment, in two lines:
//
//   Tue, 12 Aug 2026
//   14:32:12
//
// Built from separate Intl calls joined by ", " and " ", as the Desk does, so
// the punctuation is fixed in every locale while the words are localized, and
// no single-object call inserts its own comma. A missing or unusable stamp
// answers `null` and the rail shows nothing, so a journal without timestamps
// never breaks the walk.

export interface RailStampFormatters {
  weekday: Intl.DateTimeFormat;
  day: Intl.DateTimeFormat;
  month: Intl.DateTimeFormat;
  year: Intl.DateTimeFormat;
  time: Intl.DateTimeFormat;
}

/**
 * The five formatters, built once per locale; the component memoizes them
 * rather than constructing them on every wheel notch. `extra` lets tests pin
 * the output with a fixed time zone.
 */
export function railStampFormatters(
  locale: string,
  extra?: Intl.DateTimeFormatOptions,
): RailStampFormatters {
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", ...extra }),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", ...extra }),
    month: new Intl.DateTimeFormat(locale, { month: "short", ...extra }),
    year: new Intl.DateTimeFormat(locale, { year: "numeric", ...extra }),
    time: new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...extra,
    }),
  };
}

/**
 * The two-line stamp, or `null` when the stamp is missing or unparseable.
 * The newline is the layout: the CSS renders it as the line break between
 * the date and the time.
 */
export function railStamp(
  fmt: RailStampFormatters,
  ts: number | null,
): string | null {
  if (ts === null || !Number.isFinite(ts)) return null;
  const at = new Date(ts);
  if (Number.isNaN(at.getTime())) return null;
  const dateLine = `${fmt.weekday.format(at)}, ${fmt.day.format(at)} ${fmt.month.format(at)} ${fmt.year.format(at)}`;
  return `${dateLine}\n${fmt.time.format(at)}`;
}
