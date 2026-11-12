// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ChatTurn } from "../../ai/domain/types";
import { turnActions, turnFacts } from "./turnActions";

// Pins which actions an answer offers, decided in one place: a run going
// withholds everything that would act under it, the last turn alone offers
// Try again and the key's remedy, and a workflow's question is never edited.

const turn = (over: Partial<ChatTurn>): ChatTurn =>
  ({ id: "t", role: "assistant", text: "", ...over }) as ChatTurn;

const asked = turn({ id: "q1", role: "user", runId: "r1", text: "Why?" });
const answered = turn({ id: "a1", runId: "r1" });

describe("an answer's actions", () => {
  it("offers Try again on the last answer to a question, and only between runs", () => {
    const facts = turnFacts([asked, answered], false, 0);
    expect(turnActions(facts, answered).retry).toBe(true);
    expect(turnActions(facts, asked).retry).toBe(false);
    const running = turnFacts([asked, answered], true, 0);
    expect(turnActions(running, answered).retry).toBe(false);
  });

  it("offers no Try again under a run with no question behind it", () => {
    const review = turn({ id: "a2", runId: "review-1" });
    const facts = turnFacts([asked, answered, review], false, 0);
    expect(facts.lastWasAsked).toBe(false);
    expect(turnActions(facts, review).retry).toBe(false);
  });

  it("edits a question only while nothing runs or waits, and never a workflow's", () => {
    const facts = turnFacts([asked, answered], false, 0);
    expect(turnActions(facts, asked).edit).toBe(true);
    expect(
      turnActions(turnFacts([asked, answered], false, 1), asked).edit,
    ).toBe(false);
    expect(turnActions(turnFacts([asked, answered], true, 0), asked).edit).toBe(
      false,
    );
    const where = turn({ id: "q2", role: "user", runId: "w1", text: "/where" });
    const located = turn({
      id: "a3",
      runId: "w1",
      located: {} as ChatTurn["located"],
    });
    const withWorkflow = turnFacts([where, located], false, 0);
    if (!withWorkflow.workflowRuns.has("w1"))
      throw new Error("a /where answer should count as a workflow's");
    expect(turnActions(withWorkflow, where).edit).toBe(false);
  });

  it("offers the key's remedy on the last turn only", () => {
    const facts = turnFacts([asked, answered], true, 0);
    expect(turnActions(facts, answered).renew).toBe(true);
    expect(turnActions(facts, answered).last).toBe(true);
    expect(turnActions(facts, asked).renew).toBe(false);
  });

  it("completes a run's answer and maps again only between runs", () => {
    const mapped = turn({
      id: "a4",
      runId: "m1",
      mapped: {} as ChatTurn["mapped"],
    });
    const idle = turnActions(turnFacts([mapped], false, 0), mapped);
    expect(idle).toMatchObject({
      completeSearch: true,
      completeReview: true,
      completeMap: true,
      mapWith: true,
      openRoute: true,
    });
    const busy = turnActions(turnFacts([mapped], true, 0), mapped);
    expect(busy).toMatchObject({
      completeSearch: false,
      completeReview: false,
      completeMap: false,
      mapWith: false,
      openRoute: false,
    });
    const plain = turnActions(turnFacts([asked], false, 0), turn({ id: "x" }));
    expect(plain.completeMap).toBe(false);
    expect(plain.mapWith).toBe(false);
  });
});
