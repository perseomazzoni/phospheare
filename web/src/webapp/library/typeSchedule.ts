// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// When each character of the greeting lands. The greeting sets one character
// at a time, holds at the comma, finishes, and the caret fades out.
//
// No random jitter: it would make the schedule untestable, and irregular
// keystrokes read as jank. One pause in the right place carries the
// impression of a person.

/** Milliseconds between one character and the next. */
const PER_CHAR = 22;

/**
 * The extra beat after a mark, in milliseconds, before the next character.
 * The comma is longest because it is the only mark that appears mid-sentence
 * in a shipped greeting. Terminal marks are absent: a pause after the final
 * `!` delays nothing and holds the caret past the end of the sentence.
 */
const PAUSE_AFTER: Record<string, number> = {
  ",": 260,
  ";": 220,
  ":": 220,
  "—": 200,
};

/**
 * The cumulative delay, in milliseconds, at which each character appears.
 * One entry per code point, not per UTF-16 unit: `Array.from` rather than
 * `.split('')`, or an accented glyph is torn into two broken characters.
 */
export function typeSchedule(text: string): number[] {
  const chars = Array.from(text);
  const out: number[] = [];
  let at = 0;

  for (const char of chars) {
    out.push(at);
    at += PER_CHAR + (PAUSE_AFTER[char] ?? 0);
  }

  return out;
}

/** When the last character has landed, in milliseconds; the caret waits. */
export function typeDuration(text: string): number {
  const schedule = typeSchedule(text);
  return schedule.length === 0 ? 0 : schedule[schedule.length - 1] + PER_CHAR;
}
