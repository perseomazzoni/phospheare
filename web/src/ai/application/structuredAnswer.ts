// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ModelDescriptor,
  ModelRequest,
  RunUsage,
  ToolDefinition,
} from "../domain/types";
import type { ModelProvider } from "../ports";
import { runStep, type StepOptions, type StepResult } from "./runStep";

// One answer in a known shape, on whichever carrier the model has: natively,
// when it can constrain its output (`capabilities.structuredOutput`), or as
// the arguments of the one tool it is offered. What an invalid answer means
// is the caller's to decide.
//
// Native comes first because a grammar is stronger than an instruction: a
// model that can hold its output to the schema answers in it, while one
// offered a tool may still answer in prose. Either way the schema is only a
// request; `validate` is where the answer is believed or not, which is why
// the caps a strict schema cannot say (lengths, counts) live there.
//
// The one-tool workflow steps (`choose_sections`, `submit_match` and others)
// read their calls in their own loops and do not go through here.

/** The answer's shape, and the one test of whether what came back is it. */
export type StructuredAnswerShape<T> = ToolDefinition & {
  /** The answer, or `null` when what came back is not one. */
  validate: (value: unknown) => T | null;
};

export interface StructuredAnswerResult<T> {
  value: T | null;
  usage: RunUsage;
  reason: StepResult["reason"];
}

export async function structuredAnswer<T>(
  model: ModelProvider,
  descriptor: Pick<ModelDescriptor, "capabilities">,
  request: Omit<ModelRequest, "tools" | "output">,
  answer: StructuredAnswerShape<T>,
  signal: AbortSignal,
  options: Pick<StepOptions, "onThinking"> = {},
): Promise<StructuredAnswerResult<T>> {
  const native = descriptor.capabilities.structuredOutput;
  const result = await runStep(
    model,
    native
      ? {
          ...request,
          tools: [],
          output: { name: answer.name, schema: answer.inputSchema },
        }
      : {
          ...request,
          tools: [
            {
              name: answer.name,
              description: answer.description,
              inputSchema: answer.inputSchema,
            },
          ],
        },
    signal,
    // Never `onText`, even from a caller that passed one past the type: the
    // answer is an object, and a half-written one shown as prose is neither.
    { onThinking: options.onThinking },
  );
  return {
    value: answer.validate(
      native
        ? parsed(result.text)
        : result.calls.find((call) => call.name === answer.name)?.arguments,
    ),
    usage: result.usage,
    reason: result.reason,
  };
}

/** The text as JSON, or `undefined`: a cut-off or chatty answer is not one. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
