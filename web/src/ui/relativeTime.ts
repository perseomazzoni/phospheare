// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// How long ago: "edited 2 hours ago". Every card carries one, and it stops a
// stale word count from reading as a live one. It lives in `ui/` because both
// halves need it.
//
// The choice of unit is arithmetic, settled here and tested in Node. The words
// are not: `Intl.RelativeTimeFormat` already says this in English and Italian,
// and hand-written strings in two locales would be one more thing to keep in
// step. So this returns the pair the formatter takes, and the component
// formats it in the writer's language.

export interface Elapsed {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Not a calendar month; the point is the word, not the arithmetic. */
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * How long before `now` the stamp was, in a unit a person would use.
 *
 * Null when there is no usable stamp, such as a document counted without one
 * or a hand-edited file. The caller shows nothing rather than "in 56 years",
 * which is what an empty string parses to.
 *
 * A stamp in the future reads as "now". Clocks drift, a file copied between
 * machines can carry a timestamp minutes ahead of this one, and "edited in 3
 * hours" would be the app calling the writer's own machine a liar.
 */
export function elapsed(iso: string, now: number): Elapsed | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const ms = Math.max(0, now - then);

  if (ms < MINUTE) return { value: 0, unit: "second" };
  if (ms < HOUR) return { value: -Math.floor(ms / MINUTE), unit: "minute" };
  if (ms < DAY) return { value: -Math.floor(ms / HOUR), unit: "hour" };
  if (ms < WEEK) return { value: -Math.floor(ms / DAY), unit: "day" };
  if (ms < MONTH) return { value: -Math.floor(ms / WEEK), unit: "week" };
  if (ms < YEAR) return { value: -Math.floor(ms / MONTH), unit: "month" };
  return { value: -Math.floor(ms / YEAR), unit: "year" };
}
