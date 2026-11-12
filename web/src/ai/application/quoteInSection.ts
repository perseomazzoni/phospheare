// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  EvidenceAnchor,
  ModelDescriptor,
  ModelRef,
  RunUsage,
  SourceDescriptor,
  SourceText,
  ToolDefinition,
} from "../domain/types";
import { ANCHOR_CONTEXT_MAX, ANCHOR_QUOTE_MAX } from "../domain/types";
import { STANDARD, samplingFields } from "../domain/mode";
import type { ModelProvider, ProjectSources } from "../ports";
import { budgetFor, limitsFor } from "./budgets";
import { oneLine } from "./context";
import { mergeUsage, runStep, stoppedIf, throwIfCancelled } from "./runStep";
import { planSegments } from "./reviewProject";
import { anchorState } from "./validateEvidence";

// Finds a quote in one Section, for `/where` and `/map`, which share these
// mechanics so the verification cannot drift. The Section is read window by
// window, and the model answers through one quote tool and nothing else.
//
// A quote counts only if it is found, uniquely, in the text the model was
// shown, never in the lead beside it, so a quote copied out of a description
// or a reason is not a reading of the passage. It must be found again in the
// Section as it reads now, since the writer may have typed during the run.

/** A judge's answer is one short tool call. */
const QUOTE_OUTPUT_TOKENS = 1_000;

export interface QuoteDependencies {
  sources: ProjectSources;
  model: ModelProvider;
  modelRef: ModelRef;
}

export interface QuoteRequest {
  node: SourceDescriptor;
  /** Everything the step is told: briefing, question and quoting rules. */
  instructions: string;
  /** The one quote tool this step may call, and no other. */
  tool: ToolDefinition;
  /**
   * The line the passage is read beside, `/where`'s description before it or
   * `/map`'s reason after it, already JSON-quoted by the caller so nothing in
   * it can close a delimiter and speak as the app.
   */
  lead: string;
  leadAfter?: boolean;
  /**
   * The most windows a Section may take. A longer Section is not read at all
   * and gets no quote: `/map` reads one window per anchor, and a quote from
   * a Section's first window is not evidence about the rest.
   */
  maxWindows?: number;
  /** What a Stop mid-step is called, in the caller's words. */
  stopped: string;
}

/**
 * The quote a tool asks for, as schema properties: the passage and the
 * context that tells it from a repeat. Shared so the words a model reads
 * about quoting cannot drift between tools. The caller describes `quote`.
 */
export function quoteFields(quote: string): Record<string, unknown> {
  return {
    quote: { type: "string", description: quote },
    prefix: {
      type: "string",
      description:
        "Only if the quote appears more than once: the few words just before it.",
    },
    suffix: {
      type: "string",
      description:
        "Only if the quote appears more than once: the few words just after it.",
    },
  };
}

/** A quote the editor can show as one passage: one paragraph, not blank. */
function oneParagraph(quote: string): boolean {
  return quote.trim().length > 0 && !/\n\s*\n/.test(quote);
}

/**
 * A model's quote as an anchor, when it could be one passage the editor
 * shows, before anything checks that it exists. Context the model left
 * empty is dropped, not kept as an empty match.
 */
export function anchorOf(
  sourceId: string,
  fields: { quote?: unknown; prefix?: unknown; suffix?: unknown },
): EvidenceAnchor | null {
  if (typeof fields.quote !== "string") return null;
  if (!oneParagraph(fields.quote) || fields.quote.length > ANCHOR_QUOTE_MAX)
    return null;
  return {
    sourceId,
    quote: fields.quote,
    ...(typeof fields.prefix === "string" && fields.prefix
      ? { prefix: fields.prefix }
      : {}),
    ...(typeof fields.suffix === "string" && fields.suffix
      ? { suffix: fields.suffix }
      : {}),
  };
}

function anchorFrom(sourceId: string, args: unknown): EvidenceAnchor | null {
  const raw = args as {
    found?: unknown;
    quote?: unknown;
    prefix?: unknown;
    suffix?: unknown;
  } | null;
  if (raw?.found !== true) return null;
  return anchorOf(sourceId, raw);
}

/**
 * The anchor as it is kept: stamped with the revision it was verified
 * against, and carrying context only where the Section needs it to tell the
 * quote from a repeat of it, clipped to the characters nearest the quote,
 * which sit right against it and still verify. A model's context is often a
 * whole paragraph, and the chat file bounds it.
 */
function kept(anchor: EvidenceAnchor, live: SourceText): EvidenceAnchor {
  const { prefix, suffix, ...bare } = anchor;
  const match = { ...bare, revision: live.revision };
  if (anchorState(bare, live.text) === "verified") return match;
  return {
    ...match,
    ...(prefix ? { prefix: prefix.slice(-ANCHOR_CONTEXT_MAX) } : {}),
    ...(suffix ? { suffix: suffix.slice(0, ANCHOR_CONTEXT_MAX) } : {}),
  };
}

/**
 * The anchor as kept, when it reads uniquely in what the model was shown
 * and again in the Section as it reads now; `null` otherwise. A quote
 * repeated elsewhere in the live Section would land the editor on the wrong
 * one.
 */
export function acceptQuote(
  anchor: EvidenceAnchor,
  shown: string,
  live: SourceText,
): EvidenceAnchor | null {
  if (anchorState(anchor, shown) !== "verified") return null;
  if (anchorState(anchor, live.text) !== "verified") return null;
  return kept(anchor, live);
}

/**
 * Read `node` window by window until the model quotes a passage that
 * verifies; `null` when none does. One anchor per Section.
 */
export async function quoteInSection(
  dependencies: QuoteDependencies,
  descriptor: ModelDescriptor,
  request: QuoteRequest,
  signal: AbortSignal,
): Promise<{ match: EvidenceAnchor | null; usage: RunUsage }> {
  const { node } = request;
  const limits = limitsFor(descriptor, QUOTE_OUTPUT_TOKENS);
  const capture: SourceText = await dependencies.sources.read(node.id);
  // Windows net of the lead, which rides beside every one of them; a window
  // planned as if it were alone would push the step past the room
  // `budgetFor` measured. Every lead is bounded well under the smallest
  // window (`KNOWN_NAMES_CHARACTERS`, `LOCATE_SENTENCE_MAX`,
  // `MAP_REASON_MAX`), so this never nears 0.
  const segments = planSegments(
    node.id,
    capture.text,
    budgetFor(descriptor).sourceCharacters - request.lead.length,
  );
  let usage: RunUsage = { steps: 0 };
  if (request.maxWindows !== undefined && segments.length > request.maxWindows)
    return { match: null, usage };
  for (const segment of segments) {
    throwIfCancelled(signal);
    const shown = capture.text.slice(segment.start, segment.end);
    const passage = `PASSAGE from ${node.id} | ${oneLine(node.title)}\n${shown}`;
    const result = await runStep(
      dependencies.model,
      {
        model: dependencies.modelRef,
        instructions: request.instructions,
        messages: [
          {
            role: "user",
            content: request.leadAfter
              ? `${passage}\n\n${request.lead}`
              : `${request.lead}\n\n${passage}`,
          },
        ],
        tools: [request.tool],
        limits,
        ...samplingFields(STANDARD, descriptor),
      },
      signal,
    );
    usage = mergeUsage(usage, result.usage);
    stoppedIf(result.reason, request.stopped);
    const call = result.calls.find((one) => one.name === request.tool.name);
    const anchor = call ? anchorFrom(node.id, call.arguments) : null;
    // The live read happens only for a quote the model did read here: it is
    // async, and a window's answer is most often "not in this passage".
    if (!anchor || anchorState(anchor, shown) !== "verified") continue;
    const match = acceptQuote(
      anchor,
      shown,
      await dependencies.sources.read(node.id),
    );
    if (match) return { match, usage };
  }
  return { match: null, usage };
}
