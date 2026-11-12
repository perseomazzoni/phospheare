// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  READING_LIMITS,
  type JournalEntry,
  type ModelDescriptor,
  type ReadingRecord,
} from "../domain/types";
import { READING_MEMORY_CHARACTERS, READING_MEMORY_ENTRIES } from "./budgets";
import {
  journalOf,
  memoryMessage,
  readOnMessage,
  readingFits,
} from "./readingJournal";

const entry = (nodeId: string, understanding: string): JournalEntry => ({
  nodeId,
  readAt: "2026-09-28T10:00:00.000Z",
  reaction: "r",
  understanding,
  questions: [],
  confusion: [],
  attention: 3,
  cares: [],
  keepReading: true,
  why: "w",
});

describe("what the reader remembers", () => {
  it("holds the back cover, its beliefs and its open predictions, by id", () => {
    const reading: ReadingRecord = {
      entries: [entry("one", "A storm is coming.")],
      predictions: [
        { id: "p1", text: "The keeper lies.", state: "open" },
        { id: "p2", text: "Settled already.", state: "confirmed" },
      ],
    };
    const said = memoryMessage({
      backCover: ["A keeper, a letter."],
      reading,
      titleOf: (id) => `Title ${id}`,
    });
    expect(said).toContain("BACK COVER:\nA keeper, a letter.");
    expect(said).toContain("- Title one: A storm is coming.");
    expect(said).toContain("- p1: The keeper lies.");
    // A settled prediction is not the reader's to settle again.
    expect(said).not.toContain("Settled already.");
    expect(
      memoryMessage({ backCover: [], reading: undefined, titleOf: String }),
    ).toBe("");
  });

  it("forgets the oldest first, by entries and by characters", () => {
    const many: ReadingRecord = {
      entries: Array.from({ length: READING_MEMORY_ENTRIES + 3 }, (_, n) =>
        entry(`n${n}`, `belief ${n}`),
      ),
      predictions: [],
    };
    const said = memoryMessage({
      backCover: [],
      reading: many,
      titleOf: String,
    });
    expect(said).not.toContain("belief 0");
    expect(said).toContain(`belief ${READING_MEMORY_ENTRIES + 2}`);

    const long = "x".repeat(READING_MEMORY_CHARACTERS / 2);
    const heavy: ReadingRecord = {
      entries: [
        entry("a", `old ${long}`),
        entry("b", `mid ${long}`),
        entry("c", "newest"),
      ],
      predictions: [],
    };
    const trimmed = memoryMessage({
      backCover: [],
      reading: heavy,
      titleOf: String,
    });
    expect(trimmed).not.toContain("old ");
    expect(trimmed).toContain("newest");
  });

  it("puts the Section to read last, by its title", () => {
    const said = readOnMessage({
      backCover: [],
      reading: undefined,
      titleOf: String,
      section: { nodeId: "one", title: "The Harbour", text: "Waves." },
      at: "",
    });
    expect(said).toBe(
      'THE SECTION YOU ARE READING NOW — "The Harbour":\nWaves.',
    );
  });
});

describe("what the app believes of a journal answer", () => {
  const open = new Set(["p1", "p2"]);
  const answer = (over: Record<string, unknown> = {}) => ({
    reaction: "  It   moved me. ",
    understanding: "A theft.",
    questions: ["Who?", "", 7, "Why?"],
    confusion: [],
    attention: 4.4,
    cares: ["Mara"],
    keep_reading: false,
    why: "Too slow.",
    settled: [
      { id: "p1", state: "confirmed", note: "Obvious." },
      { id: "p1", state: "overturned", note: "Twice." },
      { id: "p9", state: "confirmed", note: "Never shown." },
      { id: "p2", state: "maybe", note: "" },
    ],
    predictions: ["a", "b", "c", "d"],
    ...over,
  });

  it("trims, caps and defaults, and keeps only what it was shown", () => {
    const read = journalOf(answer(), "one", "at", open);
    expect(read?.entry).toMatchObject({
      nodeId: "one",
      readAt: "at",
      reaction: "It moved me.",
      questions: ["Who?", "Why?"],
      attention: 4,
      keepReading: false,
    });
    // The first settlement of an id wins; an id not shown and a state that
    // is not one are dropped.
    expect(read?.settled).toEqual([
      { id: "p1", state: "confirmed", note: "Obvious." },
    ]);
    expect(read?.predictions).toEqual(["a", "b", "c"]);
    // Attention is put back on the scale.
    expect(
      journalOf(answer({ attention: 9 }), "one", "at", open)?.entry.attention,
    ).toBe(5);
    expect(
      journalOf(answer({ attention: 0 }), "one", "at", open)?.entry.attention,
    ).toBe(1);
    // Over-long lines are cut to the bound.
    const long = journalOf(
      answer({ questions: ["q".repeat(READING_LIMITS.line + 50)] }),
      "one",
      "at",
      open,
    );
    expect(long?.entry.questions[0]).toHaveLength(READING_LIMITS.line);
  });

  it("is no entry without a reaction and a verdict", () => {
    expect(journalOf(answer({ reaction: " " }), "one", "at", open)).toBeNull();
    expect(
      journalOf(answer({ keep_reading: "yes" }), "one", "at", open),
    ).toBeNull();
    expect(
      journalOf(answer({ attention: "high" }), "one", "at", open),
    ).toBeNull();
    expect(journalOf(null, "one", "at", open)).toBeNull();
    expect(journalOf("prose", "one", "at", open)).toBeNull();
  });
});

describe("whether a reading fits the window", () => {
  const descriptor = (contextTokens: number): ModelDescriptor => ({
    id: "m",
    providerId: "p",
    label: "M",
    kind: "device",
    capabilities: { tools: true, structuredOutput: true },
    contextTokens,
  });

  it("fits a Section the window holds, and refuses one it does not", () => {
    expect(readingFits(descriptor(32_000), "read-on", "i", "short")).toBe(true);
    expect(
      readingFits(descriptor(32_000), "read-on", "i", "x".repeat(200_000)),
    ).toBe(false);
    expect(readingFits(descriptor(32_000), "predict", "i", "memory")).toBe(
      true,
    );
  });
});
