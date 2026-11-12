// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { elapsed } from "./relativeTime";

// The words for a stamp: two readings of the same instant, because a
// conversation needs both and they are not interchangeable.
//
//   `relative`: "2 hours ago", what a person wants from a chat row or a
//   message footer, where the question is how long ago, not when.
//
//   `exact`: "16 Sep 2026, 14:32", what the relative reading throws away, and
//   the only form that compares against anything outside this app. It is the
//   tooltip under the relative one, never the resting text: a transcript of
//   forty messages each stamped with a full date is a log file.
//
// The React half of `relativeTime.ts`, which keeps the unit choice pure and
// tested in Node. The words are `Intl`'s in both readings.
//
// Both formatters are memoized on the language, because constructing an
// `Intl` formatter is not cheap and a transcript calls these once per message
// on every render.

export interface TimeWords {
  /** "2 hours ago", or "" when the stamp is unusable. */
  relative: (iso: string) => string;
  /** "16 Sep 2026, 14:32", or "" when the stamp is unusable. */
  exact: (iso: string) => string;
}

export function useTimeWords(): TimeWords {
  const { i18n } = useTranslation();
  const language = i18n.language;

  return useMemo(() => {
    const ago = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
    const on = new Intl.DateTimeFormat(language, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return {
      relative: (iso: string) => {
        // `elapsed` returns null for an unusable stamp, for the reason it
        // gives; an empty string is the caller's cue to show nothing.
        const value = elapsed(iso, Date.now());
        return value ? ago.format(value.value, value.unit) : "";
      },
      exact: (iso: string) => {
        const at = Date.parse(iso);
        return Number.isNaN(at) ? "" : on.format(at);
      },
    };
  }, [language]);
}
