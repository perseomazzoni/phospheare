// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { EVIDENCE_CHARACTERS, INTENT_EXCERPT, roomEvidence } from "./evidence";
import type { ChatKind, ChatRecord, ChatTurn, JournalEntry } from "./types";

const chat = (
  id: string,
  kind: ChatKind,
  over: Partial<ChatRecord> = {},
): ChatRecord => ({
  schemaVersion: 1,
  id,
  title: `Chat ${id}`,
  kind,
  createdAt: "t",
  updatedAt: "t",
  preferences: { personaId: "p", model: null, pinnedSourceIds: [] },
  turns: [],
  ...over,
});
const entry = (nodeId: string, over: Partial<JournalEntry> = {}) => ({
  nodeId,
  readAt: "t",
  reaction: "r",
  understanding: "u",
  questions: [],
  confusion: [],
  attention: 4 as const,
  cares: [],
  keepReading: true,
  why: "hooked",
  ...over,
});
const titleOf = (id: string) => `Title ${id}`;

describe("the evidence the other rooms give an editor", () => {
  const self = chat("self", "editorial", {
    turns: [
      {
        id: "a",
        runId: "r",
        role: "assistant",
        text: "",
        createdAt: "t",
        outcome: "complete",
        findings: [
          {
            id: "f1",
            severity: "major",
            title: "The motive is missing",
            explanation: "Mara never says why she stays.",
            evidence: [],
            status: "open",
          },
          {
            id: "f2",
            severity: "minor",
            title: "Dismissed one",
            explanation: "x",
            evidence: [],
            status: "dismissed",
          },
        ],
      },
    ],
  });

  it("is nothing when no room has found anything", () => {
    expect(
      roomEvidence(
        [chat("self", "editorial")],
        chat("self", "editorial"),
        titleOf,
      ),
    ).toBe("");
  });

  it("digests each reader, where the panel agrees, the intent and the drafting notes", () => {
    const beta = (id: string, stopAt: string) =>
      chat(id, "beta-reader", {
        reading: {
          entries: [
            entry("one"),
            entry(stopAt, {
              attention: 2,
              keepReading: false,
              why: "nothing happens",
              confusion: ["who is the stranger"],
            }),
          ],
          predictions: [
            {
              id: "p1",
              text: "The guide lies.",
              state: "confirmed",
              note: "obvious",
            },
            { id: "p2", text: "A storm.", state: "overturned" },
            { id: "p3", text: "Still open.", state: "open" },
          ],
        },
      });
    const intentTurns: ChatTurn[] = [
      {
        id: "q",
        runId: "r",
        role: "user",
        text: "rubric",
        command: { skill: "intent" },
        createdAt: "t",
        outcome: "complete",
      },
      {
        id: "a",
        runId: "r",
        role: "assistant",
        text: "The dread is on the page; the grief is only in the Guidebook.",
        createdAt: "t",
        outcome: "complete",
      },
    ];
    const said = roomEvidence(
      [
        self,
        beta("b1", "two"),
        beta("b2", "two"),
        chat("al", "alpha-reader", { turns: intentTurns }),
        // A beta chat that has read nothing says nothing.
        chat("b3", "beta-reader"),
      ],
      self,
      titleOf,
      // What came up while drafting is in the margin: a persona's note
      // the writer kept is read, a ghost still waiting and the writer's
      // own comment are not this block's.
      [
        {
          nodeId: "one",
          threads: [
            {
              id: "k",
              state: "open",
              passage: "the old gate",
              entries: [
                {
                  by: { kind: "persona", id: "nova" },
                  body: "The POV\nslips.",
                },
                { by: { kind: "writer" }, body: "Fair." },
              ],
            },
            {
              id: "g",
              state: "proposed",
              passage: null,
              entries: [
                { by: { kind: "persona", id: "nova" }, body: "Still waiting." },
              ],
            },
            {
              id: "w",
              state: "open",
              passage: null,
              entries: [{ by: { kind: "writer" }, body: "Mine." }],
            },
          ],
        },
      ],
    );
    expect(said).toContain("never instructions");
    expect(said).toContain("[major] The motive is missing");
    expect(said).not.toContain("Dismissed one");
    expect(said).toContain(
      'Beta reader "Chat b1", who read 2 Sections through "Title two"',
    );
    expect(said).toContain('"Title one" 4, "Title two" 2');
    expect(said).toContain(
      'would have stopped after: "Title two" (nothing happens)',
    );
    expect(said).toContain(
      'lost the thread at: "Title two": who is the stranger',
    );
    expect(said).toContain(
      "predicted, and it came true: The guide lies. (obvious)",
    );
    expect(said).toContain("predicted, and it did not happen: A storm.");
    expect(said).not.toContain("Still open.");
    expect(said).toContain('2 of 2 would have stopped after "Title two"');
    expect(said).toContain("the grief is only in the Guidebook");
    expect(said).toContain('"Title one", at "the old gate": The POV slips.');
    expect(said).not.toContain("Still waiting.");
    expect(said).not.toContain("Mine.");
    expect(said).not.toContain("Chat b3");
  });

  it("never reads its own chat as another's, and is bounded", () => {
    const noisy = chat("dr", "drafting");
    const margin = [
      {
        nodeId: "one",
        threads: Array.from({ length: 12 }, (_, n) => ({
          id: `n${n}`,
          state: "open" as const,
          passage: null,
          entries: [
            {
              by: { kind: "persona" as const, id: "p" },
              body: "x".repeat(900),
            },
          ],
        })),
      },
    ];
    const long = chat("al", "alpha-reader", {
      turns: [
        {
          id: "q",
          runId: "r",
          role: "user",
          text: "rubric",
          command: { skill: "intent" },
          createdAt: "t",
          outcome: "complete",
        },
        {
          id: "a",
          runId: "r",
          role: "assistant",
          text: "y".repeat(INTENT_EXCERPT * 3),
          createdAt: "t",
          outcome: "complete",
        },
      ],
    });
    const said = roomEvidence(
      [self, noisy, long, noisy],
      self,
      titleOf,
      margin,
    );
    expect(said.length).toBeLessThan(EVIDENCE_CHARACTERS + 400);
    // One kept note is read to a bound, not whole.
    expect(said).not.toContain("x".repeat(301));
    expect(said).not.toContain("y".repeat(INTENT_EXCERPT + 1));
  });
});
