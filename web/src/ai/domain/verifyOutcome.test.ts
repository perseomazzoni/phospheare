// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  judged,
  workflowAnswer,
  type ChatTurn,
  type VerifyOutcome,
} from "./types";

// The stored answer of `/verify`.

describe("judged", () => {
  it("is true for a verdict, false for either reason nothing was judged", () => {
    const outcomes: Array<[VerifyOutcome, boolean]> = [
      [{ verdict: "plausible", sources: [] }, true],
      [{ verdict: "inconclusive", sources: [] }, true],
      [{ unjudged: "unchecked" }, false],
      [{ unjudged: "nothing-found" }, false],
    ];
    for (const [outcome, expected] of outcomes)
      expect(judged(outcome)).toBe(expected);
  });
});

describe("workflowAnswer", () => {
  const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
    id: "a",
    role: "assistant",
    text: "",
    createdAt: "2026-09-27T10:00:00.000Z",
    outcome: "complete",
    ...over,
  });

  it("keys /verify on its marker, so a check with no verdict is still one", () => {
    // Without the marker, an interrupted or invalid `/verify` has nothing
    // that says it is a workflow's answer, and could be edited into a
    // question.
    expect(
      workflowAnswer(turn({ verifies: true, outcome: "interrupted" })),
    ).toBe(true);
    expect(
      workflowAnswer(
        turn({
          verifies: true,
          outcome: "failed",
          errorCode: "invalid-response",
        }),
      ),
    ).toBe(true);
    expect(
      workflowAnswer(
        turn({ verifies: true, verified: { unjudged: "unchecked" } }),
      ),
    ).toBe(true);
  });

  it("still names every other workflow's answer, and nothing else", () => {
    expect(
      workflowAnswer(
        turn({ located: { passages: [] } as unknown as ChatTurn["located"] }),
      ),
    ).toBe(true);
    expect(
      workflowAnswer(turn({ mapped: {} as unknown as ChatTurn["mapped"] })),
    ).toBe(true);
    expect(workflowAnswer(turn({ summarisedPart: { nodeId: "n" } }))).toBe(
      true,
    );
    expect(workflowAnswer(turn())).toBe(false);
    // `verified` alone is not the marker: the codec keeps it only beside one.
    expect(workflowAnswer(turn({ verified: { unjudged: "unchecked" } }))).toBe(
      false,
    );
  });
});
