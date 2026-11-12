// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  NO_READING,
  attentionCurve,
  foldReading,
  nextSection,
  readingPosition,
} from "./reading";
import {
  READING_LIMITS,
  type JournalEntry,
  type ReadingRecord,
  type SourceDescriptor,
} from "./types";

const section = (nodeId: string): SourceDescriptor => ({
  id: `node:${nodeId}`,
  kind: "manuscript",
  title: nodeId,
  path: `document/${nodeId}.md`,
  nodeId,
  nodeKind: "section",
  authority: "manuscript",
  revision: "r",
});
const part: SourceDescriptor = {
  ...section("part"),
  nodeKind: "part",
};
const note: SourceDescriptor = {
  id: "note:a",
  kind: "note",
  title: "A note",
  path: "notes/a.md",
  authority: "reference",
  revision: "r",
};
const entry = (nodeId: string, over: Partial<JournalEntry> = {}) =>
  ({
    nodeId,
    readAt: "2026-09-28T10:00:00.000Z",
    reaction: "r",
    understanding: "u",
    questions: [],
    confusion: [],
    attention: 3,
    cares: [],
    keepReading: true,
    why: "w",
    ...over,
  }) satisfies JournalEntry;

describe("reading in order", () => {
  const catalog = [
    part,
    section("one"),
    note,
    section("two"),
    section("three"),
  ];

  it("starts at the first Section, never a Part or a note", () => {
    expect(nextSection(catalog, undefined)?.nodeId).toBe("one");
    expect(nextSection(catalog, NO_READING)?.nodeId).toBe("one");
    expect(nextSection([part, note], undefined)).toBeNull();
  });

  it("reads the Section after the last one it holds, and ends at the last", () => {
    const read = (...ids: string[]): ReadingRecord => ({
      entries: ids.map((id) => entry(id)),
      predictions: [],
    });
    expect(nextSection(catalog, read("one"))?.nodeId).toBe("two");
    expect(nextSection(catalog, read("one", "two", "three"))).toBeNull();
    // An entry whose Section is gone is stepped over.
    expect(nextSection(catalog, read("one", "gone"))?.nodeId).toBe("two");
    // A Section moved behind the reader is not read a second time, and one
    // already read after a reorder is skipped.
    expect(nextSection(catalog, read("two"))?.nodeId).toBe("three");
    expect(
      nextSection(
        [section("one"), section("three"), section("two")],
        read("one", "two"),
      ),
    ).toBeNull();
    expect(readingPosition(read("one", "two"))).toBe("two");
    expect(readingPosition(undefined)).toBeNull();
  });

  it("offers no next Section once the journal is full, which could never journal it", () => {
    const ids = Array.from(
      { length: READING_LIMITS.entries + 1 },
      (_, at) => `s${at}`,
    );
    const book = ids.map((id) => section(id));
    const full: ReadingRecord = {
      entries: ids.slice(0, READING_LIMITS.entries).map((id) => entry(id)),
      predictions: [],
    };
    const last = ids[READING_LIMITS.entries];
    // Folding the next Section in changes nothing, so offering it again
    // would read the same Section on every run.
    expect(
      foldReading(full, { entry: entry(last), at: "x" }).entries,
    ).toHaveLength(READING_LIMITS.entries);
    expect(nextSection(book, full)).toBeNull();
  });
});

describe("folding an answer into the reading", () => {
  const at = "2026-09-28T11:00:00.000Z";

  it("journals, writes new predictions, and settles open ones by id", () => {
    const first = foldReading(undefined, {
      entry: entry("one"),
      predictions: ["A", "B"],
      madeAt: "one",
      at,
    });
    expect(first.entries).toHaveLength(1);
    expect(first.predictions).toEqual([
      { id: "p1", text: "A", madeAt: "one", state: "open" },
      { id: "p2", text: "B", madeAt: "one", state: "open" },
    ]);
    const second = foldReading(first, {
      entry: entry("two"),
      settled: [
        { id: "p1", state: "confirmed", note: " Saw it coming. " },
        // Still open, with a note: kept open, the note kept.
        { id: "p2", state: "open", note: "Maybe." },
        // One the ledger does not hold is dropped.
        { id: "p9", state: "overturned" },
      ],
      predictions: ["C"],
      madeAt: "two",
      at,
    });
    expect(second.predictions).toEqual([
      {
        id: "p1",
        text: "A",
        madeAt: "one",
        state: "confirmed",
        resolvedAt: "two",
        note: "Saw it coming.",
      },
      { id: "p2", text: "B", madeAt: "one", state: "open", note: "Maybe." },
      { id: "p3", text: "C", madeAt: "two", state: "open" },
    ]);
    // A settled prediction stays settled.
    const third = foldReading(second, {
      settled: [{ id: "p1", state: "overturned" }],
      at,
    });
    expect(third.predictions[0].state).toBe("confirmed");
    expect(third.predictions.map((one) => one.state)).toEqual([
      "confirmed",
      "open",
      "open",
    ]);
  });

  it("never hands out an id twice, even after a lost row", () => {
    const record: ReadingRecord = {
      entries: [],
      predictions: [{ id: "p3", text: "kept", state: "open" }],
    };
    expect(
      foldReading(record, { predictions: ["new"], at }).predictions[1].id,
    ).toBe("p4");
  });

  it("stops at its caps, keeping the oldest", () => {
    const full: ReadingRecord = {
      entries: Array.from({ length: READING_LIMITS.entries }, (_, n) =>
        entry(`n${n}`),
      ),
      predictions: Array.from(
        { length: READING_LIMITS.predictions },
        (_, n) => ({
          id: `p${n + 1}`,
          text: "t",
          state: "open" as const,
        }),
      ),
    };
    const folded = foldReading(full, {
      entry: entry("late"),
      predictions: ["late"],
      at,
    });
    expect(folded.entries).toHaveLength(READING_LIMITS.entries);
    expect(folded.entries[0].nodeId).toBe("n0");
    expect(folded.predictions).toHaveLength(READING_LIMITS.predictions);
  });

  it("draws the curve, marking where the reader would stop", () => {
    const reading: ReadingRecord = {
      entries: [
        entry("one", { attention: 4 }),
        entry("two", { attention: 2, keepReading: false }),
      ],
      predictions: [],
    };
    expect(attentionCurve(reading)).toEqual([
      { nodeId: "one", attention: 4, putDown: false },
      { nodeId: "two", attention: 2, putDown: true },
    ]);
    expect(attentionCurve(undefined)).toEqual([]);
  });
});
