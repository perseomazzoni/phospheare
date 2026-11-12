// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelRequest } from "./types";
import { CHARACTERS_PER_TOKEN } from "./ratios";

/**
 * How many tokens a request will cost, before sending it.
 *
 * Every provider shares this one estimator, because every provider sends the
 * same request; a second copy would drift without failing a test.
 *
 * The estimate leans high, never low. It is checked against an input
 * ceiling, and one looser than the real count admits a request the runtime
 * silently truncates, dropping tokens off the front of the prompt, where the
 * instructions are, while the check reports success. So it uses the budget's
 * own ratio (`domain/ratios.ts`).
 *
 * A provider that can really count does not call this.
 */
export function estimateRequestTokens(request: ModelRequest): {
  tokens: number;
  exact: boolean;
} {
  // Everything the request body carries counts. Without the tools every
  // tool-enabled run is under-counted, and without the replayed provider
  // blocks (a thinking model's reasoning) a long chain of thought grows the
  // request past the ceiling with the estimate unchanged. The blocks are
  // opaque to this layer, so they are counted as serialized.
  const characters =
    request.instructions.length +
    request.messages.reduce(
      (sum, message) =>
        sum +
        message.content.length +
        (message.toolName?.length ?? 0) +
        (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0) +
        (message.blocks?.length ? JSON.stringify(message.blocks).length : 0),
      0,
    ) +
    request.tools.reduce(
      (sum, tool) =>
        sum +
        tool.name.length +
        tool.description.length +
        JSON.stringify(tool.inputSchema).length,
      0,
    );

  return { tokens: Math.ceil(characters / CHARACTERS_PER_TOKEN), exact: false };
}
