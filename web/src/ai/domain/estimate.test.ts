// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { estimateRequestTokens } from "./estimate";
import type { ModelRequest } from "./types";

const base = (): ModelRequest => ({
  model: { providerId: "stub", modelId: "test" },
  instructions: "hello",
  messages: [{ role: "assistant", content: "hi" }],
  tools: [],
  limits: { inputTokens: 1_000, outputTokens: 500 },
});

describe("request estimate", () => {
  it("counts the provider blocks a tool step replays", () => {
    const before = estimateRequestTokens(base()).tokens;
    const request = base();
    request.messages[0].blocks = [
      { type: "reasoning", text: "thinking ".repeat(10_000) },
    ];
    const after = estimateRequestTokens(request).tokens;
    // A block the size of a chapter must move the estimate by about as much:
    // an unmoved estimate admits a request the runtime then truncates from
    // the front, where the instructions are.
    expect(after).toBeGreaterThan(before + 10_000);
  });

  it("counts an empty block list as nothing", () => {
    const request = base();
    request.messages[0].blocks = [];
    expect(estimateRequestTokens(request)).toEqual(
      estimateRequestTokens(base()),
    );
  });
});
