// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// How a step's ending becomes the turn's outcome. A step ends for one of six
// reasons (`CompletionReason`, plus the app's own `cancelled`), and the turn
// the writer keeps has three outcomes and a code. The ordinary step and the
// closing tool-free call both read this one table, so a reason cannot be
// mapped at one site and forgotten at the other. A step cut off mid-sentence
// must never be stored as `complete`: it would read as finished, and Retry
// would never be offered.
//
// - `limit` is interrupted, never failed: what arrived is the model's own
//   prose, cut where the output allowance ran out, and the writer reads it
//   under a banner saying it was cut, with a Try again. The code is
//   `output-limit` because `interrupted` already means "the editor closed
//   while it was being written", and a writer who closed nothing would go
//   looking for what did.
// - `refusal` is failed with the code `refusal`: the model declined, which is
//   neither an answer nor a cut-off one. The words it declined in stay as the
//   turn's text, since they are what the writer was told. It is not
//   `provider-rejected`, which says the request did not go through; here it
//   went through and was answered with a no.
// - `stop-sequence` is an answer: ending where a sequence said to is a way of
//   finishing, not of stopping short.

import type { ChatTurn, ModelFailureCode } from "../domain/types";
import type { StepResult } from "./runStep";

export interface TurnEnding {
  outcome: ChatTurn["outcome"];
  /** Absent on a complete turn: the placeholder's code must not survive. */
  errorCode?: ModelFailureCode;
}

/** The turn's outcome and code for the reason a step stopped. */
export function endingOf(reason: StepResult["reason"]): TurnEnding {
  switch (reason) {
    case "cancelled":
      return { outcome: "interrupted", errorCode: "cancelled" };
    case "limit":
      return { outcome: "interrupted", errorCode: "output-limit" };
    case "refusal":
      return { outcome: "failed", errorCode: "refusal" };
    case "answer":
    case "tools":
    case "stop-sequence":
      return { outcome: "complete" };
  }
}
