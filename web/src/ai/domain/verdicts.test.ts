// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ChatTurn, EvidenceAnchor, Finding } from "./types";
import { keptVerdicts } from "./verdicts";

// "Review again" replaces an answer in place, and the writer's verdicts on
// it travel to a new finding only when it stands on the same evidence.
// A wrong carry hides a claim and a wrong drop costs one click, so
// every doubt reopens.

const a: EvidenceAnchor = { sourceId: "one", quote: "Marta left at dawn." };
const b: EvidenceAnchor = { sourceId: "two", quote: "Marta was home by noon." };
const c: EvidenceAnchor = {
  sourceId: "three",
  quote: "The road took two days.",
};

function finding(
  id: string,
  evidence: EvidenceAnchor[],
  status: Finding["status"] = "open",
): Finding {
  return {
    id,
    severity: "minor",
    title: `Finding ${id}`,
    explanation: "",
    evidence,
    status,
  };
}

function answer(findings: Finding[]): ChatTurn {
  return {
    id: "turn",
    role: "assistant",
    text: "",
    createdAt: "2026-09-25T00:00:00.000Z",
    findings,
  } as ChatTurn;
}

describe("keptVerdicts", () => {
  it("carries a verdict to a finding on the same anchors, in any order", () => {
    const old = answer([
      finding("x", [a, b], "dismissed"),
      finding("y", [c], "resolved"),
    ]);
    const kept = keptVerdicts(old, [finding("n1", [b, a]), finding("n2", [c])]);
    expect(kept.map((f) => f.status)).toEqual(["dismissed", "resolved"]);
    // The new finding is the model's; only the status is the writer's.
    expect(kept[0].id).toBe("n1");
  });

  it("reopens a superset, a subset, and a single shared anchor", () => {
    const old = answer([finding("x", [a, b], "dismissed")]);
    const kept = keptVerdicts(old, [
      finding("superset", [a, b, c]),
      finding("subset", [a]),
      finding("shared", [b, c]),
    ]);
    expect(kept.map((f) => f.status)).toEqual(["open", "open", "open"]);
  });

  it("never matches a finding with no evidence", () => {
    const old = answer([
      { ...finding("x", [], "dismissed"), title: "Same title" },
    ]);
    const kept = keptVerdicts(old, [
      { ...finding("n", []), title: "Same title" },
    ]);
    expect(kept[0].status).toBe("open");
  });

  it("carries only the writer's verdicts, never open or stale", () => {
    const old = answer([finding("x", [a], "stale"), finding("y", [b], "open")]);
    const kept = keptVerdicts(old, [finding("n1", [a]), finding("n2", [b])]);
    expect(kept.map((f) => f.status)).toEqual(["open", "open"]);
  });

  it("keeps a verdict when only the revision changed", () => {
    const old = answer([finding("x", [{ ...a, revision: "r1" }], "resolved")]);
    const kept = keptVerdicts(old, [finding("n", [{ ...a, revision: "r2" }])]);
    expect(kept[0].status).toBe("resolved");
  });

  it("treats the evidence as a set: a repeated or padded anchor still matches", () => {
    const old = answer([finding("x", [a, b], "dismissed")]);
    const kept = keptVerdicts(old, [
      finding("repeated", [a, a, b]),
      finding("padded", [{ ...a, quote: `  ${a.quote}\n` }, b]),
    ]);
    expect(kept.map((f) => f.status)).toEqual(["dismissed", "dismissed"]);
  });

  it("does nothing with no answer to replace", () => {
    const fresh = [finding("n", [a])];
    expect(keptVerdicts(undefined, fresh)).toEqual(fresh);
  });
});
