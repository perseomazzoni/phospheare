// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ChatTurn } from "../../ai/domain/types";
import { nearScope, partTitleOf } from "./summarisePart";

describe("nearScope", () => {
  const open = { id: "S1", kind: "section" as const };

  it("reads the open Section's own title as `section`", () => {
    expect(nearScope({ kind: "node", nodeId: "S1" }, open)).toEqual({
      kind: "section",
    });
  });

  it("leaves every other scope as it was typed", () => {
    for (const scope of [
      { kind: "node", nodeId: "S2" },
      { kind: "part" },
      { kind: "current" },
    ] as const)
      expect(nearScope(scope, open)).toBe(scope);
    // An open Part's title is a Part, which composes.
    const part = { kind: "node", nodeId: "P1" } as const;
    expect(nearScope(part, { id: "P1", kind: "part" })).toBe(part);
    expect(nearScope(part, null)).toBe(part);
  });
});

describe("partTitleOf", () => {
  const at = "2026-09-26T00:00:00.000Z";
  const asked: ChatTurn = {
    id: "q",
    runId: "run",
    role: "user",
    text: "/summarise Book One",
    createdAt: at,
    outcome: "complete",
  };
  const answer: ChatTurn = {
    id: "a",
    runId: "run",
    role: "assistant",
    text: "The account.",
    createdAt: at,
    outcome: "complete",
    summarisedPart: { nodeId: "P1" },
  };

  it("names the Part by its live title", () => {
    const titles = new Map([["node:P1", "Book the First"]]);
    expect(partTitleOf(answer, [asked, answer], titles)).toBe("Book the First");
  });

  it("falls back to the title its question was asked with once the Part is gone", () => {
    expect(partTitleOf(answer, [asked, answer], new Map())).toBe("Book One");
  });

  it("says nothing where there is nothing true to say", () => {
    const none = new Map<string, string>();
    // Not a Part's account.
    expect(
      partTitleOf({ ...answer, summarisedPart: undefined }, [asked], none),
    ).toBeUndefined();
    // No question of its own: a turn with no run id pairs with nothing.
    const loose = { ...asked, runId: undefined };
    expect(
      partTitleOf({ ...answer, runId: undefined }, [loose], none),
    ).toBeUndefined();
    // A question that is not the command's line.
    expect(
      partTitleOf(answer, [{ ...asked, text: "Book One" }], none),
    ).toBeUndefined();
  });
});
