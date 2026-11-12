// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  appendThought,
  capTrace,
  recordToolCall,
  setStepText,
  TRACE_MAX_CHARS,
  traceFacts,
  traceOf,
  traceRows,
} from "./trace";
import type {
  ChatTurn,
  ModelFailureCode,
  ToolReceipt,
  TurnTrace,
  WebEngine,
  WebReach,
  WebSearchRecord,
} from "./types";

// The cap bounds what reaches the transcript or the file: a model
// can reason for minutes, and nothing else bounds it.

const textOf = (trace: TurnTrace) =>
  trace.steps.map((step) => step.reasoning + (step.text ?? "")).join("");

describe("a turn's reasoning", () => {
  it("accumulates the pieces in order", () => {
    const first = appendThought(undefined, 0, "Weighing the chapter. ");
    expect(appendThought(first, 0, "Then the scene.")).toEqual({
      steps: [
        { reasoning: "Weighing the chapter. Then the scene.", toolCallIds: [] },
      ],
    });
  });

  it("keeps the most recent part when it runs past the cap, and says so", () => {
    const long = appendThought(undefined, 0, "a".repeat(TRACE_MAX_CHARS));
    expect(long.trimmed).toBeUndefined();

    const over = appendThought(long, 0, "THE LATEST");
    expect(textOf(over)).toHaveLength(TRACE_MAX_CHARS);
    expect(textOf(over).endsWith("THE LATEST")).toBe(true);
    expect(over.trimmed).toBe(true);
  });

  it("stays marked as trimmed once its start is gone", () => {
    const trimmed: TurnTrace = {
      steps: [{ reasoning: "tail", toolCallIds: [] }],
      trimmed: true,
    };
    expect(appendThought(trimmed, 0, " more")).toEqual({
      steps: [{ reasoning: "tail more", toolCallIds: [] }],
      trimmed: true,
    });
  });

  it("never starts on half of a character", () => {
    // One emoji is two UTF-16 units. A cut between them would leave a lone
    // low surrogate first, which draws as a replacement box.
    const filler = "a".repeat(TRACE_MAX_CHARS - 1);
    const cut = appendThought(undefined, 0, `😀${filler}b`);
    expect(cut.trimmed).toBe(true);
    const first = textOf(cut).charCodeAt(0);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    expect(textOf(cut).endsWith("b")).toBe(true);
  });
});

describe("a turn's trace", () => {
  it("keeps each step's working, prose and calls in the order they happened", () => {
    let trace = appendThought(undefined, 0, "Need chapter one.");
    trace = setStepText(trace, 0, "Let me check.");
    trace = recordToolCall(trace, 0, "read-1");
    trace = appendThought(trace, 1, "It says tofu.");
    expect(trace.steps).toEqual([
      {
        reasoning: "Need chapter one.",
        text: "Let me check.",
        toolCallIds: ["read-1"],
      },
      { reasoning: "It says tofu.", toolCallIds: [] },
    ]);
  });

  it("cuts across steps from the front, and never drops a step or a call", () => {
    const half = Math.floor(TRACE_MAX_CHARS / 2);
    let trace = appendThought(undefined, 0, "x".repeat(half));
    trace = setStepText(trace, 0, "y".repeat(half));
    trace = recordToolCall(trace, 0, "read-1");
    trace = appendThought(trace, 1, "z".repeat(half));

    expect(trace.trimmed).toBe(true);
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]?.reasoning).toBe("");
    expect(trace.steps[0]?.toolCallIds).toEqual(["read-1"]);
    expect(textOf(trace)).toHaveLength(TRACE_MAX_CHARS);
    expect(textOf(trace).endsWith("z")).toBe(true);
  });

  it("stays within the cap however the pieces arrive", () => {
    const sequences = [
      [TRACE_MAX_CHARS + 1],
      [10, TRACE_MAX_CHARS, 10],
      [TRACE_MAX_CHARS / 2, TRACE_MAX_CHARS / 2, TRACE_MAX_CHARS / 2],
    ];
    for (const sizes of sequences) {
      let trace: TurnTrace | undefined;
      sizes.forEach((size, at) => {
        trace = appendThought(trace, at, "q".repeat(size));
      });
      expect(textOf(trace as TurnTrace).length).toBeLessThanOrEqual(
        TRACE_MAX_CHARS,
      );
    }
  });

  it("leaves a trace under the cap exactly as it was", () => {
    const trace: TurnTrace = {
      steps: [{ reasoning: "short", toolCallIds: ["a"] }],
    };
    expect(capTrace(trace)).toBe(trace);
  });
});

describe("the trace a turn renders from", () => {
  const turn = (patch: Partial<ChatTurn>): ChatTurn => ({
    id: "t",
    role: "assistant",
    text: "",
    createdAt: "2026-09-24T10:00:00.000Z",
    outcome: "complete",
    ...patch,
  });
  const receipt = (patch: Partial<ToolReceipt>): ToolReceipt => ({
    callId: "c",
    name: "read_source",
    status: "ok",
    ...patch,
  });

  it("drops the empty steps a run leaves between the ones that showed something", () => {
    const trace = traceOf(
      turn({
        trace: {
          steps: [
            { reasoning: "", toolCallIds: [] },
            { reasoning: "real", toolCallIds: [] },
          ],
        },
      }),
    );
    expect(trace?.steps).toEqual([{ reasoning: "real", toolCallIds: [] }]);
  });

  it("derives one step holding every call for a turn with calls and no trace", () => {
    const trace = traceOf(
      turn({
        tools: [
          receipt({ callId: "a" }),
          receipt({ callId: "b", name: "grep" }),
        ],
      }),
    );
    expect(trace).toEqual({
      steps: [{ reasoning: "", toolCallIds: ["a", "b"] }],
    });
  });

  it("has nothing to show for a turn with neither", () => {
    expect(traceOf(turn({}))).toBeUndefined();
  });

  it("counts distinct reads, and failures apart from what was done", () => {
    const facts = traceFacts(
      turn({
        tools: [
          receipt({ callId: "1", sourceId: "node:S1" }),
          receipt({ callId: "2", sourceId: "node:S1" }),
          receipt({ callId: "3", sourceId: "node:S2" }),
          receipt({ callId: "4", sourceId: "node:S3", status: "error" }),
          receipt({ callId: "5", name: "grep" }),
        ],
      }),
    );
    expect(facts).toEqual({
      read: 2,
      searchedProject: true,
      webEngines: new Set(),
      listed: false,
      structure: false,
      findings: false,
      failed: 1,
      thought: false,
      answeredWithoutWeb: false,
    });
  });

  it("counts as failed only a call the fold draws a row for", () => {
    // A failed findings submission, or a call to a tool that does not exist,
    // has no row: counting it would point the writer at a fold where nothing
    // failed.
    const facts = traceFacts(
      turn({
        tools: [
          receipt({ callId: "1", name: "grep", status: "error" }),
          receipt({ callId: "2", name: "submit_findings", status: "error" }),
          receipt({ callId: "3", name: "select_evidence", status: "error" }),
          receipt({ callId: "4", name: "not_a_tool", status: "error" }),
        ],
      }),
    );
    expect(facts.failed).toBe(1);
  });

  it("knows when the model showed its working", () => {
    expect(
      traceFacts(
        turn({
          trace: { steps: [{ reasoning: "hmm", toolCallIds: [] }] },
        }),
      ).thought,
    ).toBe(true);
  });
});

// ── Web search in the trace ──────────────────────────────────────────────────

describe("the trace's web rows and facts", () => {
  const WIKI = { kind: "wikipedia" } as const;
  const PAID = { kind: "provider", providerId: "openrouter" } as const;
  const turn = (patch: Partial<ChatTurn>): ChatTurn => ({
    id: "t",
    role: "assistant",
    text: "",
    createdAt: "2026-09-27T10:00:00.000Z",
    outcome: "complete",
    ...patch,
  });
  const searched = (callId: string, engine: WebEngine = WIKI) =>
    ({
      callId,
      engine,
      status: "searched",
      query: `q ${callId}`,
      results: [],
    }) as const satisfies WebSearchRecord;
  const failed = (
    callId: string,
    reached: WebReach = "no",
    code: ModelFailureCode = "rate-limited",
    engine: WebEngine = PAID,
  ) =>
    ({
      callId,
      engine,
      status: "failed",
      query: `q ${callId}`,
      code,
      reached,
    }) as const satisfies WebSearchRecord;
  const declined = (callId: string, engine: WebEngine = WIKI) =>
    ({ callId, engine, status: "declined" }) as const satisfies WebSearchRecord;

  describe("traceRows", () => {
    it("puts each record under the step that names its call, after its tool rows", () => {
      const read: ToolReceipt = {
        callId: "r",
        name: "read_source",
        status: "ok",
      };
      const rows = traceRows(
        turn({
          tools: [read, { callId: "w", name: "web_search", status: "ok" }],
          trace: {
            steps: [
              { reasoning: "a", toolCallIds: ["r", "w"] },
              { reasoning: "b", toolCallIds: [] },
            ],
          },
          web: [failed("w"), searched("w")],
        }),
      );
      expect(rows.map((step) => step.rows)).toEqual([
        [
          { kind: "tool", receipt: read },
          { kind: "web", record: failed("w") },
          { kind: "web", record: searched("w") },
        ],
        [],
      ]);
    });

    it("never draws a web_search receipt as a tool row", () => {
      const rows = traceRows(
        turn({
          tools: [{ callId: "w", name: "web_search", status: "error" }],
        }),
      );
      expect(rows.flatMap((step) => step.rows)).toEqual([]);
    });

    it("draws each record once, under the first step that names it", () => {
      const rows = traceRows(
        turn({
          trace: {
            steps: [
              { reasoning: "a", toolCallIds: ["w"] },
              { reasoning: "b", toolCallIds: ["w"] },
            ],
          },
          web: [searched("w")],
        }),
      );
      expect(rows.map((step) => step.rows.length)).toEqual([1, 0]);
    });

    it("draws a record no step names after the last step, never drops it", () => {
      const rows = traceRows(
        turn({
          trace: { steps: [{ reasoning: "a", toolCallIds: [] }] },
          web: [declined("w")],
        }),
      );
      expect(rows[0]?.rows).toEqual([{ kind: "web", record: declined("w") }]);
      // A Stop while the ask waited: no trace at all, and still the rows.
      expect(
        traceRows(turn({ web: [declined("w")] })).flatMap((step) => step.rows),
      ).toEqual([{ kind: "web", record: declined("w") }]);
    });

    it("draws no in-flight record while the turn is live, and draws it once stored", () => {
      const inFlight = failed("w", "unknown", "interrupted");
      const at = turn({ web: [inFlight] });
      expect(traceRows(at, { live: true }).flatMap((s) => s.rows)).toEqual([]);
      expect(traceRows(at).flatMap((s) => s.rows)).toEqual([
        { kind: "web", record: inFlight },
      ]);
      // Any other failure is a fact, live or not.
      const refused = turn({ web: [failed("w")] });
      expect(
        traceRows(refused, { live: true }).flatMap((s) => s.rows),
      ).toHaveLength(1);
    });
  });

  describe("traceFacts on web records", () => {
    it("counts each search by its last attempt", () => {
      // A refused attempt the retry made good is drawn, not counted failed.
      expect(
        traceFacts(turn({ web: [failed("w"), searched("w")] })),
      ).toMatchObject({
        failed: 0,
        webEngines: new Set(["wikipedia"]),
      });
      expect(
        traceFacts(
          turn({ web: [failed("w"), failed("w", "no", "key-expired")] }),
        ).failed,
      ).toBe(1);
      // Input-tool failures still count beside them.
      expect(
        traceFacts(
          turn({
            tools: [{ callId: "r", name: "read_source", status: "error" }],
            web: [failed("w")],
          }),
        ).failed,
      ).toBe(2);
    });

    it("never counts a web_search receipt, whatever its status", () => {
      expect(
        traceFacts(
          turn({
            tools: [{ callId: "w", name: "web_search", status: "error" }],
          }),
        ).failed,
      ).toBe(0);
    });

    it("names the engines that searched, and adds no rung for a decline", () => {
      expect(
        traceFacts(turn({ web: [searched("a", PAID)] })).webEngines,
      ).toEqual(new Set(["web"]));
      expect(
        traceFacts(turn({ web: [searched("a", PAID), searched("b")] }))
          .webEngines,
      ).toEqual(new Set(["web", "wikipedia"]));
      expect(traceFacts(turn({ web: [declined("a")] }))).toMatchObject({
        webEngines: new Set(),
        failed: 0,
      });
    });

    it("says an answer came without the web only when that is the whole truth", () => {
      const without = (patch: Partial<ChatTurn>) =>
        traceFacts(turn(patch)).answeredWithoutWeb;
      // Declined, or refused before anything left: the answer is memory's.
      expect(without({ web: [declined("a")] })).toBe(true);
      expect(without({ web: [failed("a", "no")] })).toBe(true);
      // Nothing proposed: nothing to say.
      expect(without({})).toBe(false);
      // A search that answered.
      expect(without({ web: [declined("a"), searched("b")] })).toBe(false);
      // A query that may have left, anywhere in the history.
      for (const reached of ["yes", "unknown"] as const) {
        expect(without({ web: [failed("a", reached)] })).toBe(false);
        expect(
          without({ web: [failed("a", reached), declined("a")] }),
          reached,
        ).toBe(false);
      }
      // Only an answer that finished can be "answered".
      for (const outcome of ["interrupted", "failed"] as const)
        expect(without({ outcome, web: [declined("a")] }), outcome).toBe(false);
    });
  });
});

// ── Failures the fold draws ──────────────────────────────────────────────────

describe("traceFacts and traceRows: a failure the fold does not draw", () => {
  // `traceFacts.failed` counts from `traceRows`, so "count only what the
  // fold draws" holds by construction. A chat file whose trace names
  // only one of its calls (hand-edited, or planted, since `chatCodec` keeps
  // both blocks) must not show "1 step failed" over a fold with no failed
  // row in it.
  it("counts a failure only where the fold draws its row", () => {
    const turn: ChatTurn = {
      id: "t",
      role: "assistant",
      text: "",
      createdAt: "2026-09-27T10:00:00.000Z",
      outcome: "complete",
      trace: { steps: [{ reasoning: "a", toolCallIds: ["ok"] }] },
      tools: [
        { callId: "ok", name: "read_source", status: "ok" },
        { callId: "gone", name: "read_source", status: "error" },
      ],
    };
    const drawn = traceRows(turn)
      .flatMap((step) => step.rows)
      .filter((one) =>
        one.kind === "tool"
          ? one.receipt.status === "error"
          : one.record.status === "failed",
      );
    expect(drawn).toEqual([]);
    expect(traceFacts(turn).failed).toBe(drawn.length);
  });
});
