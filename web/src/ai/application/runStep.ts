// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  CompletionReason,
  ModelDescriptor,
  ModelFailure,
  ModelRequest,
  RunUsage,
  ToolCall,
} from "../domain/types";
import type { ModelProvider } from "../ports";

// One inference step for every workflow. Cancellation surfaces as an outcome
// rather than a provider error.

export class ModelRunError extends Error {
  constructor(readonly failure: ModelFailure) {
    super(failure.message);
  }
}

export function mergeUsage(left: RunUsage, right: RunUsage): RunUsage {
  const inputTokens = (left.inputTokens ?? 0) + (right.inputTokens ?? 0);
  const outputTokens = (left.outputTokens ?? 0) + (right.outputTokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    // Summed only where some step said it: unknown is not zero.
    ...(left.cachedInputTokens !== undefined ||
    right.cachedInputTokens !== undefined
      ? {
          cachedInputTokens:
            (left.cachedInputTokens ?? 0) + (right.cachedInputTokens ?? 0),
        }
      : {}),
    durationMs: (left.durationMs ?? 0) + (right.durationMs ?? 0),
    steps: left.steps + right.steps,
    // The fullest request, not a sum: two half-full requests are not a full
    // window. Absent on both sides stays absent: unknown is not zero.
    ...(left.contextTokens !== undefined || right.contextTokens !== undefined
      ? {
          contextTokens: Math.max(
            left.contextTokens ?? 0,
            right.contextTokens ?? 0,
          ),
        }
      : {}),
    ...((right.contextWindow ?? left.contextWindow) !== undefined
      ? { contextWindow: right.contextWindow ?? left.contextWindow }
      : {}),
  };
}

/**
 * One request's fill of the window: its prompt and what it wrote, which
 * share it. Only when the provider reported the prompt, because a guess here
 * would be a reading the writer trusts.
 */
function withContext(usage: RunUsage): RunUsage {
  return usage.inputTokens === undefined
    ? usage
    : {
        ...usage,
        contextTokens: usage.inputTokens + (usage.outputTokens ?? 0),
      };
}

/**
 * A step that ended because Stop was pressed is a cancellation, whatever it
 * wrote first.
 */
export function stoppedIf(reason: string, message: string): void {
  if (reason === "cancelled")
    throw new ModelRunError({ code: "cancelled", message, retryable: false });
}

/** Stop cooperates with every stage, not only the streaming one. */
export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted)
    throw new ModelRunError({
      code: "cancelled",
      message: "Stopped",
      retryable: false,
    });
}

/**
 * Refuse a workflow on a model that cannot call tools, before any request is
 * made. The review and `/where` put their answer in a tool call, so on such
 * a model neither can answer at all.
 */
export function requireTools(
  descriptor: Pick<ModelDescriptor, "capabilities">,
  workflow: string,
): void {
  if (!descriptor.capabilities.tools)
    throw new ModelRunError({
      code: "capability-missing",
      message: `This model does not support tool calling, which ${workflow} requires.`,
      retryable: false,
    });
}

export interface StepResult {
  text: string;
  calls: ToolCall[];
  /** Opaque provider content to replay with the assistant message. */
  blocks: unknown[];
  usage: RunUsage;
  /**
   * The provider's own reason, plus the one the app supplies: `cancelled` is
   * the writer pressing Stop, which is a decision rather than an outcome the
   * model reported.
   */
  reason: CompletionReason | "cancelled";
}

export interface StepOptions {
  /** Called with the accumulated public text as deltas arrive. */
  onText?: (text: string) => void | Promise<void>;
  /**
   * Called with each non-empty piece of the model's working. A piece, not
   * the accumulation: the caller owns the cap. The working is not part of the
   * step's result, so nothing can read it as an answer.
   */
  onReasoning?: (piece: string) => void | Promise<void>;
  /**
   * Called once, on the step's first reasoning event of any length. The
   * OpenRouter adapter sends an empty piece when a model's working arrives
   * only encrypted, and `onReasoning` never receives it, so a status keyed to
   * `onReasoning` would say "waiting" through such a model's whole think.
   */
  onThinking?: () => void | Promise<void>;
}

/**
 * Run one inference step and normalize its events. Throws `ModelRunError`
 * for a provider failure other than cancellation; cancellation returns a
 * result with `reason: "cancelled"` and whatever text arrived, because Stop
 * is the writer's decision, not an error to report. A stream that closes
 * without a terminal event is interrupted, never success.
 */
export async function runStep(
  provider: ModelProvider,
  request: ModelRequest,
  signal: AbortSignal,
  options: StepOptions = {},
): Promise<StepResult> {
  const usage: RunUsage = { steps: 1 };
  const calls: ToolCall[] = [];
  const blocks: unknown[] = [];
  let text = "";
  let terminal: CompletionReason | null = null;
  let cancelled = false;
  let thinking = false;
  for await (const event of provider.generate(request, signal)) {
    if (event.type === "started") continue;
    if (event.type === "reasoning-delta") {
      if (!thinking) {
        thinking = true;
        await options.onThinking?.();
      }
      // An empty piece only proves the model alive, which the adapter has
      // acted on.
      if (event.text) await options.onReasoning?.(event.text);
      continue;
    }
    if (event.type === "text-delta") {
      text += event.text;
      await options.onText?.(text);
      continue;
    }
    if (event.type === "tool-call-ready") {
      calls.push(event.call);
      continue;
    }
    if (event.type === "block") {
      blocks.push(event.block);
      continue;
    }
    if (event.type === "usage") {
      usage.inputTokens = (usage.inputTokens ?? 0) + (event.inputTokens ?? 0);
      usage.outputTokens =
        (usage.outputTokens ?? 0) + (event.outputTokens ?? 0);
      if (event.cachedInputTokens !== undefined)
        usage.cachedInputTokens =
          (usage.cachedInputTokens ?? 0) + event.cachedInputTokens;
      usage.durationMs = (usage.durationMs ?? 0) + (event.durationMs ?? 0);
      usage.totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      continue;
    }
    if (event.type === "completed") {
      terminal = event.reason;
      continue;
    }
    if (event.error.code === "cancelled") cancelled = true;
    else throw new ModelRunError(event.error);
  }
  if (cancelled || (signal.aborted && terminal !== "tools"))
    return {
      text,
      calls,
      blocks,
      usage: withContext(usage),
      reason: "cancelled",
    };
  if (terminal === null)
    throw new ModelRunError({
      code: "interrupted",
      message: "The stream ended before the model finished.",
      retryable: true,
    });
  return { text, calls, blocks, usage: withContext(usage), reason: terminal };
}
