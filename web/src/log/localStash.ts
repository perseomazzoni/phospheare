// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { LineStash, StoredLine } from "./application/logger";

// The log's stash for the moment a page goes: localStorage writes at once,
// where IndexedDB's writes do not finish. It holds a few lines until the next
// start writes them to the log; it is this browser's, like the log itself.

const KEY = "writer-log:unwritten";

function isLine(value: unknown): value is StoredLine {
  const line = value as Partial<StoredLine> | null;
  return (
    typeof line?.size === "number" &&
    typeof line.entry?.at === "number" &&
    typeof line.entry.message === "string"
  );
}

/** The lines in `raw`, the stash's text; none when it is absent or damaged. */
function parse(raw: string | null): StoredLine[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    return [];
  }
}

export function localLineStash(): LineStash {
  return {
    save(lines) {
      // Lines a page saved before this one and that no start has taken yet
      // stay in front of them. They are read, not taken: a write that fails,
      // as a full storage does, leaves them where they are.
      const kept = parse(localStorage.getItem(KEY));
      localStorage.setItem(KEY, JSON.stringify([...kept, ...lines]));
    },
    take() {
      let raw: string | null;
      try {
        raw = localStorage.getItem(KEY);
        localStorage.removeItem(KEY);
      } catch {
        return [];
      }
      return parse(raw);
    },
  };
}
