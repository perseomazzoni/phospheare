// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  SESSION_GAP_MS,
  ledger,
  sessionChanged,
  sessionFor,
} from "./deskLedger";
import type { DocumentStats } from "../project/types";

// Pins the ledger's delta. A total is not news: "61,240 words" is the same
// sentence every morning, and a writer coming back needs what they did last
// time and what has happened since.

const NOW = Date.parse("2026-03-10T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const stats = (over: Partial<DocumentStats> = {}): DocumentStats => ({
  words: 61_240,
  parts: 3,
  sections: 12,
  countedAt: iso(NOW - 60_000),
  perNode: [],
  ...over,
});

describe("sessionFor", () => {
  it("opens a session when the project has never had one", () => {
    const next = sessionFor(null, stats(), NOW);
    expect(next).toEqual({ startedAt: iso(NOW), words: 61_240 });
  });

  // Closing a tab and reopening it is the same sitting. A reload that reset the
  // baseline would erase a morning's work from the one number reporting it.
  it("stays in the session the writer is already in", () => {
    const existing = { startedAt: iso(NOW - 90 * 60_000), words: 60_000 };
    expect(sessionFor(existing, stats(), NOW)).toBe(existing);
  });

  it("holds the session right up to the gap", () => {
    const existing = { startedAt: iso(NOW - SESSION_GAP_MS), words: 60_000 };
    expect(sessionFor(existing, stats(), NOW)).toBe(existing);
  });

  it("starts a new one after a long enough absence", () => {
    const existing = {
      startedAt: iso(NOW - SESSION_GAP_MS - 1),
      words: 60_000,
    };
    expect(sessionFor(existing, stats(), NOW)).toEqual({
      startedAt: iso(NOW),
      words: 61_240,
    });
  });

  it("refuses a stamp it cannot read", () => {
    expect(
      sessionFor({ startedAt: "yesterday-ish", words: 10 }, stats(), NOW).words,
    ).toBe(61_240);
  });

  // A file off a machine whose clock runs fast would otherwise hold the
  // baseline open forever, and every day's work would report as one sitting.
  it("refuses a stamp from the future", () => {
    const existing = { startedAt: iso(NOW + 60_000), words: 10 };
    expect(sessionFor(existing, stats(), NOW)).toEqual({
      startedAt: iso(NOW),
      words: 61_240,
    });
  });
});

describe("sessionChanged", () => {
  it("is true when there was none", () => {
    expect(sessionChanged(null, { startedAt: iso(NOW), words: 1 })).toBe(true);
  });

  it("is false for the session that was already there", () => {
    const existing = { startedAt: iso(NOW), words: 1 };
    expect(sessionChanged(existing, existing)).toBe(false);
  });

  it("is true once the baseline has moved", () => {
    expect(
      sessionChanged(
        { startedAt: iso(NOW - 1), words: 1 },
        { startedAt: iso(NOW), words: 1 },
      ),
    ).toBe(true);
  });
});

describe("ledger", () => {
  it("reports the delta, then the totals that give it scale", () => {
    const result = ledger(stats(), {
      startedAt: iso(NOW - 3 * 60 * 60_000),
      words: 60_000,
    });
    expect(result.since).toBe(iso(NOW - 3 * 60 * 60_000));
    expect(result.gained).toBe(1_240);
    expect(result.lastWrite).toBe(iso(NOW - 60_000));
    expect(result.words).toBe(61_240);
    expect(result.sections).toBe(12);
  });

  // Cutting is writing. A writer who spent the morning taking out four hundred
  // words did the work, and a ledger that showed them zero would be lying.
  it("signs a loss rather than hiding it", () => {
    const result = ledger(stats({ words: 59_600 }), {
      startedAt: iso(NOW),
      words: 60_000,
    });
    expect(result.gained).toBe(-400);
  });

  it("says nothing about a count with no usable stamp", () => {
    const result = ledger(stats({ countedAt: "" }), {
      startedAt: iso(NOW),
      words: 0,
    });
    expect(result.lastWrite).toBeNull();
  });
});
