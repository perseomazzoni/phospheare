// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { WebResult } from "./types";
import { QUERY_MAX, webResultsOf } from "./webText";

/**
 * An engine's rows as anything may read them, in the engine's order.
 * Only a row of three strings is handed on; `webResultsOf` then holds it to
 * the one set of rules every row meets, whichever engine ran the search.
 */
export function normalizeSearchResults(
  rows: unknown,
  options: { host?: string } = {},
): WebResult[] {
  if (!Array.isArray(rows)) return [];
  const shaped = rows.filter((row): row is WebResult => {
    if (typeof row !== "object" || row === null) return false;
    const { url, title, excerpt } = row as Record<string, unknown>;
    return (
      typeof url === "string" &&
      typeof title === "string" &&
      typeof excerpt === "string"
    );
  });
  return webResultsOf(shaped, options);
}

/**
 * A reported cost, kept only as a finite number at least zero. Absent is
 * "not reported", never zero, which would say "free" of a figure nobody
 * stated.
 */
export function searchCost(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Whether a query may leave at all: at most `QUERY_MAX` code points, and no
 * control, format or default-ignorable character, nor a lone surrogate. Such
 * a query is refused, never stripped, so what leaves is what the writer saw.
 */
export function acceptableQuery(query: string): boolean {
  return (
    query !== "" &&
    Array.from(query).length <= QUERY_MAX &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}]/u.test(query)
  );
}

/**
 * A Wikipedia edition's language code: a primary subtag and up to two more
 * (`zh-min-nan`). No dot, so a host built from it cannot grow a label.
 */
export const WIKI_LANGUAGE = /^[a-z]{2,12}(?:-[a-z0-9]{2,12}){0,2}$/;
