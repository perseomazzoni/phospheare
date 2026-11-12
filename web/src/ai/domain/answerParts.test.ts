// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { partsOf, replanned, shownOf } from "./answerParts";
import type { RevisionPlan } from "./types";

// Each chat kind holds back only its own blocks: what the writer reads of an
// answer, as it streams and once it ends.

const SECTIONS = new Set(["s5"]);

const DRAFTING = `Here is the passage.

<for-later>
- The POV slips in line 3.
</for-later>

<room>beta-reader through node:s5</room>`;

const LETTER = `The letter.

<plan>
MUST: Fix B
SHOULD: Fix D
</plan>

<plan-check>
P1: resolved — done.
</plan-check>`;

describe("an answer as it streams", () => {
  it("hides a drafting answer's notes and its pointer", () => {
    expect(shownOf("drafting", DRAFTING)).toBe("Here is the passage.");
    // A block still arriving is hidden too.
    expect(shownOf("drafting", "Help.\n<for-later>\n- half a no")).toBe(
      "Help.",
    );
  });

  it("hides an editor's plan and its verdicts", () => {
    expect(shownOf("editorial", LETTER)).toBe("The letter.");
  });

  it("hides the general chat's pointer, and nothing else", () => {
    expect(shownOf("general", "Ask a reader.\n<room>beta-reader</room>")).toBe(
      "Ask a reader.",
    );
    expect(shownOf("general", "<plan>MUST: x</plan>")).toContain("<plan>");
  });

  it("shows a reader's answer as it is", () => {
    for (const kind of ["alpha-reader", "beta-reader"] as const)
      expect(shownOf(kind, LETTER)).toBe(LETTER);
  });
});

describe("an ended answer's parts", () => {
  it("takes a drafting answer's notes and its pointer out", () => {
    const parts = partsOf("drafting", DRAFTING, SECTIONS);
    expect(parts.answerText).toBe("Here is the passage.");
    expect(parts.held?.notes).toHaveLength(1);
    expect(parts.routed?.route).toEqual({ kind: "beta-reader", through: "s5" });
    expect(parts.planned).toBeNull();
    expect(parts.checked).toBeNull();
  });

  it("sets a reader to read only through a Section the book holds", () => {
    const parts = partsOf(
      "general",
      "Ask.\n<room>beta-reader through node:s9</room>",
      SECTIONS,
    );
    expect(parts.answerText).toBe("Ask.");
    expect(parts.routed?.route).toEqual({ kind: "beta-reader" });
    expect(parts.held).toBeNull();
  });

  it("takes an editor's plan and verdicts out", () => {
    const parts = partsOf("editorial", LETTER, SECTIONS);
    expect(parts.answerText).toBe("The letter.");
    expect(parts.planned?.items).toEqual([
      { priority: "must", text: "Fix B" },
      { priority: "should", text: "Fix D" },
    ]);
    expect(parts.checked?.checks).toEqual([
      { at: 0, verdict: "resolved", note: "done." },
    ]);
    expect(parts.routed).toBeNull();
  });

  it("keeps a reader's answer whole, trimmed", () => {
    const parts = partsOf("beta-reader", `  ${LETTER}\n\n`, SECTIONS);
    expect(parts).toEqual({
      held: null,
      planned: null,
      checked: null,
      routed: null,
      answerText: LETTER,
    });
  });
});

describe("the plan after an ended letter", () => {
  const PLAN: RevisionPlan = {
    items: [
      { id: "a", priority: "must", text: "Fix A", state: "open", turnId: "t1" },
    ],
  };

  it("records the verdicts on the old items, then folds the new plan over them", () => {
    const next = replanned(
      PLAN,
      partsOf("editorial", LETTER, SECTIONS),
      "t2",
      () => "n",
    ) as RevisionPlan;
    expect(
      next.items.map((item) => [item.text, item.state, item.check?.verdict]),
    ).toEqual([
      ["Fix B", "open", undefined],
      ["Fix D", "open", undefined],
      // Resolved by this letter and not repeated: still on the list, ticked.
      ["Fix A", "done", "resolved"],
    ]);
  });

  it("leaves the plan as it is when the letter has none", () => {
    const parts = partsOf("editorial", "Only a letter.", SECTIONS);
    expect(replanned(PLAN, parts, "t2", () => "n")).toBe(PLAN);
    expect(replanned(undefined, parts, "t2", () => "n")).toBeUndefined();
  });
});
