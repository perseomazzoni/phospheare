// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The step loop ────────────────────────────────────────────────────────────
//
// A chat turn and a margin reply both answer by this loop: ask the
// model, run what it calls, hand the results back, and ask again until it
// answers or a ceiling ends it, then one closing call without tools.
// Everything a run does around the loop (the dock's activity line, the
// turn's receipts and trace, the chat file) stays with the caller, reached
// through the `sink`. The loop owns the order of things and the ceilings.

import type {
  ModelMessage,
  ModelRequest,
  RunUsage,
  SourceDescriptor,
  ToolCall,
} from "../domain/types";
import { searchedTerms, shownSourceId } from "../domain/trace";
import type { ModelProvider } from "../ports";
import type { RunBudget } from "./budgets";
import { endingOf, type TurnEnding } from "./turnEnding";
import {
  ModelRunError,
  mergeUsage,
  runStep,
  throwIfCancelled,
  type StepOptions,
} from "./runStep";
import {
  callSignature,
  executeTool,
  searchCandidates,
  toolMessage,
  type ToolContext,
} from "./tools";
import type { SearchPause } from "./searchAsk";
import { webRoom } from "./webResults";
import { appLog, describeError } from "../../log";

/** What the caller does around the loop, as it happens. */
export interface ToolLoopSink {
  /**
   * A step is about to be asked: the first, the next after its calls have
   * answered, or the closing one. Nothing has come back of it yet.
   */
  stepStarted(): void;
  /**
   * The step ended in calls, so what it wrote was said on the way to the
   * answer and is not the answer.
   */
  saidOnTheWay(text: string): void;
  /** A call is about to run; named before it runs, for the wait it is. */
  calling(call: ToolCall): void;
  /** A call settled, with what goes back to the model. */
  settled(call: ToolCall, value: unknown): void;
}

export interface ToolLoopRun {
  provider: ModelProvider;
  request: Omit<ModelRequest, "messages">;
  /** The conversation so far; the loop appends its steps to a copy. */
  messages: readonly ModelMessage[];
  budget: Pick<RunBudget, "steps" | "toolCallsPerRun" | "toolCallsPerStep">;
  toolContext: ToolContext;
  /** The run's web-search pause, where the run may search at all. */
  pause: SearchPause | null;
  signal: AbortSignal;
  step: StepOptions;
  sink: ToolLoopSink;
}

export interface ToolLoopResult {
  /** The answer: the last step's prose, or what arrived before a Stop. */
  text: string;
  ending: TurnEnding;
  usage: RunUsage;
}

export async function runToolLoop(run: ToolLoopRun): Promise<ToolLoopResult> {
  const { provider, budget, toolContext, pause, signal, sink } = run;
  const conversation = [...run.messages];
  const seenCalls = new Set<string>();
  let toolCalls = 0;
  let usage: RunUsage = { steps: 0 };
  let textOut = "";
  /**
   * How the run ended (`turnEnding.ts`): complete, or interrupted or failed
   * with the code that says why (the writer's Stop, the output allowance, a
   * refusal). One value for both the ordinary step and the closing call, so
   * neither can store a cut-off answer as a finished one.
   */
  let ending: TurnEnding = { outcome: "complete" };
  /** Which ceiling ended the loop, if one did; drives the closing call. */
  let exhausted: "step" | "tool-call" | null = null;
  const stepOptions: StepOptions = {
    ...run.step,
    onText: async (partial) => {
      textOut = partial;
      await run.step.onText?.(partial);
    },
  };

  // ── One request-assembly seam ──────────────────────────────────────────────
  //
  // The loop's steps and the closing tool-free call both assemble their
  // request here, so a field such as the size guard cannot land on one and
  // not the other. The closing call follows the last round of tool results,
  // so it is the largest request the run makes.
  //
  // A request over the limit is refused: a runtime that drops tokens off the
  // front of an over-long prompt (`budgets.ts`, the headroom) would answer
  // with `PROSE_BOUNDARY` silently gone.
  const assemble = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
    ...run.request,
    messages: conversation,
    ...overrides,
  });
  const requestFor = async (
    overrides: Partial<ModelRequest> = {},
  ): Promise<ModelRequest> => {
    const request = assemble(overrides);
    const size = await provider.estimate(request);
    if (size.tokens > request.limits.inputTokens)
      throw new ModelRunError({
        code: "context-too-large",
        message:
          "The assembled context does not fit this model configuration. Narrow the scope or choose a larger resource preset.",
        retryable: false,
      });
    return request;
  };

  for (let step = 0; step < budget.steps; step += 1) {
    throwIfCancelled(signal);
    sink.stepStarted();
    const result = await runStep(
      provider,
      await requestFor(),
      signal,
      stepOptions,
    );
    usage = mergeUsage(usage, result.usage);
    if (result.reason === "cancelled") {
      ending = endingOf(result.reason);
      // Only prose that arrived, never a stand-in such as "Stopped.": stored
      // as the answer it would be English in every locale, and replayed to
      // the model as something it had said. The ending's code carries the
      // fact, worded by the locale.
      textOut = result.text || textOut;
      break;
    }
    if (result.calls.length === 0) {
      // Zero calls ends the run but does not prove an answer: a step cut off
      // by the output allowance, or one the model declined, also ends with
      // no calls. The reason says which, through one table.
      ending = endingOf(result.reason);
      textOut = result.text.trim();
      break;
    }
    // The step ended in calls, so what it wrote was said on the way, not
    // the answer: the caller moves it aside in the same write that clears
    // it from the answer, so there is no frame with it in both or in
    // neither.
    textOut = "";
    sink.saidOnTheWay(result.text);
    // One slice serves the message and the loop: every call the assistant
    // message lists gets its answer, or the next request carries calls with
    // none, which a vendor refuses.
    const room = Math.max(0, budget.toolCallsPerRun - toolCalls);
    const executed = result.calls.slice(
      0,
      Math.min(budget.toolCallsPerStep, room),
    );
    conversation.push({
      role: "assistant",
      content: result.text,
      toolCalls: executed,
      // Whatever the provider needs handed back unchanged, such as a thinking
      // model's reasoning block. The application does not look inside; it
      // replays the step with it, because a tool loop that drops it asks the
      // model to continue from a turn it cannot remember taking.
      ...(result.blocks.length > 0 ? { blocks: result.blocks } : {}),
    });
    // ── Four phases of a step ────────────────────────────────────────────────
    //
    // A search waits on the writer, not on the reads. (A) The step's own
    // reads run first, in order, and are recorded as they settle. (B) Its
    // searches are asked about, sent and re-asked by the pause, which reads
    // what (A) showed the model. (C) Their results are fitted into the room
    // (A) left. (D) Every answer goes back in call order. A step with no
    // search is (A) then (D).
    const values = new Map<ToolCall, unknown>();
    const searches = executed.filter((call) => call.name === "web_search");
    // Stop is checked before every call, not only at the step's top: a call
    // such as `leave_comments` acts on the book, and one the writer stopped
    // must not run after it.
    for (const call of executed) {
      if (call.name === "web_search") continue;
      throwIfCancelled(signal);
      const signature = callSignature(call);
      sink.calling(call);
      let value: unknown;
      // The run cap counts attempts, not distinct calls: a model looping on
      // one repeated call must terminate like any other runaway.
      toolCalls += 1;
      if (seenCalls.has(signature)) {
        value = { error: "repeated-tool-call" };
      } else {
        seenCalls.add(signature);
        try {
          value = await executeTool(call, toolContext);
        } catch (error) {
          if (!signal.aborted)
            appLog.warn("ai", "A tool call failed.", {
              tool: call.name,
              ...describeError(error),
            });
          value = {
            error: "tool-failed",
            message: error instanceof Error ? error.message : "failed",
          };
        }
      }
      values.set(call, value);
      sink.settled(call, value);
    }
    if (searches.length > 0) {
      toolCalls += searches.length;
      // The loop judges and the pause asks: repeats are the loop's to answer
      // and its seen set is the loop's to write, and a prepared call is never
      // judged again.
      const { rows, repeats } = searchCandidates(searches, seenCalls);
      for (const row of rows) seenCalls.add(row.signature);
      let prepared = new Map<ToolCall, unknown>();
      if (pause && rows.length > 0) {
        // What the window has left once this step's reads are in.
        const size = await provider.estimate(
          assemble({
            messages: [
              ...conversation,
              ...executed
                .filter((call) => values.has(call))
                .map((call) => toolMessage(call, values.get(call))),
            ],
          }),
        );
        // Outside every per-call catch: Stop, or an account that changed
        // under the run, ends the run rather than one call.
        prepared = await pause.searchesFor(
          rows,
          webRoom(run.request.limits.inputTokens - size.tokens),
        );
      }
      const settled = prepared;
      const searchContext: ToolContext = pause
        ? { ...toolContext, preparedSearch: (call) => settled.get(call) }
        : toolContext;
      for (const call of searches) {
        throwIfCancelled(signal);
        const value = repeats.has(call)
          ? { error: "repeated-tool-call" }
          : await executeTool(call, searchContext);
        values.set(call, value);
        sink.settled(call, value);
      }
    }
    for (const call of executed)
      conversation.push(toolMessage(call, values.get(call)));
    if (toolCalls >= budget.toolCallsPerRun) {
      exhausted = "tool-call";
      break;
    }
    if (step === budget.steps - 1) exhausted = "step";
  }

  // ── The model has the last word ────────────────────────────────────────────
  //
  // A ceiling does not end the run on the last step's results: the writer
  // would get the half-sentence that accompanied the last tool call. One more
  // inference runs with the tools withdrawn, so the model answers from what
  // it already gathered. The tools stay declared with `toolChoice` none,
  // since the conversation it answers from names them.
  if (exhausted && ending.outcome === "complete") {
    throwIfCancelled(signal);
    sink.stepStarted();
    const closing = await runStep(
      provider,
      // The ceiling is announced as a message, not appended to
      // `instructions`. The instruction block is the most stable part of a
      // request ordered by rate of change; editing it here would
      // invalidate the cached prefix on the run's most expensive call.
      await requestFor({
        toolChoice: "none",
        messages: [
          ...conversation,
          {
            role: "user",
            content: `You have reached this answer's ${exhausted} limit and can no longer call tools. Answer now from what you have already read, and say plainly which parts of the request you could not reach.`,
          },
        ],
      }),
      signal,
      stepOptions,
    );
    usage = mergeUsage(usage, closing.usage);
    // The closing call is the largest request of the run and the one most
    // likely to end on the output allowance, so its reason goes through the
    // same table as the ordinary step's: a closing answer cut mid-sentence is
    // interrupted, a refusal is a failure.
    ending = endingOf(closing.reason);
    if (closing.reason === "cancelled") {
      textOut = closing.text || textOut;
    } else if (closing.text.trim()) {
      textOut = closing.text.trim();
    } else if (ending.outcome === "complete") {
      // The closing call produced nothing, so the notice is the answer:
      // there is no answer to show instead.
      ending = { outcome: "interrupted" };
      textOut =
        `${textOut.trim()}\n\nThe assistant reached its ${exhausted} limit before it could answer.`.trim();
    }
  }
  return { text: textOut, ending, usage };
}

/**
 * What a tool call is working on, in words a writer recognises: the
 * source's title, never its id, or a search's own terms. Everything else gets
 * no subject. The result is a spreadable object, so an absent subject never
 * becomes the key `subject: undefined` in a published record.
 */
export function callSubject(
  // The model's arguments may be anything, and the run must not fail while
  // describing itself.
  args: unknown,
  catalog: readonly SourceDescriptor[],
): { subject?: string } {
  if (typeof args !== "object" || args === null) return {};
  const { sourceId } = args as Record<string, unknown>;
  if (typeof sourceId === "string") {
    const source = catalog.find((one) => one.id === sourceId);
    if (source) return { subject: source.title };
    // An id that names nothing: the line names what the model asked for,
    // cleaned for display (`shownSourceId`).
    const shown = shownSourceId(sourceId);
    return shown ? { subject: shown } : {};
  }
  const terms = searchedTerms(args);
  return terms ? { subject: terms } : {};
}
