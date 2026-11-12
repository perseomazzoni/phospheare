// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { endingOf } from "./turnEnding";

describe("how a step's ending becomes the turn's outcome", () => {
  it.each([
    ["answer", { outcome: "complete" }],
    ["tools", { outcome: "complete" }],
    ["stop-sequence", { outcome: "complete" }],
    ["cancelled", { outcome: "interrupted", errorCode: "cancelled" }],
    ["limit", { outcome: "interrupted", errorCode: "output-limit" }],
    ["refusal", { outcome: "failed", errorCode: "refusal" }],
  ] as const)("maps %s", (reason, expected) => {
    expect(endingOf(reason)).toEqual(expected);
  });

  it("gives a complete turn no code at all, so the placeholder's cannot survive", () => {
    expect("errorCode" in endingOf("answer")).toBe(false);
  });
});
