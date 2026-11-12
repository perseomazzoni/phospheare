// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  CHAT_KINDS,
  READING_LIMITS,
  type ChatKind,
  type ChatRecord,
} from "../domain/types";
import { parseChat } from "./chatCodec";

// Pins how a beta reader's journal and ledger are read back from a file
// someone else may have written.

const ENTRY = {
  nodeId: "one",
  readAt: "2026-09-28T10:00:00.000Z",
  reaction: "It moved me.",
  understanding: "A theft.",
  questions: ["Who?"],
  confusion: [],
  attention: 4,
  cares: ["Mara"],
  keepReading: true,
  why: "I want to know.",
};
const PREDICTION = {
  id: "p1",
  text: "The keeper lies.",
  madeAt: "one",
  state: "open",
};

function chatWith(
  over: {
    reading?: unknown;
    journal?: unknown;
  },
  kind: ChatKind = "beta-reader",
): ChatRecord {
  const record = {
    schemaVersion: 1,
    id: "chat",
    title: "Chat",
    kind,
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
    preferences: {
      personaId: "p",
      model: null,
      pinnedSourceIds: [],
      readerScope: { kind: "through", nodeId: "one" },
    },
    turns: [
      {
        id: "q",
        runId: "r",
        role: "user",
        text: "/read-on",
        createdAt: "2026-09-28T00:00:00.000Z",
        outcome: "complete",
      },
      {
        id: "a",
        runId: "r",
        role: "assistant",
        text: "It moved me.",
        createdAt: "2026-09-28T00:00:00.000Z",
        outcome: "complete",
        ...(over.journal !== undefined ? { journal: over.journal } : {}),
      },
    ],
    ...(over.reading !== undefined ? { reading: over.reading } : {}),
  };
  return parseChat(JSON.stringify(record));
}

describe("the stored reading", () => {
  it("keeps a reading exactly as a run writes it", () => {
    const reading = { entries: [ENTRY], predictions: [PREDICTION] };
    expect(chatWith({ reading }).reading).toEqual(reading);
  });

  it("is a beta reader's alone", () => {
    for (const kind of CHAT_KINDS)
      if (kind !== "beta-reader")
        expect(
          chatWith({ reading: { entries: [ENTRY], predictions: [] } }, kind)
            .reading,
        ).toBeUndefined();
  });

  it("drops a record that is not one, whole", () => {
    for (const reading of [
      null,
      "text",
      [],
      { entries: [] },
      { entries: {}, predictions: [] },
      { entries: [], predictions: [], extra: 1 },
    ])
      expect(chatWith({ reading }).reading).toBeUndefined();
  });

  it("drops a bad row, never the rest of the reading", () => {
    const bad = [
      { ...ENTRY, attention: 6 },
      { ...ENTRY, attention: 2.5 },
      { ...ENTRY, keepReading: "yes" },
      { ...ENTRY, nodeId: "" },
      { ...ENTRY, reaction: "x".repeat(READING_LIMITS.text + 1) },
      { ...ENTRY, questions: Array(READING_LIMITS.list + 1).fill("q") },
      { ...ENTRY, cares: ["x".repeat(READING_LIMITS.name + 1)] },
      { ...ENTRY, extra: true },
    ];
    const kept = chatWith({
      reading: { entries: [ENTRY, ...bad], predictions: [] },
    }).reading;
    expect(kept?.entries).toEqual([ENTRY]);
  });

  it("keeps each prediction id once, and only a real one", () => {
    const kept = chatWith({
      reading: {
        entries: [],
        predictions: [
          PREDICTION,
          { ...PREDICTION, text: "a twin" },
          { ...PREDICTION, id: "p0" },
          { ...PREDICTION, id: "x1" },
          { ...PREDICTION, id: "p2", state: "maybe" },
          { ...PREDICTION, id: "p3", text: "" },
          { ...PREDICTION, id: "p4", madeAt: "" },
          {
            id: "p5",
            text: "Settled.",
            state: "overturned",
            resolvedAt: "two",
            note: "Fair.",
          },
        ],
      },
    }).reading;
    expect(kept?.predictions.map((one) => one.id)).toEqual(["p1", "p5"]);
  });
});

describe("a journal turn's marker", () => {
  it("keeps a read and a prediction, as a run writes them", () => {
    expect(
      chatWith({ journal: { kind: "read", nodeId: "one" } }).turns[1].journal,
    ).toEqual({ kind: "read", nodeId: "one" });
    expect(chatWith({ journal: { kind: "predict" } }).turns[1].journal).toEqual(
      { kind: "predict" },
    );
  });

  it("drops the marker, never the turn, where it cannot be", () => {
    const dropped = (journal: unknown, kind: ChatKind = "beta-reader") => {
      const turn = chatWith({ journal }, kind).turns[1];
      expect(turn.text).toBe("It moved me.");
      return turn.journal;
    };
    expect(dropped({ kind: "read" })).toBeUndefined();
    expect(dropped({ kind: "read", nodeId: "" })).toBeUndefined();
    expect(dropped({ kind: "skim", nodeId: "one" })).toBeUndefined();
    expect(dropped({ kind: "read", nodeId: "one", x: 1 })).toBeUndefined();
    expect(
      dropped({ kind: "read", nodeId: "one" }, "editorial"),
    ).toBeUndefined();
    expect(dropped({ kind: "predict" }, "alpha-reader")).toBeUndefined();
    expect(dropped("read")).toBeUndefined();
  });
});
