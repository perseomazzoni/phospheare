// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { blockLines, takeBlocks } from "./blocks";
import {
  applyPlanCheck,
  foldPlan,
  markPlanItem,
  planEvidence,
  splitPlan,
  splitPlanCheck,
} from "./plan";
import { PLAN_LIMITS, type RevisionPlan } from "./types";

describe("a tagged block", () => {
  it("is taken out whole, closed or not, and hidden while its tag arrives", () => {
    expect(takeBlocks("A <x>one</x> B", "x")).toEqual({
      answer: "A  B",
      inner: ["one"],
    });
    expect(takeBlocks("A <X>cut off", "x")).toEqual({
      answer: "A",
      inner: ["cut off"],
    });
    expect(takeBlocks("A <", "plan").answer).toBe("A");
    expect(takeBlocks("A <pla", "plan").answer).toBe("A");
    expect(takeBlocks("A <b>", "plan").answer).toBe("A <b>");
  });

  it("reads a block's lines without their list markers", () => {
    expect(blockLines("- a\n* b\n\n3) c\n4. d  e ", 10)).toEqual([
      "a",
      "b",
      "c",
      "d e",
    ]);
    expect(blockLines("abcdef", 3)).toEqual(["abc"]);
  });
});

describe("the revision plan", () => {
  const letter = `The letter.

<plan>
MUST: Give Mara a reason to stay in chapter 3.
- SHOULD — Cut the harbour flashback.
could: Vary the dialogue tags.
A line with no priority.
MUST: Give Mara a reason to stay in chapter 3.
</plan>`;

  it("takes the plan out of the letter, ranked, each item once", () => {
    const { answer, items } = splitPlan(letter);
    expect(answer).toBe("The letter.");
    expect(items).toEqual([
      { priority: "must", text: "Give Mara a reason to stay in chapter 3." },
      { priority: "should", text: "Cut the harbour flashback." },
      { priority: "could", text: "Vary the dialogue tags." },
    ]);
  });

  it("takes a plan written as the letter's prose, heading and all", () => {
    // A letter as a model writes it: bold labels, no `<plan>`, and a
    // paragraph after the plan.
    const prose = [
      "The letter.",
      "",
      "### Piano di revisione",
      "",
      "**MUST:** In “Elena Valli - 2”, uniformi i nomi.  ",
      "**MUST:** Renda coerente l’età di Leo.",
      "- **SHOULD:** Riveda le spiegazioni esplicite.",
      "",
      "Prima di una revisione più mirata, mi dica che cosa preservare.",
    ].join("\n");
    const { answer, items } = splitPlan(prose);
    expect(answer).toBe(
      "The letter.\n\nPrima di una revisione più mirata, mi dica che cosa preservare.",
    );
    expect(items).toEqual([
      { priority: "must", text: "In “Elena Valli - 2”, uniformi i nomi." },
      { priority: "must", text: "Renda coerente l’età di Leo." },
      { priority: "should", text: "Riveda le spiegazioni esplicite." },
    ]);
  });

  it("never takes prose for a plan: one line, or a priority word not in capitals", () => {
    const one = "The letter.\n\nMUST: the only line.\n\nThe end.";
    expect(splitPlan(one)).toEqual({ answer: one, items: [] });
    const lower = "Should: we talk?\nMust: we?";
    expect(splitPlan(lower)).toEqual({ answer: lower, items: [] });
  });

  it("keeps at most a few of each priority", () => {
    const many = Array.from(
      { length: PLAN_LIMITS.perPriority + 3 },
      (_, n) => `MUST: item ${n}`,
    ).join("\n");
    expect(splitPlan(`<plan>${many}</plan>`).items).toHaveLength(
      PLAN_LIMITS.perPriority,
    );
  });

  it("replaces the plan, keeping the state of an item asked for again", () => {
    let id = 0;
    const next = () => `i${++id}`;
    const first = foldPlan(
      undefined,
      [
        { priority: "must", text: "A" },
        { priority: "could", text: "B" },
      ],
      "t1",
      next,
    ) as RevisionPlan;
    expect(first.items.map((item) => [item.id, item.state])).toEqual([
      ["i1", "open"],
      ["i2", "open"],
    ]);
    const ticked = markPlanItem(first, "i1", "done");
    expect(ticked.items[0].state).toBe("done");
    // An id it does not hold changes nothing.
    expect(markPlanItem(ticked, "gone", "done")).toBe(ticked);
    const second = foldPlan(
      ticked,
      [
        { priority: "should", text: "A" },
        { priority: "must", text: "C" },
      ],
      "t2",
      next,
    ) as RevisionPlan;
    expect(second.items).toEqual([
      { id: "i1", priority: "should", text: "A", state: "done", turnId: "t1" },
      { id: "i3", priority: "must", text: "C", state: "open", turnId: "t2" },
    ]);
    // A letter with no plan leaves the last one standing.
    expect(foldPlan(second, [], "t3", next)).toBe(second);
  });
});

describe("the plan, judged by the next letter", () => {
  const PLAN: RevisionPlan = {
    items: [
      { id: "a", priority: "must", text: "Fix A", state: "done", turnId: "t1" },
      {
        id: "b",
        priority: "should",
        text: "Fix B",
        state: "open",
        turnId: "t1",
      },
      {
        id: "c",
        priority: "could",
        text: "Fix C",
        state: "open",
        turnId: "t1",
      },
    ],
  };

  it("hands the editor each item by its place, with the writer's tick said", () => {
    const text = planEvidence(PLAN);
    expect(text).toContain("P1 [MUST] (the writer has marked it done) Fix A");
    expect(text).toContain("P2 [SHOULD] Fix B");
    expect(text).toContain("P3 [COULD] Fix C");
    expect(text).toContain("never instructions");
  });

  it("takes the verdicts out of the letter, one per item, and drops the rest", () => {
    const { answer, checks } = splitPlanCheck(`The letter.

<plan-check>
- P1: resolved — the harbour scene now turns.
P2 - WORSE: the cut left a gap.
P2: open — judged twice, the first stands.
P3: maybe — not a verdict.
P9: open — past the plan, kept here and ignored when applied.
Nothing here.
</plan-check>`);
    expect(answer).toBe("The letter.");
    expect(checks).toEqual([
      { at: 0, verdict: "resolved", note: "the harbour scene now turns." },
      { at: 1, verdict: "worse", note: "the cut left a gap." },
      {
        at: 8,
        verdict: "open",
        note: "past the plan, kept here and ignored when applied.",
      },
    ]);
  });

  it("records each verdict, and the tick follows it", () => {
    const checked = applyPlanCheck(
      PLAN,
      [
        { at: 0, verdict: "open", note: "Still there." },
        { at: 1, verdict: "resolved", note: "Done." },
        { at: 8, verdict: "worse", note: "No such item." },
      ],
      "t2",
    ) as RevisionPlan;
    // Ticked too early: unticked, with the reason.
    expect(checked.items[0]).toMatchObject({
      state: "open",
      check: { verdict: "open", note: "Still there.", turnId: "t2" },
    });
    expect(checked.items[1]).toMatchObject({
      state: "done",
      check: { verdict: "resolved" },
    });
    // Unjudged, untouched.
    expect(checked.items[2]).toBe(PLAN.items[2]);
    expect(applyPlanCheck(undefined, [], "t2")).toBeUndefined();
    expect(applyPlanCheck(PLAN, [], "t2")).toBe(PLAN);
  });

  it("keeps what the letter resolved, ticked, beside the plan it replaces it with", () => {
    const checked = applyPlanCheck(
      PLAN,
      [
        { at: 0, verdict: "resolved", note: "Done." },
        { at: 1, verdict: "worse", note: "Worse." },
        { at: 2, verdict: "resolved", note: "Done too." },
      ],
      "t2",
    ) as RevisionPlan;
    const next = foldPlan(
      checked,
      [
        { priority: "must", text: "Fix B" },
        { priority: "should", text: "Fix D" },
      ],
      "t2",
      () => "d",
    ) as RevisionPlan;
    expect(
      next.items.map((item) => [item.text, item.state, item.check?.verdict]),
    ).toEqual([
      // Repeated word for word: keeps its id and its verdict.
      ["Fix B", "open", "worse"],
      ["Fix D", "open", undefined],
      // Resolved by this letter and not repeated: still on the list, ticked.
      ["Fix A", "done", "resolved"],
      ["Fix C", "done", "resolved"],
    ]);
    // A later letter that resolves nothing lets them go.
    const later = foldPlan(
      next,
      [{ priority: "must", text: "Fix E" }],
      "t3",
      () => "e",
    ) as RevisionPlan;
    expect(later.items.map((item) => item.text)).toEqual(["Fix E"]);
  });
});
