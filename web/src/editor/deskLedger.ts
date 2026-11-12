// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { DocumentStats, WritingSession } from "../project/types";

// What has changed: the Desk's third band. The ledger leads with the delta,
// since when and how much, then the totals that give it a scale. `ui.session`
// holds where a sitting began: a stamp and a word count written when the
// editor opens after a long enough gap.
//
// A session is bounded by absence, not by the clock: a reload must not reset
// the baseline and erase that work. The gap is generous because over-counting
// shows work the writer did, while under-counting throws work away.

/** Long enough away that coming back is a new sitting. */
export const SESSION_GAP_MS = 4 * 60 * 60 * 1000;

/**
 * The session baseline to work from, given whatever the file already had.
 *
 * Returns the existing one when the writer is still in it, and a fresh one
 * otherwise. Every path returns a usable baseline, so the Desk never renders
 * "no session".
 */
export function sessionFor(
  existing: WritingSession | null,
  stats: DocumentStats,
  now: number,
): WritingSession {
  if (!existing)
    return { startedAt: new Date(now).toISOString(), words: stats.words };

  const began = Date.parse(existing.startedAt);
  // An unparseable stamp is not a session, and neither is one from the future:
  // a file from a machine whose clock runs fast would hold the baseline open
  // and report every day's work as one sitting.
  if (Number.isNaN(began) || began > now) {
    return { startedAt: new Date(now).toISOString(), words: stats.words };
  }
  if (now - began > SESSION_GAP_MS) {
    return { startedAt: new Date(now).toISOString(), words: stats.words };
  }
  return existing;
}

/**
 * Whether the file's record needs rewriting. It compares the two objects
 * rather than re-deriving the condition, so `sessionFor` holds the one rule
 * for when a session ends.
 */
export function sessionChanged(
  existing: WritingSession | null,
  next: WritingSession,
): boolean {
  return (
    existing?.startedAt !== next.startedAt || existing?.words !== next.words
  );
}

export interface Ledger {
  /** When this sitting began. */
  since: string | null;
  /**
   * Words written since. Negative when the writer cut more than they added;
   * cutting is writing, so the Desk signs the number rather than hiding it.
   */
  gained: number;
  /** When the project was last counted, the last time anything was saved. */
  lastWrite: string | null;
  words: number;
  sections: number;
}

export function ledger(stats: DocumentStats, session: WritingSession): Ledger {
  return {
    since: session.startedAt,
    gained: stats.words - session.words,
    // A falsy stamp is no stamp, so the component skips the span rather than
    // printing "last written " with nothing after it.
    lastWrite: stats.countedAt || null,
    words: stats.words,
    sections: stats.sections,
  };
}
