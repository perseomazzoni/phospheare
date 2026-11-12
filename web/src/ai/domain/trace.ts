// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ChatTurn,
  ToolName,
  ToolReceipt,
  TraceStep,
  TurnTrace,
  WebSearchRecord,
} from "./types";
import { engineLabel } from "./webEngine";

// ── The answer's trace ───────────────────────────────────────────────────────
//
// How an answer was reached, kept apart and kept small. A reasoning model
// thinks out loud before it answers, and a tool-using one reads the project
// on its way there; the writer follows both as they happen, in the
// order they happened. What arrives is model output, the same trust
// class as the answer, but it is not the answer: it is shown apart, as plain
// text, and it never goes back to a model as history, a summary's input or
// evidence. Those exclusions hold by construction (every one of them reads
// `turn.text`), and tests pin them.
//
// It is bounded because nothing else bounds it. A model can reason
// for many minutes, the chat file has a hard ceiling (`CHAT_MAX_BYTES`), and
// a transcript is re-rendered on every streamed piece. So the trace keeps its
// most recent text, the part a writer following along is reading, and says
// when the start was dropped.
//
// Steps are addressed by index, not opened with a "begin" call: a step that
// shows nothing (the answering step of a model that does not reason) never
// becomes an entry, and one that does lands in its own slot whatever came
// before it.

/**
 * The most of one turn's text the trace keeps, in characters: thoughts and
 * step prose together, across every step.
 *
 * About eight thousand words: far more than anyone reads in a fold, and a
 * small fraction of `CHAT_MAX_BYTES` even across a long conversation.
 */
export const TRACE_MAX_CHARS = 32_000;

/**
 * The most steps a trace read back from a file may hold.
 *
 * A guard on the file's shape, not a restatement of the run's step budget
 * (which lives in the application layer and cannot be imported here): a run
 * never gets near it, and a hand-edited chat carrying ten thousand empty
 * steps is refused the chance to draw ten thousand rows.
 */
export const TRACE_MAX_STEPS = 64;

/**
 * A grep's terms as a line names them ("Leo, Leonardo"), or undefined when
 * the call carried none worth showing. The model's own words, the one part
 * of a call's arguments a writer is shown.
 */
export function searchedTerms(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const terms = (args as Record<string, unknown>).terms;
  if (!Array.isArray(terms)) return undefined;
  const shown = terms
    .filter((term): term is string => typeof term === "string")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return shown.length > 0 ? shown.join(", ") : undefined;
}

/**
 * The tools that go looking for something, and so get a row in the trace.
 *
 * `submit_findings` produces something already on screen, the findings
 * list, so a row for it would be plumbing narrated twice.
 */
export const INPUT_TOOLS: readonly ToolName[] = [
  "list_sources",
  "grep",
  "read_source",
  "inspect_structure",
  // A skill the persona chose to use: what it did, in the trace, so
  // a writer sees which method an answer followed.
  "use_skill",
];

/** The trace with more of the model's working added to step `at`. */
export function appendThought(
  trace: TurnTrace | undefined,
  at: number,
  piece: string,
): TurnTrace {
  return capTrace(
    update(trace, at, (step) => ({
      ...step,
      reasoning: step.reasoning + piece,
    })),
  );
}

/** The trace with the prose of step `at`, a step that ended in tool calls. */
export function setStepText(
  trace: TurnTrace | undefined,
  at: number,
  text: string,
): TurnTrace {
  return capTrace(update(trace, at, (step) => ({ ...step, text })));
}

/** The trace with a tool call recorded against step `at`. */
export function recordToolCall(
  trace: TurnTrace | undefined,
  at: number,
  callId: string,
): TurnTrace {
  return update(trace, at, (step) => ({
    ...step,
    toolCallIds: [...step.toolCallIds, callId],
  }));
}

/**
 * The trace cut to `TRACE_MAX_CHARS`, keeping the end.
 *
 * One pass from the front in reading order (a step's working, then its
 * prose, then the next step), because the end is what is being written now
 * and the start is what the writer has already read past. A cut never drops
 * a step or a tool call, so the rows the writer can click survive a trace
 * whose text is long gone; only the words go. `trimmed` is then true for
 * good, so the fold can say the start is missing.
 */
export function capTrace(trace: TurnTrace): TurnTrace {
  const total = trace.steps.reduce(
    (sum, step) => sum + step.reasoning.length + (step.text?.length ?? 0),
    0,
  );
  if (total <= TRACE_MAX_CHARS) return trace;
  let excess = total - TRACE_MAX_CHARS;
  const cut = (value: string): string => {
    if (excess === 0) return value;
    if (excess >= value.length) {
      excess -= value.length;
      return "";
    }
    let kept = value.slice(excess);
    excess = 0;
    // A cut between the two halves of a surrogate pair would leave half an
    // emoji at the start, which renders as a replacement box.
    const first = kept.charCodeAt(0);
    if (first >= 0xdc00 && first <= 0xdfff) kept = kept.slice(1);
    return kept;
  };
  const steps = trace.steps.map((step) => {
    const reasoning = cut(step.reasoning);
    const text = step.text === undefined ? undefined : cut(step.text);
    return {
      reasoning,
      ...(text ? { text } : {}),
      toolCallIds: step.toolCallIds,
    };
  });
  return { steps, trimmed: true };
}

/**
 * The trace a turn renders from: its own, or one step holding every call
 * for a turn that made calls and recorded no trace.
 *
 * The derived step keeps the renderer to one path: a turn written by a model
 * that never reasons still made its reads, and a turn with no recorded trace
 * still carries its receipts. Empty steps are dropped here rather than at
 * every call site.
 */
export function traceOf(turn: ChatTurn): TurnTrace | undefined {
  const steps = (turn.trace?.steps ?? []).filter(
    (step) => step.reasoning || step.text || step.toolCallIds.length > 0,
  );
  if (steps.length > 0) return { ...turn.trace, steps };
  if (turn.tools?.length)
    return {
      steps: [
        {
          reasoning: "",
          toolCallIds: turn.tools.map((receipt) => receipt.callId),
        },
      ],
    };
  return undefined;
}

// ── The rows the fold draws ──────────────────────────────────────────────────
//
// One join, read by the fold and by the facts that count it, so "count only
// what the fold draws" holds by construction rather than by two
// filters kept alike. A step's rows are its input-tool receipts and then the
// web searches its calls made, from `turn.web`, never a `web_search`
// receipt, which is bare and says less than the record beside it.

export type TraceRow =
  | { kind: "tool"; receipt: ToolReceipt }
  | { kind: "web"; record: WebSearchRecord };

export interface TraceRowStep extends TraceStep {
  rows: TraceRow[];
}

/**
 * A record written ahead of its send, not yet settled: in flight by
 * construction while the turn is live (a real cut-off ends the run). The
 * foot's live line speaks for it, and the fold states only what has
 * happened, so a live fold draws no row for it.
 */
function inFlight(record: WebSearchRecord): boolean {
  return record.status === "failed" && record.code === "interrupted";
}

/**
 * The trace's steps with the rows each one draws.
 *
 * A search's records go under the first step whose calls name them, so each
 * is drawn once: a call id is a model's or a vendor's, and two steps may name
 * the same one. A record no step names (a Stop while the ask waited, before
 * its step recorded anything) goes after the last step, never nowhere: a
 * query the writer was asked about always gets its row.
 */
export function traceRows(
  turn: ChatTurn,
  options: { live?: boolean } = {},
): TraceRowStep[] {
  const receipts = new Map(
    (turn.tools ?? []).map((receipt) => [receipt.callId, receipt]),
  );
  const pending = (turn.web ?? []).filter(
    (record) => !(options.live && inFlight(record)),
  );
  const claimed = new Set<WebSearchRecord>();
  const steps: TraceRowStep[] = (traceOf(turn)?.steps ?? []).map((step) => {
    const tools = step.toolCallIds.flatMap((id): TraceRow[] => {
      const receipt = receipts.get(id);
      return receipt && INPUT_TOOLS.includes(receipt.name as ToolName)
        ? [{ kind: "tool", receipt }]
        : [];
    });
    const web = pending.flatMap((record): TraceRow[] => {
      if (claimed.has(record) || !step.toolCallIds.includes(record.callId))
        return [];
      claimed.add(record);
      return [{ kind: "web", record }];
    });
    return { ...step, rows: [...tools, ...web] };
  });
  const unnamed = pending
    .filter((record) => !claimed.has(record))
    .map((record): TraceRow => ({ kind: "web", record }));
  if (unnamed.length === 0) return steps;
  const last = steps[steps.length - 1];
  if (!last) return [{ reasoning: "", toolCallIds: [], rows: unnamed }];
  return [...steps.slice(0, -1), { ...last, rows: [...last.rows, ...unnamed] }];
}

/**
 * What a run did, counted: the words of the trace's folded line.
 *
 * Reads count distinct sources, because "Read 3 sources" after reading one
 * chapter three times would overstate what the answer rests on. Only calls
 * that succeeded count as done; the ones that did not are counted apart, so
 * "Read 2 sources" never hides a third read that failed.
 *
 * Failures count only rows the fold draws (`traceRows`). A failed
 * `submit_findings` has no row, so "1 step failed" on the line would send the
 * writer into a fold with nothing in it that failed; what that call was for
 * is already on screen, or visibly absent, in the findings list.
 *
 * A web search counts once, by its last attempt: a refusal its retry or
 * re-ask made good is still drawn in the fold, but "1 step failed" on an
 * answer that rests on that search would be a false alarm about the answer.
 * Searches are told apart by call id, which is the model's, so two calls
 * sharing one count as one; the rows stay exact.
 */
export interface TraceFacts {
  read: number;
  /** The book was searched (`grep`). */
  searchedProject: boolean;
  /** The engines whose web searches ended with results, by the model's name. */
  webEngines: ReadonlySet<"wikipedia" | "web">;
  listed: boolean;
  structure: boolean;
  findings: boolean;
  failed: number;
  /** The model showed its working somewhere in the run. */
  thought: boolean;
  /**
   * The answer stands on no web search, though one was proposed: every
   * search ended declined or refused before anything left, none may have
   * reached its engine (a query that may have left is never hidden behind
   * "without"), and the answer finished (a stopped turn answered nothing).
   * Derived, never stored.
   */
  answeredWithoutWeb: boolean;
}

export function traceFacts(turn: ChatTurn): TraceFacts {
  const receipts: ToolReceipt[] = turn.tools ?? [];
  const ok = receipts.filter((receipt) => receipt.status === "ok");
  const named = (name: ToolName) => ok.filter((one) => one.name === name);
  const trace = traceOf(turn);
  const rows = traceRows(turn).flatMap((step) => step.rows);
  const records = rows.flatMap((row) =>
    row.kind === "web" ? [row.record] : [],
  );
  const searches = [
    ...new Map(records.map((record) => [record.callId, record])).values(),
  ];
  const ended = (status: WebSearchRecord["status"]) =>
    searches.filter((record) => record.status === status);
  return {
    read: new Set(
      named("read_source").map((receipt) => receipt.sourceId ?? receipt.callId),
    ).size,
    searchedProject: named("grep").length > 0,
    webEngines: new Set(
      ended("searched").map((record) => engineLabel(record.engine)),
    ),
    listed: named("list_sources").length > 0,
    structure: named("inspect_structure").length > 0,
    findings: named("submit_findings").length > 0,
    failed:
      rows.filter(
        (row) => row.kind === "tool" && row.receipt.status === "error",
      ).length + ended("failed").length,
    thought: Boolean(
      trace?.steps.some((step) => step.reasoning.trim() || step.text?.trim()),
    ),
    answeredWithoutWeb:
      turn.outcome === "complete" &&
      searches.length > 0 &&
      ended("searched").length === 0 &&
      !records.some(
        (record) => record.status === "failed" && record.reached !== "no",
      ),
  };
}

function update(
  trace: TurnTrace | undefined,
  at: number,
  change: (step: TraceStep) => TraceStep,
): TurnTrace {
  const steps = [...(trace?.steps ?? [])];
  // Pads with empty slots up to `at`.
  while (steps.length <= at) steps.push({ reasoning: "", toolCallIds: [] });
  steps[at] = change(steps[at] as TraceStep);
  return trace?.trimmed ? { steps, trimmed: true } : { steps };
}

// ── The source a call asked for ──────────────────────────────────────────────
//
// A receipt carries `sourceId` only for a read that succeeded, so a failed
// read's row would name nothing, alike for a real chapter whose range was
// wrong and for an id that named nothing. The live status line and the trace
// row both read the request from the call's own arguments, through these
// two.

/** The `sourceId` the call asked for, if its arguments carry one. */
export function requestedSourceId(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined;
  const { sourceId } = args as Record<string, unknown>;
  return typeof sourceId === "string" ? sourceId : undefined;
}

/**
 * A requested id, fit to show. It is model-made text, so: only an id
 * the tool's schema would accept (300 characters at most), with control and
 * bidi-override characters taken out, since they could flip the row to show
 * a different id, and clipped to 60.
 */
export function shownSourceId(id: string): string | undefined {
  if (id.length > 300) return undefined;
  const plain = id
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  if (!plain) return undefined;
  return plain.length > 60 ? `${plain.slice(0, 60)}…` : plain;
}
