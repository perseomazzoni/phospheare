// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ChatCompaction,
  ChatRecord,
  ModelMessage,
  ModelRequest,
  RunUsage,
  ToolReceipt,
  ModelRef,
} from "../domain/types";
import { mapHistoryLine } from "../domain/structureShapes";
import { judged } from "../domain/types";
import { withoutWebIds } from "../domain/citations";
import { estimateRequestTokens } from "../domain/estimate";
import {
  NO_WEB_CITATIONS,
  webCitations,
  type WebCitations,
} from "../domain/webCitations";
import { REQUEST_MESSAGES_MAX, type ModelProvider } from "../ports";
import type { RunBudget } from "./budgets";
import {
  historyOverBudget,
  inputCharactersFor,
  outputCharactersFor,
} from "./budgets";
import { ModelRunError, runStep } from "./runStep";
import { VERIFY_LINES } from "./verifyClaim";

// ── Request history and compaction ───────────────────────────────────────────
//
// The chat file keeps the full transcript; the model sees a bounded window:
// the compaction of older turns, when one exists, plus the recent turns
// verbatim.
//
// Compaction summarizes the writer's conversation, not the manuscript. It
// never updates a `summary--*.md` file, never upgrades a hypothesis into
// Canon, and never strips a reader policy.

export const COMPACTION_RECIPE = "history-compaction";
export const COMPACTION_RECIPE_REVISION = "1";

/**
 * The most messages the replayed history may carry before it is compacted:
 * half of what a request may carry, so the instructions, the context and
 * every message a run's tool loop adds still fit under the cap.
 */
export const HISTORY_MESSAGES_MAX = Math.floor(REQUEST_MESSAGES_MAX / 2);

/**
 * The most messages a compaction keeps verbatim, half the history's bound.
 * The window stops on the turn that reaches it, and one turn replays at most
 * a run's tool calls and two messages more, so the history after a
 * compaction stays under `HISTORY_MESSAGES_MAX`.
 */
const KEEP_MESSAGES_MAX = Math.floor(HISTORY_MESSAGES_MAX / 2);

export interface RequestHistory {
  messages: ModelMessage[];
  characters: number;
  /**
   * True when the window exceeds its character budget or carries more than
   * `HISTORY_MESSAGES_MAX` messages.
   */
  overBudget: boolean;
}

/** What a replayed tool exchange that wrote no prose ends on. */
const NO_CLOSING_PROSE = "No answer was written after these reads.";

/**
 * One turn as the model sees it again.
 *
 * An assistant turn that used tools becomes three kinds of message: the
 * assistant's call, the tool's answer, and the prose it wrote afterwards.
 * Replaying the prose alone would lose what the assistant read, and a
 * follow-up would re-fetch it or answer without it.
 *
 * Every replayed call is paired with its result, including an error result.
 * A provider contract that pairs `tool_use` with `tool_result` is violated by
 * an unanswered call, so a receipt missing its `result` is dropped from both
 * sides rather than replayed half-formed.
 */
function turnMessages(
  turn: ChatRecord["turns"][number],
  allowed: ReadonlySet<string>,
  web: WebCitations,
  tools: ReadonlySet<string>,
): ModelMessage[] {
  if (turn.role === "user")
    return [
      {
        role: "user",
        content: turn.quote
          ? `Quoted selection:\n${turn.quote}\n\n${turn.text}`
          : turn.text,
      },
    ];

  // A `/map` answer is replayed as the line rebuilt from its checked block:
  // ids and verdict words, only for sources this run allows. Never its stored
  // text and never a reason.
  if (turn.mapped) {
    const line = mapHistoryLine(turn.mapped, allowed);
    return [{ role: "assistant", content: line }];
  }

  // A `/verify` answer is replayed from its settled block: the verdict as the
  // app stored it, never as the text may claim it, then the reasoning and the
  // results it cites. Never a stance, a quote or the fix: each is the judge's
  // reading of third-party text, and replayed it would come back to the model
  // in its own voice as a finding. An unsettled one still answers, so the
  // question never stands unanswered.
  if (turn.verifies) {
    const verified = turn.verified;
    if (verified === undefined || turn.outcome !== "complete")
      return [{ role: "assistant", content: VERIFY_LINES.unsettled }];
    if (!judged(verified))
      return [
        {
          role: "assistant",
          content: VERIFY_LINES.unjudged[verified.unjudged],
        },
      ];
    return [
      {
        role: "assistant",
        content: withCitedWeb(
          `${VERIFY_LINES.checked(verified.verdict)}\n${turn.text}`,
          web,
        ),
      },
    ];
  }

  // ── Retained results and their sources ─────────────────────────────────────
  //
  // `allowed` gates old reads as well as new ones: the bar and a reader's
  // horizon (`context.ts`) can both withhold a source after it was read, and
  // a result read before that must not re-enter a later prompt.
  //
  // So a result replays only when it is attributable to a source the run
  // still allows. That rules out `grep`, `list_sources` and
  // `inspect_structure`, whose payloads name many sources and no single one.
  // They are also the cheapest to lose: the project index re-supplies that
  // orientation from the current catalog on every turn.
  //
  // A call replays only when this run declares its tool. A vendor refuses a
  // history whose call names a tool the request does not declare, and a
  // model without tool support is declared none and refuses every tool
  // message: its history is the prose alone.
  const replayable = (turn.tools ?? []).filter(
    (receipt) =>
      receipt.result !== undefined &&
      receipt.sourceId !== undefined &&
      allowed.has(receipt.sourceId) &&
      tools.has(receipt.name),
  );
  if (replayable.length === 0) {
    // ── Turns that said nothing ──────────────────────────────────────────────
    //
    // An assistant turn that said nothing is not replayed. A run that failed
    // before the first token still writes its turn, with empty prose, so the
    // transcript shows the writer they asked and got nothing.
    //
    // As context it is a message with no content, which a provider may
    // refuse, and the OpenRouter request gate does. A refusal would fail
    // every later turn in the chat, and nothing the writer types could clear
    // it.
    //
    // The check is on the text, not on `outcome`: a turn that failed after
    // streaming a paragraph has something to say, and a turn that succeeded
    // with no text has nothing.
    const said = turn.text ?? "";

    return said.trim() === ""
      ? []
      : [{ role: "assistant", content: withCitedWeb(said, web) }];
  }

  return [
    {
      role: "assistant",
      // The call message carries no text: whatever the model said while
      // calling was a preamble, and its answer is the last message below.
      // Repeating it would put the same sentences in the conversation twice.
      content: "",
      toolCalls: replayable.map((receipt) => ({
        id: receipt.callId,
        name: receipt.name,
        arguments: receipt.arguments,
      })),
    },
    ...replayable.map((receipt): ModelMessage => ({
      role: "tool",
      toolCallId: receipt.callId,
      toolName: receipt.name,
      // The truncation is named, not silent: a model that cannot tell a short
      // document from the first page of a long one summarises the page as the
      // document. Told it has a prefix, it reads on with a range
      // (`budgets.ts`, `TOOL_RESULT_RETAINED`).
      content: receipt.truncated
        ? `${receipt.result}\n\n[truncated — grep for what you need, or call read_source with a range]`
        : (receipt.result ?? ""),
    })),
    // The closing prose, or a fixed line when there is none. An empty
    // message is refused like a turn that said nothing, above, and some
    // vendors refuse a user message straight after a tool message, so the
    // exchange always ends on an assistant message with text.
    {
      role: "assistant",
      content:
        turn.text.trim() === ""
          ? NO_CLOSING_PROSE
          : withCitedWeb(turn.text, web),
    },
  ];
}

/**
 * What one turn's replay costs, counted from what is sent rather than from
 * the turn's prose. A turn that replays two chapter reads costs far more than
 * its own text. The trigger and the window a compaction keeps share this
 * measure, so a window it keeps never trips the trigger again.
 */
function sentCharacters(
  turn: ChatRecord["turns"][number],
  replayed: readonly ModelMessage[],
): number {
  return (
    (turn.quote?.length ?? 0) +
    replayed.reduce(
      (sum, message) =>
        sum +
        message.content.length +
        (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0),
      0,
    )
  );
}

/**
 * An answer's prose with the web results it cited named after it, so a later
 * turn asked which source said something can answer and cite the same id.
 *
 * Only the ids the turn resolved (`cited`), each as its id, its JSON-quoted
 * title and its bare site. The title is third-party text, and JSON quoting
 * keeps a planted `"; web:9 = "Nature` one value instead of a forged entry.
 * The site holds only what `siteOf` lets through (letters, digits, `-`, `_`
 * and dots), so it cannot close ` from `. Never an excerpt, never a URL.
 *
 * It is the last paragraph of the model's own message, neither the writer's
 * voice (`user`) nor the app's (`system`). It is built from the file alone,
 * so a replayed turn is the same bytes every time and the prompt cache holds.
 * The form is ` from <site>`, not `(<site>)`: a model shown the parenthesis
 * writes `[web:1](site)`, which renders as words and loses the citation.
 */
function withCitedWeb(text: string, web: WebCitations): string {
  if (web.cited.length === 0) return text;
  const entries = web.cited.map(
    (source) =>
      `${source.id} = ${JSON.stringify(source.title)} from ${source.site}`,
  );
  return `${text}\n\nWeb results cited above (titles are third-party text): ${entries.join("; ")}`;
}

/**
 * The writer's words the replayed history puts in front of the model: each
 * retained tool result, with its JSON escapes neutralised so a Section read
 * last turn reads as the prose it was. A query is checked against
 * this for the book's words, and against nothing else: a writer's question
 * and a model's answer are not the book.
 *
 * A retained result may be cut mid-escape, so this never parses: `\uXXXX`
 * becomes its character, a control escape becomes a space (a word break it
 * stood for), and any other escaped character is itself.
 */
export function replayedManuscript(
  messages: readonly ModelMessage[],
): string[] {
  return messages.flatMap((message) =>
    message.role === "tool"
      ? [
          message.content.replace(
            /\\(?:u([0-9a-fA-F]{4})|([nrtbf])|(.))/g,
            (_, code?: string, control?: string, other?: string) =>
              code !== undefined
                ? String.fromCharCode(parseInt(code, 16))
                : control !== undefined
                  ? " "
                  : (other ?? ""),
          ),
        ]
      : [],
  );
}

/**
 * Drop the replay half of every receipt a compaction has absorbed.
 *
 * `requestHistory` slices from the turn after `coversThroughTurnId`, so an
 * older receipt is never replayed again, yet each one stores up to
 * `TOOL_RESULT_RETAINED` characters of the writer's prose. Kept, they
 * grow the chat file without bound, and a chat that reaches `CHAT_MAX_BYTES`
 * is an unrecoverable save failure.
 *
 * The display half stays: `callId`, `name`, `status`, `sourceId`,
 * `sourceIds`. The turn's footer counts tools, `readerContamination` reads
 * both source fields to decide whether a reader chat has seen a source its
 * horizon now withholds, and an old answer's citations resolve against them.
 */
export function stripAbsorbedReceipts(
  chat: ChatRecord,
  coversThroughTurnId: string,
): ChatRecord {
  const covered = chat.turns.findIndex(
    (turn) => turn.id === coversThroughTurnId,
  );
  if (covered < 0) return chat;
  return {
    ...chat,
    turns: chat.turns.map((turn, at) =>
      at > covered || !turn.tools?.some((one) => one.result !== undefined)
        ? turn
        : {
            ...turn,
            tools: turn.tools.map(
              ({ callId, name, status, sourceId, sourceIds }): ToolReceipt => ({
                callId,
                name,
                status,
                ...(sourceId === undefined ? {} : { sourceId }),
                ...(sourceIds === undefined ? {} : { sourceIds }),
              }),
            ),
          },
    ),
  };
}

/**
 * Builds the messages for the next inference step. The compaction, when
 * present, travels as a system message: it is application-supplied context,
 * not something the writer said.
 */
export function requestHistory(
  chat: ChatRecord,
  budget: RunBudget,
  allowed: ReadonlySet<string>,
  /** The tools the run declares; a call to any other is not replayed. */
  tools: ReadonlySet<string>,
): RequestHistory {
  const messages: ModelMessage[] = [];
  const compacted = chat.compactedHistory;
  if (compacted?.text)
    messages.push({
      role: "system",
      content: `Earlier conversation, compacted by the application:\n${compacted.text}`,
    });
  const coveredAt = compacted
    ? chat.turns.findIndex((turn) => turn.id === compacted.coversThroughTurnId)
    : -1;
  const turns = chat.turns.slice(coveredAt + 1);
  // Walked over the whole chat: what a turn may cite includes the ids earlier
  // turns cited, compacted ones too.
  const web = webCitations(
    chat.turns,
    undefined,
    undefined,
    chat.searchedBefore,
  );
  let characters = messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  // A question no answer shares a run with is a wide review still planned
  // or stopped (its command goes in when the plan is made): replayed,
  // the model would read "/continuity" as asked of it now. Every other run
  // writes its answer turn even when it fails. The last turn is the one this
  // request is asking, and always stays.
  const answered = new Set(
    turns.flatMap((turn) =>
      turn.role === "assistant" && turn.runId ? [turn.runId] : [],
    ),
  );
  const unanswered = (turn: (typeof turns)[number], at: number) =>
    turn.role === "user" &&
    turn.runId !== undefined &&
    !answered.has(turn.runId) &&
    at < turns.length - 1;
  for (const [at, turn] of turns.entries()) {
    if (unanswered(turn, at)) continue;
    const replayed = turnMessages(
      turn,
      allowed,
      web.get(turn.id) ?? NO_WEB_CITATIONS,
      tools,
    );
    messages.push(...replayed);
    // A history measured by text alone passes its budget and is truncated
    // from the front by the runtime instead of compacted here.
    characters += sentCharacters(turn, replayed);
  }
  return {
    messages,
    characters,
    // The message count is bounded too: the OpenRouter request gate refuses a
    // conversation past `REQUEST_MESSAGES_MAX` whatever its size, and a long
    // chat of short turns would reach it with the characters well inside their
    // budget.
    overBudget:
      historyOverBudget(characters, budget) ||
      messages.length > HISTORY_MESSAGES_MAX,
  };
}

export interface CompactionResult {
  compaction: ChatCompaction;
  usage: RunUsage;
}

/**
 * The turns as plain `Writer:` and `Assistant:` lines. Compaction runs at a
 * run boundary, its cost counted in the run ledger, never in the background.
 */
function transcriptOf(turns: ChatRecord["turns"]): string {
  return turns
    .map(
      (turn) =>
        `${turn.role === "user" ? "Writer" : "Assistant"}: ${turn.text}`,
    )
    .join("\n\n");
}

/**
 * What a compaction asks with: Standard, resolved against the answering
 * model by the caller, which holds its descriptor.
 */
export type CompactionSampling = Pick<ModelRequest, "temperature" | "effort">;

async function runCompaction(
  provider: ModelProvider,
  model: ModelRef,
  signal: AbortSignal,
  limits: { inputTokens: number; outputTokens: number },
  transcript: string,
  coversThroughTurnId: string,
  sampling: CompactionSampling,
): Promise<CompactionResult> {
  const request: ModelRequest = {
    model,
    instructions: [
      "Compact this conversation for future turns. Preserve the writer's current goals, explicit decisions, open questions, constraints, and any source ids or revisions mentioned. Never invent evidence, never turn a hypothesis into a fact, and never remove a reader-boundary restriction. Return only the compacted notes.",
    ].join("\n"),
    messages: [{ role: "user", content: transcript }],
    tools: [],
    limits,
    ...sampling,
  };
  // Measured before it is sent. The room is a character budget derived from
  // the same allowance, and a request that still estimates past it is refused
  // here rather than answered by a runtime that silently drops the
  // instructions off the front.
  if (estimateRequestTokens(request).tokens > limits.inputTokens)
    throw new ModelRunError({
      code: "context-too-large",
      message:
        "The conversation is too long to compact within this model's context window. Start a new chat, or choose a model with a larger window.",
      retryable: false,
    });
  const result = await runStep(provider, request, signal);
  if (result.reason === "cancelled")
    throw new ModelRunError({
      code: "cancelled",
      message: "Compaction cancelled",
      retryable: false,
    });
  if (!result.text.trim())
    throw new ModelRunError({
      code: "invalid-response",
      message:
        "The conversation could not be compacted. Start a new chat or narrow the context.",
      retryable: true,
    });
  return {
    compaction: {
      recipe: COMPACTION_RECIPE,
      recipeRevision: COMPACTION_RECIPE_REVISION,
      coversThroughTurnId,
      text: result.text.trim().slice(0, outputCharactersFor(limits)),
      usage: result.usage,
    },
    usage: result.usage,
  };
}

/**
 * What one compaction request may carry, in characters: the input allowance
 * less the instructions, with a little kept back for the message framing.
 */
function compactionRoom(limits: { inputTokens: number }): number {
  return Math.max(500, inputCharactersFor(limits) - 800);
}

export async function compactHistory(
  chat: ChatRecord,
  provider: ModelProvider,
  model: ModelRef,
  signal: AbortSignal,
  limits: { inputTokens: number; outputTokens: number },
  keepCharacters: number,
  sampling: CompactionSampling,
  /** What the run may read: the kept turns are measured as they replay. */
  allowed: ReadonlySet<string>,
  /** The tools the run declares, as `requestHistory` takes them. */
  tools: ReadonlySet<string>,
): Promise<CompactionResult> {
  // Keep the most recent turns verbatim; compact the prefix. The window is
  // measured as `requestHistory` measures it, in sent characters and in
  // messages, so what it keeps is under both of the trigger's bounds.
  const web = webCitations(
    chat.turns,
    undefined,
    undefined,
    chat.searchedBefore,
  );
  let keepFrom = chat.turns.length;
  let recent = 0;
  let kept = 0;
  while (keepFrom > 0 && recent < keepCharacters && kept < KEEP_MESSAGES_MAX) {
    keepFrom -= 1;
    const turn = chat.turns[keepFrom];
    if (!turn) break;
    const replayed = turnMessages(
      turn,
      allowed,
      web.get(turn.id) ?? NO_WEB_CITATIONS,
      tools,
    );
    recent += sentCharacters(turn, replayed);
    kept += replayed.length;
  }
  // ── Incremental, bounded compaction ────────────────────────────────────────
  //
  // A compaction starts where the last one ended: the kept digest, then only
  // the turns after `coversThroughTurnId`.
  // The transcript is bounded to what the request can carry, cut from the
  // oldest end with a line saying so, because an unbounded request grows with
  // the chat past what the window holds.
  //
  // The digest goes first because it is the older context: the model folds
  // the new turns into it rather than starting the chat's story over.
  const compacted = chat.compactedHistory;
  const coveredAt = compacted
    ? chat.turns.findIndex((turn) => turn.id === compacted.coversThroughTurnId)
    : -1;
  const older = chat.turns.slice(coveredAt + 1, keepFrom);
  if (older.length === 0)
    throw new ModelRunError({
      code: "context-too-large",
      message:
        "The conversation is too long to fit this model's context window. Start a new chat, or choose a model with a larger window.",
      retryable: false,
    });
  // ── The digest and the turns ───────────────────────────────────────────────
  //
  // The digest and the turns share the room. A digest a larger model wrote
  // can be wider than this model's whole room, so the digest takes at most
  // half of it, cut from its oldest end with a line saying so; its oldest
  // notes are the oldest context. The turns take what is left, cut the same
  // way. Neither cut can return the whole (`slice(-0)` is the whole string),
  // and `runCompaction` measures the request before it is sent.
  //
  // What a cut loses is accepted and said, not solved. A digest is the
  // model's prose and need not run oldest to newest, so a constraint the
  // writer set early in a long chat can fall off with the marker. A bounded
  // request is not a promise of faithful memory: the marker tells the model
  // something went, and a chat too long for the marker and one line is
  // refused (`tailOf`) rather than sent short and silent.
  const room = compactionRoom(limits);
  const notes = compacted?.text
    ? tailOf(compacted.text, Math.floor(room / 2), NOTES_OMITTED)
    : "";
  const digest = notes
    ? `Notes compacted so far (fold the turns below into them):\n${notes}\n\n`
    : "";
  const bounded = tailOf(
    transcriptOf(older),
    room - digest.length,
    TURNS_OMITTED,
  );
  return runCompaction(
    provider,
    model,
    signal,
    limits,
    `${digest}${bounded}`,
    older[older.length - 1]?.id ?? "",
    sampling,
  );
}

const NOTES_OMITTED = "[earlier notes omitted]";
const TURNS_OMITTED = "[earlier turns omitted from this digest]";

/**
 * `text` within `room` characters: whole when it fits, otherwise its
 * newest end behind `marker`, which says what went. Throws
 * `context-too-large` when `room` cannot hold the marker and one character
 * of text, so a short room never yields the whole.
 */
function tailOf(text: string, room: number, marker: string): string {
  if (text.length <= room) return text;
  const keep = room - marker.length - 2;
  if (keep < 1)
    throw new ModelRunError({
      code: "context-too-large",
      message:
        "The conversation is too long to fit this model's context window. Start a new chat, or choose a model with a larger window.",
      retryable: false,
    });
  return `${marker}\n\n${text.slice(-keep)}`;
}

/**
 * Compacts the whole conversation into one digest, for Continue in a new
 * chat: the new chat starts empty and its context is this digest alone. The
 * transcript is bounded to the compaction room from the most recent end; the
 * old chat's full history stays in its file and the digest says when earlier
 * turns were omitted.
 */
export async function compactAllHistory(
  chat: ChatRecord,
  provider: ModelProvider,
  model: ModelRef,
  signal: AbortSignal,
  limits: { inputTokens: number; outputTokens: number },
  sampling: CompactionSampling,
): Promise<CompactionResult> {
  if (chat.turns.length === 0)
    throw new ModelRunError({
      code: "context-too-large",
      message: "There is no history to compact.",
      retryable: false,
    });
  // Web ids are stripped before the bound, so none survives at a cut's edge:
  // the new chat mints its ids from `web:1` again, and a `web:4` carried in
  // its digest would name a different page there. In-chat compaction keeps
  // its ids. The bound is the same room an in-chat compaction gets, which
  // leaves space for the instructions.
  const bounded = tailOf(
    withoutWebIds(transcriptOf(chat.turns)),
    compactionRoom(limits),
    TURNS_OMITTED,
  );
  return runCompaction(
    provider,
    model,
    signal,
    limits,
    bounded,
    chat.turns[chat.turns.length - 1]?.id ?? "",
    sampling,
  );
}
