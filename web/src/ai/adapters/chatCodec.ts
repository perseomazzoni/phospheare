// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  CHAT_KINDS,
  CLAIM_STANCES,
  CLAIM_VERDICTS,
  MODEL_FAILURE_CODES,
  ANCHOR_CONTEXT_MAX,
  LOCATE_MAX_MATCHES,
  ANCHOR_QUOTE_MAX,
  MAP_NODES_MAX,
  MAP_REASON_MAX,
  MAP_START_MAX,
  MAP_TITLE_MAX,
  DRAFTING_LIMITS,
  DRAFTING_NEEDS,
  PLAN_LIMITS,
  PLAN_PRIORITIES,
  PLAN_VERDICTS,
  QUESTION_ARGUMENT_MAX,
  READING_LIMITS,
  REVIEW_CANDIDATE_SECTIONS_MAX,
  REVIEW_CANDIDATES_MAX,
  REVIEW_CONCERN_MAX,
  REVIEW_TASKS,
  TOOL_NAMES,
  VERIFY_FIX_MAX,
  VERIFY_SOURCES_MAX,
} from "../domain/types";
import { UNFOUND_MAX, UNFOUND_QUOTE_MAX } from "../domain/quoteCheck";
import { capTrace, TRACE_MAX_STEPS } from "../domain/trace";
import { PREDICTION_ID } from "../domain/reading";
import {
  keepsNoReceiptBody,
  searchesWeb,
  WEB_RECORDS_MAX,
  webSourceNumber,
} from "../domain/webEngine";
import {
  plainLine,
  quoteBounded,
  TITLE_MAX,
  usableQuery,
  WEB_RESULTS_MAX,
  webUrl,
} from "../domain/webText";
import { isReviewReferences, isReviewScope } from "../domain/scope";
import type { ChatPreferences, ChatTurn, RunUsage } from "../domain/chat";
import type { ModelRef } from "../domain/models";
import {
  asksAt,
  namesReference,
  offersWorkflow,
  questionOf,
  skillsFor,
  type AiSkill,
} from "../domain/skills";
import {
  MAP_SHAPES,
  isMapShapeId,
  suggestionOf,
} from "../domain/structureShapes";
import type {
  ChatKind,
  DraftingNeed,
  PlanPriority,
  PlanVerdict,
  ChatRecord,
  ClaimStance,
  ClaimVerdict,
  Finding,
  FindingStatus,
  MapMode,
  MapShapeId,
  ReviewCandidate,
  ReviewCheckpoint,
  ReviewSegmentState,
  ReviewSourceState,
  ReviewTask,
  ModelFailureCode,
  ToolName,
  TraceStep,
} from "../domain/types";

// Reads and writes the chat files and the review plans. A chat is the
// writer's own file in a folder someone else may share, so the reader holds
// every stored block to the shape a run writes, and a block a run could not
// have written is dropped whole: the turn stays, with its prose, and the
// chat is rejected only when a field every room reads is wrong. A block
// drawn row by row (a reading record, a plan) drops the bad row, never the
// block. Receipts are held hardest, since the model reads them as trusted
// output; the rule is stated at their banner.

/**
 * The hard file bound: a record past this cannot be read back, so it must
 * never be written. Below it, `CHAT_CONTINUATION_BYTES` is the point where
 * the app offers to continue in a new chat with a compacted context rather
 * than letting the writer hit the wall mid-sentence.
 */
export const CHAT_MAX_BYTES = 8 * 1024 * 1024;
export const CHAT_CONTINUATION_BYTES = 6 * 1024 * 1024;

/**
 * The hard bound of a review file. The file sits in a project folder that
 * may be shared, so the read refuses a larger one before it parses, and the
 * write refuses to make one.
 */
export const REVIEW_MAX_BYTES = 8 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TURN_ROLES: readonly ChatTurn["role"][] = ["user", "assistant"];
const TURN_OUTCOMES: readonly ChatTurn["outcome"][] = [
  "complete",
  "interrupted",
  "failed",
];
const REVIEW_STATES: readonly ReviewCheckpoint["state"][] = [
  "planned",
  "running",
  "interrupted",
  "complete",
  "failed",
];

function modelRef(value: unknown): value is ModelRef {
  return (
    object(value) &&
    typeof value.providerId === "string" &&
    typeof value.modelId === "string" &&
    (value.modelRevision === undefined ||
      typeof value.modelRevision === "string")
  );
}

function runUsage(value: unknown): value is RunUsage {
  return (
    object(value) &&
    Number.isInteger(value.steps) &&
    (value.steps as number) >= 0 &&
    [
      value.inputTokens,
      value.outputTokens,
      value.totalTokens,
      value.cachedInputTokens,
      value.durationMs,
      value.contextTokens,
      value.contextWindow,
    ].every((n) => n === undefined || typeof n === "number")
  );
}

/**
 * A chat's preferences in their base shape: the fields every room reads on
 * every turn. The review settings are checked apart, since a bad one is
 * dropped rather than failing the chat.
 */
function chatPreferences(
  value: unknown,
): value is Record<string, unknown> & ChatPreferences {
  return (
    object(value) &&
    typeof value.personaId === "string" &&
    (value.model === null || modelRef(value.model)) &&
    Array.isArray(value.pinnedSourceIds) &&
    value.pinnedSourceIds.every((id) => typeof id === "string") &&
    (value.preset === undefined || typeof value.preset === "string") &&
    (value.targetNodeId === undefined ||
      typeof value.targetNodeId === "string") &&
    (value.mode === undefined || typeof value.mode === "number")
  );
}

/**
 * A turn in its base shape: what the transcript draws and history sends.
 * The structured extras an answer may carry are each checked by their own
 * sanitizer, which drops the extra and keeps the turn.
 */
function chatTurn(value: unknown): value is Record<string, unknown> & ChatTurn {
  return (
    object(value) &&
    typeof value.id === "string" &&
    TURN_ROLES.includes(value.role as ChatTurn["role"]) &&
    typeof value.text === "string" &&
    typeof value.createdAt === "string" &&
    TURN_OUTCOMES.includes(value.outcome as ChatTurn["outcome"]) &&
    (value.runId === undefined || typeof value.runId === "string") &&
    (value.quote === undefined || typeof value.quote === "string") &&
    (value.personaId === undefined || typeof value.personaId === "string") &&
    (value.model === undefined || modelRef(value.model)) &&
    (value.elapsedMs === undefined || typeof value.elapsedMs === "number")
  );
}

/**
 * The whole record in its base shape, checked once more after the
 * sanitizers so the value handed back is what its type says, not a cast.
 */
function chatRecord(
  value: unknown,
): value is Record<string, unknown> & ChatRecord {
  return (
    object(value) &&
    value.schemaVersion === 1 &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    CHAT_KINDS.includes(value.kind as ChatKind) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    chatPreferences(value.preferences) &&
    Array.isArray(value.turns) &&
    value.turns.every(chatTurn)
  );
}

export function parseChat(raw: string): ChatRecord {
  if (new TextEncoder().encode(raw).byteLength > CHAT_MAX_BYTES)
    throw new Error("chat-too-large");
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.turns) ||
    !object(value.preferences) ||
    // The listing and the merge sort on these; a hand-edited file with a
    // number here would throw out of the whole list, not just this row.
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  )
    throw new Error("invalid-chat");
  if (!CHAT_KINDS.includes(String(value.kind) as ChatKind))
    throw new Error("invalid-chat-kind");
  // The fields every room reads, on the chat and on each turn: a turn with
  // no role or text has no place in a transcript, so the chat is unreadable
  // rather than drawn with a hole.
  if (!chatPreferences(value.preferences) || !value.turns.every(chatTurn))
    throw new Error("invalid-chat");
  // The chat's review task picks the rubric that goes into the model's
  // instructions. An unknown task drops the preference only, and the chat
  // then asks as an editorial chat with no task chosen.
  if (
    value.preferences.reviewTask !== undefined &&
    !REVIEW_TASKS.includes(value.preferences.reviewTask as ReviewTask)
  )
    delete value.preferences.reviewTask;
  // A scope this app cannot run is dropped the same way; the next review
  // command sets it again.
  if (
    value.preferences.reviewScope !== undefined &&
    !isReviewScope(value.preferences.reviewScope)
  )
    delete value.preferences.reviewScope;
  // The reference a review was named against. One this app could not
  // have written takes the scope with it: kept alone, the chat's next
  // question would run the same review against every reference, the widening
  // a name must never become. Without a scope the next question is a
  // question, and the next command sets both again.
  if (
    value.preferences.reviewReferences !== undefined &&
    !isReviewReferences(value.preferences.reviewReferences)
  ) {
    delete value.preferences.reviewReferences;
    delete value.preferences.reviewScope;
  }
  // The continued chat's latch is only ever `true`: anything
  // else a file holds is dropped, never read as a latch either way.
  if (value.searchedBefore !== undefined && value.searchedBefore !== true)
    delete value.searchedBefore;
  sanitizeReading(value, value.kind as ChatKind);
  sanitizeDrafting(value, value.kind as ChatKind);
  sanitizePlan(value, value.kind as ChatKind);
  // A `web:N` a model cites resolves to one stored result, so an id is unique
  // across the whole chat, not just its turn.
  const webIds = new Set<string>();
  for (const turn of value.turns)
    if (object(turn)) {
      sanitizeReceipts(turn);
      // Before the records: a `repeated` count is kept only on a `/verify`
      // answer, which the marker says this is.
      sanitizeVerified(turn, value.kind as ChatKind);
      sanitizeWeb(turn, value.kind as ChatKind, webIds);
      // After the receipts, because it keeps only calls that survived them.
      sanitizeTrace(turn);
      sanitizeCoverage(turn);
      sanitizeLocated(turn);
      sanitizeMapped(turn, value.kind as ChatKind);
      sanitizeSummarisedPart(turn, value.kind as ChatKind);
      sanitizeJournal(turn, value.kind as ChatKind);
      sanitizeReviewRef(turn);
      sanitizeCommand(turn, value.kind as ChatKind);
      sanitizeUnfoundQuotes(turn);
      sanitizeSignalCandidates(turn);
      sanitizeCommented(turn);
      sanitizeRoute(turn, value.kind as ChatKind);
    }
  if (!chatRecord(value)) throw new Error("invalid-chat");
  return value;
}

/**
 * The route to another chat (`ChatTurn.route`), the button that opens one:
 * an answer's, in a room that points (General, Drafting), to a chat kind
 * other than its own, with a Section only for a reader.
 */
function sanitizeRoute(turn: Record<string, unknown>, kind: ChatKind): void {
  const route = turn.route;
  if (route === undefined) return;
  if (
    turn.role !== "assistant" ||
    (kind !== "general" && kind !== "drafting") ||
    !object(route) ||
    !onlyKeys(route, ROUTE_KEYS) ||
    !CHAT_KINDS.includes(route.kind as ChatKind) ||
    route.kind === kind ||
    (route.through !== undefined &&
      (!nodeFits(route.through) ||
        (route.kind !== "alpha-reader" && route.kind !== "beta-reader")))
  )
    delete turn.route;
}

const ROUTE_KEYS = new Set(["kind", "through"]);

/**
 * What an answer left in the margin (`ChatTurn.commented`): an assistant
 * turn's list of chapters, each named once with a positive whole count.
 */
function sanitizeCommented(turn: Record<string, unknown>): void {
  const list = turn.commented;
  if (list === undefined) return;
  const seen = new Set<string>();
  const fits =
    turn.role === "assistant" &&
    Array.isArray(list) &&
    list.length > 0 &&
    list.every((one: unknown) => {
      if (!object(one)) return false;
      const { nodeId, count } = one;
      if (typeof nodeId !== "string" || !nodeId || seen.has(nodeId))
        return false;
      seen.add(nodeId);
      return (
        typeof count === "number" && Number.isSafeInteger(count) && count > 0
      );
    });
  if (!fits) delete turn.commented;
}

/**
 * The pre-pass count (`ChatTurn.signalCandidates`): an assistant turn's
 * positive whole number, or nothing.
 */
function sanitizeSignalCandidates(turn: Record<string, unknown>): void {
  const count = turn.signalCandidates;
  if (count === undefined) return;
  if (
    turn.role !== "assistant" ||
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count <= 0
  )
    delete turn.signalCandidates;
}

/**
 * The quotations a check could not find (`quoteCheck.ts`), held to what a run
 * writes: an answer's, a list of non-empty strings within the check's own
 * bounds.
 */
function sanitizeUnfoundQuotes(turn: Record<string, unknown>): void {
  const quotes = turn.unfoundQuotes;
  if (quotes === undefined) return;
  const kept =
    turn.role === "assistant" &&
    Array.isArray(quotes) &&
    quotes.length > 0 &&
    quotes.length <= UNFOUND_MAX &&
    quotes.every(
      (quote) =>
        typeof quote === "string" &&
        quote.trim().length > 0 &&
        Array.from(quote).length <= UNFOUND_QUOTE_MAX,
    );
  if (!kept) delete turn.unfoundQuotes;
}

/**
 * The command a question turn was typed as is what the bubble shows,
 * while `text` is what was sent, so it is kept only while the two agree: a
 * writer's turn, naming a question skill this chat offers, an argument only
 * where the skill takes text and within its bound, no other key, and the
 * skill composing from it the stored `text` and the stored command today.
 * So the words are the trimmed form the composer keeps, never padding the
 * bubble would show and nothing sent. Without the field the bubble shows
 * the text that was sent, so a rubric edited since makes old turns show
 * their text.
 */
function sanitizeCommand(turn: Record<string, unknown>, kind: ChatKind): void {
  const command = turn.command;
  if (command === undefined) return;
  const skill =
    object(command) && typeof command.skill === "string"
      ? skillsFor(kind).find((one) => one.command === command.skill)
      : undefined;
  const argument = object(command) ? command.argument : undefined;
  const kept =
    turn.role === "user" &&
    skill !== undefined &&
    // A `/summarise` is still a question where it is asked, and
    // `asksAt` is the one reader of that, here as in the panel's dispatch.
    asksAt(skill, { kind: "current" }) &&
    onlyKeys(command as Record<string, unknown>, COMMAND_KEYS) &&
    (argument === undefined ||
      (skill.argument === "text" &&
        bounded(argument, QUESTION_ARGUMENT_MAX))) &&
    composes(skill, argument as string | undefined, turn.text);
  if (!kept) delete turn.command;
}

const COMMAND_KEYS = new Set(["skill", "argument"]);

function composes(
  skill: AiSkill,
  argument: string | undefined,
  text: unknown,
): boolean {
  const asked = questionOf(skill, argument);
  return asked.text === text && asked.command.argument === argument;
}

// A turn's trace is rendered as text and re-capped as it streams, so a
// hand-edited one only has to have the right shape: strings, which React
// draws as text whatever they say, and call ids. The same bounds hold on
// the way in as on the way out: the text cap across the whole trace, a
// bound on the number of steps, and a call id only where a receipt that
// passed `sanitizeReceipts` carries it, so a forged id cannot draw a row
// for a read that never happened.
function sanitizeTrace(turn: Record<string, unknown>): void {
  const trace = turn.trace;
  if (trace === undefined) return;
  if (
    !object(trace) ||
    !Array.isArray(trace.steps) ||
    trace.steps.length > TRACE_MAX_STEPS
  ) {
    delete turn.trace;
    return;
  }
  const receipts = new Set(
    (Array.isArray(turn.tools) ? turn.tools : []).map(
      (receipt) => (receipt as { callId: string }).callId,
    ),
  );
  // A call happens once, so it is drawn once: a hand-edited file naming an id
  // twice would otherwise draw two rows for one read, under one React key.
  const placed = new Set<string>();
  const steps: TraceStep[] = [];
  for (const step of trace.steps) {
    if (
      !object(step) ||
      typeof step.reasoning !== "string" ||
      (step.text !== undefined && typeof step.text !== "string") ||
      !Array.isArray(step.toolCallIds)
    ) {
      delete turn.trace;
      return;
    }
    steps.push({
      reasoning: step.reasoning,
      ...(typeof step.text === "string" ? { text: step.text } : {}),
      toolCallIds: step.toolCallIds.filter((id): id is string => {
        if (typeof id !== "string" || !receipts.has(id) || placed.has(id))
          return false;
        placed.add(id);
        return true;
      }),
    });
  }
  turn.trace = capTrace(
    trace.trimmed === true ? { steps, trimmed: true } : { steps },
  );
}

// ── Receipt validation ───────────────────────────────────────────────────────
//
// A receipt's `result` is replayed as a `tool`-role message, the one role a
// model is trained to read as trusted output rather than data, so a
// corrupted or hand-edited chat in a shared folder would be a better-framed
// injection channel than the prose beside it, which `PROSE_BOUNDARY` tells
// the model to distrust. A bad receipt is dropped: it is derived replay
// material, and losing one costs a re-read. A non-string `result` would
// also reach `message.content.length` as `undefined`, a NaN budget, and go
// onto the wire as an object.
function sanitizeReceipts(turn: Record<string, unknown>): void {
  if (!Array.isArray(turn.tools)) {
    if (turn.tools !== undefined) delete turn.tools;
    return;
  }
  turn.tools = turn.tools
    .filter(
      (receipt) =>
        object(receipt) &&
        typeof receipt.callId === "string" &&
        TOOL_NAMES.includes(receipt.name as ToolName) &&
        (receipt.result === undefined || typeof receipt.result === "string") &&
        (receipt.sourceId === undefined ||
          typeof receipt.sourceId === "string") &&
        (receipt.sourceIds === undefined ||
          (Array.isArray(receipt.sourceIds) &&
            receipt.sourceIds.every((id) => typeof id === "string"))),
    )
    // A search's receipt is bare: a planted `result` or `sourceId` would
    // replay as a tool message the model trusts, holding whatever the file's
    // author wrote.
    .map((receipt: Record<string, unknown>) =>
      keepsNoReceiptBody(receipt.name as string)
        ? {
            callId: receipt.callId,
            name: receipt.name,
            status: receipt.status,
          }
        : receipt,
    );
}

// ── A turn's web searches ────────────────────────────────────────────────────
//
// The records become citations: a `web:N` in an answer resolves against them
// to a link whose href is the stored url. So a file keeps only
// records of the shape the run wrote: each status with its own fields and no
// others, a query in its normal form and never on a declined row, a url
// `webUrl` would have kept, ids unique across the chat, on an answer turn, in
// a chat that may search.

const WEB_RECORD_KEYS = {
  searched: new Set([
    "callId",
    "engine",
    "status",
    "query",
    "results",
    "repeated",
    "costUsd",
  ]),
  failed: new Set(["callId", "engine", "status", "query", "code", "reached"]),
  declined: new Set(["callId", "engine", "status"]),
} as const;
const WEB_RESULT_KEYS = new Set(["id", "url", "title"]);
const WEB_REACHES: readonly unknown[] = ["no", "yes", "unknown"];
const PROVIDER_ID_MAX = 200;

function sanitizeWeb(
  turn: Record<string, unknown>,
  kind: ChatKind,
  issued: Set<string>,
): void {
  const web = turn.web;
  if (web === undefined) return;
  // The count first: a count out of place loses the count, never the record.
  // Checked after, `onlyKeys` would read a stray `repeated` on a declined or
  // failed record as an unknown key and drop the whole block, and with it the
  // trace's word that a query left.
  if (Array.isArray(web))
    for (const record of web)
      if (object(record)) sanitizeRepeated(record, turn.verifies === true);
  const ids = new Set<string>();
  const kept =
    turn.role === "assistant" &&
    searchesWeb(kind) &&
    Array.isArray(web) &&
    web.length <= WEB_RECORDS_MAX &&
    web.every((record) => webRecord(record, issued, ids));
  if (!kept) {
    delete turn.web;
    return;
  }
  for (const id of ids) issued.add(id);
}

/**
 * A search's repeats: an integer a `/verify` answer's record may
 * carry, bounded as a sum with the results beside it. A search returns at
 * most `WEB_RESULTS_MAX`, so no file can make one claim more. Anything else
 * drops the count, never the record, whose query still left.
 */
function sanitizeRepeated(
  record: Record<string, unknown>,
  verifies: boolean,
): void {
  const repeated = record.repeated;
  if (repeated === undefined) return;
  const kept =
    verifies &&
    record.status === "searched" &&
    Array.isArray(record.results) &&
    Number.isInteger(repeated) &&
    (repeated as number) >= 1 &&
    record.results.length + (repeated as number) <= WEB_RESULTS_MAX;
  if (!kept) delete record.repeated;
}

function webEngine(engine: unknown): engine is { kind: string } {
  if (!object(engine)) return false;
  if (engine.kind === "wikipedia") return onlyKeys(engine, ENGINE_KEYS);
  return (
    engine.kind === "provider" &&
    onlyKeys(engine, PROVIDER_ENGINE_KEYS) &&
    bounded(engine.providerId, PROVIDER_ID_MAX)
  );
}

const ENGINE_KEYS = new Set(["kind"]);
const PROVIDER_ENGINE_KEYS = new Set(["kind", "providerId"]);

/** A query the run could have sent: `usableQuery` would leave it as it is. */
function sentQuery(query: unknown): boolean {
  return typeof query === "string" && usableQuery(query) === query;
}

function webRecord(
  record: unknown,
  issued: ReadonlySet<string>,
  ids: Set<string>,
): boolean {
  if (
    !object(record) ||
    !bounded(record.callId, ID_MAX) ||
    !webEngine(record.engine)
  )
    return false;
  const engine = record.engine;
  if (record.status === "declined")
    return onlyKeys(record, WEB_RECORD_KEYS.declined);
  if (record.status === "failed")
    return (
      onlyKeys(record, WEB_RECORD_KEYS.failed) &&
      sentQuery(record.query) &&
      MODEL_FAILURE_CODES.includes(record.code as ModelFailureCode) &&
      WEB_REACHES.includes(record.reached)
    );
  if (record.status !== "searched") return false;
  const cost = record.costUsd;
  return (
    onlyKeys(record, WEB_RECORD_KEYS.searched) &&
    sentQuery(record.query) &&
    (cost === undefined ||
      (engine.kind === "provider" &&
        typeof cost === "number" &&
        Number.isFinite(cost) &&
        cost >= 0)) &&
    Array.isArray(record.results) &&
    record.results.length <= WEB_RESULTS_MAX &&
    record.results.every((result) => webResult(result, issued, ids))
  );
}

function webResult(
  result: unknown,
  issued: ReadonlySet<string>,
  ids: Set<string>,
): boolean {
  if (
    !object(result) ||
    !onlyKeys(result, WEB_RESULT_KEYS) ||
    typeof result.id !== "string" ||
    webSourceNumber(result.id) === null ||
    issued.has(result.id) ||
    ids.has(result.id) ||
    typeof result.url !== "string" ||
    webUrl(result.url) !== result.url ||
    // In code points, as the run clipped it and `TITLE_MAX` bounds it: a title
    // of astral characters is twice as long in units. An empty
    // title is one the run keeps, because a page the engine named without a
    // title is still citable. Refusing it would drop the turn's whole `web`
    // block on reload, and with it the searched latch that keeps the model's
    // own links inert.
    typeof result.title !== "string" ||
    Array.from(result.title).length > TITLE_MAX ||
    plainLine(result.title) !== result.title
  )
    return false;
  ids.add(result.id);
  return true;
}

// The renders read `row.sourceId` and `row.reason` on every skipped entry, so
// a hand-edited file whose rows are not objects would throw out of the dock,
// not just the detail. `reason` is not checked, because an unknown one renders
// as `unknown` and keeps the row.
function skippedRow(row: unknown): boolean {
  return object(row) && typeof row.sourceId === "string";
}

function coverageFields(
  coverage: unknown,
): coverage is Record<string, unknown> & { skipped: unknown[] } {
  return (
    object(coverage) &&
    typeof coverage.intended === "number" &&
    typeof coverage.inspected === "number" &&
    typeof coverage.complete === "boolean" &&
    Array.isArray(coverage.skipped) &&
    (coverage.judgement === undefined || judgementCoverage(coverage.judgement))
  );
}

/**
 * How many unjudged facts a coverage may name: the judge asks at most
 * `JUDGE_MAX` about the value candidates and as many about the rest.
 */
const UNJUDGED_MAX = 80;
/** An unjudged fact's entity or attribute, in characters: a ledger claim's. */
const UNJUDGED_TEXT_MAX = 200;

/**
 * What a fact check judged, as a plan and a turn keep it: counts and a
 * bounded list of facts, each a string entity, attribute, key and its source
 * ids. The dock draws these, so a hand-edited file gets rows of the right
 * shape and no more of them than a check can produce.
 */
function judgementCoverage(value: unknown): boolean {
  // A bounded list of facts by identity: the unjudged, and the deferred, of
  // which a check names at most `DEFERRED_NAMED`, under this bound too.
  const facts = (list: unknown) =>
    Array.isArray(list) &&
    list.length <= UNJUDGED_MAX &&
    list.every(
      (one) =>
        object(one) &&
        bounded(one.key, ID_MAX) &&
        bounded(one.entity, UNJUDGED_TEXT_MAX) &&
        bounded(one.attribute, UNJUDGED_TEXT_MAX) &&
        Array.isArray(one.sourceIds) &&
        one.sourceIds.every((id) => bounded(id, ID_MAX)),
    );
  return (
    object(value) &&
    typeof value.candidates === "number" &&
    typeof value.judged === "number" &&
    facts(value.unjudged) &&
    (value.deferred === undefined || facts(value.deferred)) &&
    // The references the check could not read into a ledger, as ids.
    (value.unread === undefined ||
      (Array.isArray(value.unread) &&
        value.unread.length <= UNJUDGED_MAX &&
        value.unread.every((id) => bounded(id, ID_MAX))))
  );
}

// A turn's coverage is detail beside an answer that reads without it, so a
// malformed one, in its fields or any row, goes whole.
function sanitizeCoverage(turn: Record<string, unknown>): void {
  const coverage = turn.coverage;
  if (coverage === undefined) return;
  if (!coverageFields(coverage) || !coverage.skipped.every(skippedRow))
    delete turn.coverage;
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function optional(value: unknown, max: number): boolean {
  return (
    value === undefined || (typeof value === "string" && value.length <= max)
  );
}

/**
 * The one shape a workflow's anchor may have when it is read back: a
 * `/where` match or a `/map` issue's quote.
 */
function anchorShape(anchor: unknown): boolean {
  return (
    object(anchor) &&
    bounded(anchor.sourceId, 300) &&
    bounded(anchor.quote, ANCHOR_QUOTE_MAX) &&
    optional(anchor.revision, 300) &&
    optional(anchor.prefix, ANCHOR_CONTEXT_MAX) &&
    optional(anchor.suffix, ANCHOR_CONTEXT_MAX)
  );
}

// A located answer's passages become clickable rows that open a Section and
// mark text in it, so the rows are held to string ids and quotes, bounded,
// and no more of them than a run can produce. Every click is re-checked at
// click time: the live catalogue must name the id, and the quote must be
// found in the live text again (`revealEvidence`). So this bounds what can
// be drawn, and the click bounds what can happen.
function sanitizeLocated(turn: Record<string, unknown>): void {
  const located = turn.located;
  if (located === undefined) return;
  const coverage = object(located) ? located.coverage : undefined;
  if (
    !object(located) ||
    !Array.isArray(located.matches) ||
    !coverageFields(coverage)
  ) {
    delete turn.located;
    return;
  }
  // Here the coverage is part of the answer, because "not found" is said
  // through it, so a bad row costs only that row, never the answer.
  coverage.skipped = coverage.skipped.filter(skippedRow);
  located.matches = located.matches
    .filter(anchorShape)
    .slice(0, LOCATE_MAX_MATCHES);
}

// A `/map` answer is drawn, every node a mark on a diagram, every reason a
// table cell, every anchor a click. So the block is checked against
// everything a run writes, and one wrong field drops the whole block: a map
// with one node removed would draw a Structure that is not the writer's.
//
// Every key is allow-listed, because a `__proto__` or a stray field is a
// file no run wrote. The combinations the type cannot rule out
// are ruled out here: no verdict or beat without a shape, never both a
// derived and a named beat, a stage only on a Hero's Journey, a parent that
// is a Part of this same map with no cycle through it, and each source drawn
// once, because the drawing is a tree keyed by source id. The nested objects
// are held to their keys too. Reader chats never run `/map`, so
// a block in one is dropped outright.
const MAP_KEYS = new Set([
  "kind",
  "mode",
  "shapeFrom",
  "suggestion",
  "shape",
  "scope",
  "structureRevision",
  "nodes",
  "coverage",
]);
const MAP_NODE_KEYS = new Set([
  "sourceId",
  "kind",
  "parentId",
  "title",
  "words",
  "standsIn",
  "beat",
  "stage",
  "verdict",
  "outOfOrder",
  "reason",
  "anchor",
]);

const MAP_ANCHOR_KEYS = new Set([
  "sourceId",
  "quote",
  "revision",
  "prefix",
  "suffix",
]);
const MAP_SCOPE_KEYS = new Set(["kind", "nodeId"]);
const MAP_COVERAGE_KEYS = new Set([
  "intended",
  "inspected",
  "skipped",
  "complete",
]);
const MAP_SKIPPED_KEYS = new Set(["sourceId", "reason"]);

function onlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  return Object.keys(value).every((key) => keys.has(key));
}

/**
 * Each source once, and every parent chain ending at the top. A node's
 * parent is a Part of this block (checked per node), so a chain longer than
 * the block has come round again.
 */
function mapTreeValid(nodes: readonly Record<string, unknown>[]): boolean {
  const parents = new Map<unknown, unknown>();
  for (const node of nodes) {
    if (parents.has(node.sourceId)) return false;
    parents.set(node.sourceId, node.parentId);
  }
  for (const node of nodes) {
    let at: unknown = node.parentId;
    for (let steps = 0; at !== undefined; steps += 1) {
      if (steps >= nodes.length || at === node.sourceId) return false;
      at = parents.get(at);
    }
  }
  // A quote is a click that lands the editor, so it lands where the drawing
  // says: on the node itself, or, since a Part's issue is quoted from
  // one of its own Sections, on a Section drawn under that Part. The chains
  // are acyclic at this point.
  const kinds = new Map(nodes.map((node) => [node.sourceId, node.kind]));
  const under = (id: unknown, part: unknown) => {
    for (let at = parents.get(id); at !== undefined; at = parents.get(at))
      if (at === part) return true;
    return false;
  };
  return nodes.every((node) => {
    const target = (node.anchor as Record<string, unknown> | undefined)
      ?.sourceId;
    return (
      target === undefined ||
      target === node.sourceId ||
      (node.kind === "part" &&
        kinds.get(target) === "section" &&
        under(target, node.sourceId))
    );
  });
}

function mapNodesValid(
  nodes: unknown[],
  shape: MapShapeId | null,
  mode: MapMode,
  // Only its kind is read; the block's scope is checked beside this call.
  scope: { kind: string },
): boolean {
  if (nodes.length > MAP_NODES_MAX) return false;
  // What the run writes where: a beat the app said a node
  // stands in only when it said one, on a positional map or the phases of a
  // whole-Structure Hero's Journey, and a beat the model named only on a
  // named map. A Part map's rows print `beatOf`, so a smuggled `standsIn`
  // would print as a beat no run gave.
  const saysStandsIn =
    mode === "positional" || (mode === "hero" && scope.kind === "structure");
  const namesBeat = mode === "named";
  const table = shape ? MAP_SHAPES[shape] : null;
  const beats = new Set(table?.beats.map((beat) => beat.id) ?? []);
  const stages = new Set(table?.stages?.map((one) => one.id) ?? []);
  const parts = new Set(
    nodes.flatMap((node) =>
      object(node) && node.kind === "part" && typeof node.sourceId === "string"
        ? [node.sourceId]
        : [],
    ),
  );
  const oneLine = (value: unknown, max: number) =>
    bounded(value, max) && !/[\r\n]/.test(value);
  const valid = nodes.every(
    (node) =>
      object(node) &&
      onlyKeys(node, MAP_NODE_KEYS) &&
      bounded(node.sourceId, 300) &&
      (node.kind === "part" || node.kind === "section") &&
      (node.parentId === undefined ||
        (typeof node.parentId === "string" && parts.has(node.parentId))) &&
      oneLine(node.title, MAP_TITLE_MAX) &&
      (node.words === undefined ||
        (Number.isInteger(node.words) && (node.words as number) >= 0)) &&
      (node.standsIn === undefined ||
        (saysStandsIn &&
          typeof node.standsIn === "string" &&
          beats.has(node.standsIn))) &&
      (node.beat === undefined ||
        (namesBeat && typeof node.beat === "string" && beats.has(node.beat))) &&
      !(node.standsIn !== undefined && node.beat !== undefined) &&
      (node.stage === undefined ||
        (shape === "herosjourney" &&
          typeof node.stage === "string" &&
          stages.has(node.stage))) &&
      (node.verdict === undefined ||
        (shape !== null &&
          (node.verdict === "fits" ||
            node.verdict === "partly" ||
            node.verdict === "no"))) &&
      (node.outOfOrder === undefined ||
        (shape !== null && node.outOfOrder === true)) &&
      (node.reason === undefined || oneLine(node.reason, MAP_REASON_MAX)) &&
      (node.anchor === undefined ||
        (shape !== null &&
          anchorShape(node.anchor) &&
          onlyKeys(node.anchor as Record<string, unknown>, MAP_ANCHOR_KEYS))),
  );
  return valid && mapTreeValid(nodes as Record<string, unknown>[]);
}

/**
 * A mode this block could have been placed in: a reading only with no shape
 * and a Hero's Journey only on that shape; positional only on the whole
 * Structure (`planMap`), because a Part is never positional.
 */
function mapModeFits(mode: unknown, shape: unknown, scope: unknown): boolean {
  switch (mode) {
    case "reading":
      return shape === null;
    case "hero":
      return shape === "herosjourney";
    case "positional":
      return (
        shape !== null &&
        shape !== "herosjourney" &&
        object(scope) &&
        scope.kind === "structure"
      );
    case "named":
      return shape !== null && shape !== "herosjourney";
    default:
      return false;
  }
}

/**
 * A fit note is only ever asked on a map with no shape typed, so one on a
 * typed map takes the block with it. Its shape and reason are held to the
 * step's own check (`suggestionOf`).
 */
function mapSuggestionFits(value: unknown, shapeFrom: unknown): boolean {
  if (value === undefined) return true;
  return (
    shapeFrom === "declared" &&
    object(value) &&
    onlyKeys(value, MAP_SUGGESTION_KEYS) &&
    suggestionOf(value) !== null
  );
}

const MAP_SUGGESTION_KEYS = new Set(["shape", "reason"]);

/** A `/map` block held to what a run writes, by its `kind`; a reader chat keeps none. */
function sanitizeMapped(turn: Record<string, unknown>, kind: ChatKind): void {
  const mapped = turn.mapped;
  if (mapped === undefined) return;
  const reader = kind === "alpha-reader" || kind === "beta-reader";
  if (reader || !object(mapped) || !mapCoverageFits(mapped.coverage)) {
    delete turn.mapped;
    return;
  }
  const fits =
    mapped.kind === "arc"
      ? mapArcFits(mapped)
      : mapped.kind === "passages"
        ? mapPassagesFits(mapped)
        : mapped.kind === "fit"
          ? mapFitOnlyFits(mapped)
          : false;
  if (!fits) delete turn.mapped;
}

/**
 * `/summarise part`'s mark, the one field its answer stores: the Part's
 * node id, drawn only as a title looked up in the live Structure, and
 * whether Sections were kept from the assistant. Kept only on an answer in
 * a chat that offers the command, so a reader chat draws no Part's
 * provenance.
 */
function sanitizeSummarisedPart(
  turn: Record<string, unknown>,
  kind: ChatKind,
): void {
  const part = turn.summarisedPart;
  if (part === undefined) return;
  const kept =
    turn.role === "assistant" &&
    offersWorkflow(kind, "summarise") &&
    object(part) &&
    onlyKeys(part, SUMMARISED_PART_KEYS) &&
    typeof part.nodeId === "string" &&
    part.nodeId.length > 0 &&
    text(part.nodeId, ID_MAX) &&
    (part.withheld === undefined || part.withheld === true);
  if (!kept) delete turn.summarisedPart;
}

const SUMMARISED_PART_KEYS = new Set(["nodeId", "withheld"]);

/**
 * A journal turn's marker: `read` or `predict`, and the Section the reader
 * was at. Kept only on an answer in a chat that offers the command it
 * marks, a beta chat, so no other room draws a journal card.
 */
function sanitizeJournal(turn: Record<string, unknown>, kind: ChatKind): void {
  const journal = turn.journal;
  if (journal === undefined) return;
  const kept =
    turn.role === "assistant" &&
    object(journal) &&
    onlyKeys(journal, JOURNAL_KEYS) &&
    (journal.kind === "read" || journal.kind === "predict") &&
    offersWorkflow(kind, journal.kind === "read" ? "journal" : "predict") &&
    (journal.nodeId === undefined ||
      (typeof journal.nodeId === "string" &&
        journal.nodeId.length > 0 &&
        text(journal.nodeId, ID_MAX))) &&
    (journal.kind === "predict" || journal.nodeId !== undefined);
  if (!kept) delete turn.journal;
}

const JOURNAL_KEYS = new Set(["kind", "nodeId"]);

/**
 * The reading record, held to what a run writes: in a beta chat only, each
 * entry and prediction of the shape and within the bounds `foldReading`
 * keeps. A bad row is dropped, never the record, and ids stay unique, the
 * first kept.
 */
function sanitizeReading(value: Record<string, unknown>, kind: ChatKind): void {
  const reading = value.reading;
  if (reading === undefined) return;
  if (
    kind !== "beta-reader" ||
    !object(reading) ||
    !onlyKeys(reading, READING_KEYS) ||
    !Array.isArray(reading.entries) ||
    !Array.isArray(reading.predictions)
  ) {
    delete value.reading;
    return;
  }
  reading.entries = (reading.entries as unknown[])
    .filter(entryFits)
    .slice(0, READING_LIMITS.entries);
  const ids = new Set<string>();
  reading.predictions = (reading.predictions as unknown[])
    .filter((one): one is Record<string, unknown> => {
      if (!predictionFits(one)) return false;
      const id = one.id as string;
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    })
    .slice(0, READING_LIMITS.predictions);
}

const READING_KEYS = new Set(["entries", "predictions"]);

/**
 * The drafting record, held to what a run writes: in a drafting chat only; a
 * need that is one of the room's, or none; the Sections visited, ids only.
 * A bad need is dropped, never the record: the room asks again.
 */
function sanitizeDrafting(
  value: Record<string, unknown>,
  kind: ChatKind,
): void {
  const drafting = value.drafting;
  if (drafting === undefined) return;
  if (
    kind !== "drafting" ||
    !object(drafting) ||
    !onlyKeys(drafting, DRAFTING_KEYS)
  ) {
    delete value.drafting;
    return;
  }
  const need = drafting.need;
  if (
    need !== undefined &&
    !(
      object(need) &&
      onlyKeys(need, NEED_KEYS) &&
      DRAFTING_NEEDS.includes(need.kind as DraftingNeed) &&
      (need.nodeId === undefined || nodeFits(need.nodeId)) &&
      text(need.at, ID_MAX)
    )
  )
    delete drafting.need;
  // A bad list costs the list, never the need.
  if (
    drafting.visited !== undefined &&
    !(
      Array.isArray(drafting.visited) &&
      drafting.visited.length <= DRAFTING_LIMITS.visited &&
      drafting.visited.every(nodeFits)
    )
  )
    delete drafting.visited;
}

/**
 * The revision plan, held to what a letter writes: in an editorial chat only,
 * each item a priority, a line within its bound, a state, the letter it came
 * from, and each id once. A bad item is dropped, never the plan.
 */
function sanitizePlan(value: Record<string, unknown>, kind: ChatKind): void {
  const plan = value.plan;
  if (plan === undefined) return;
  if (
    kind !== "editorial" ||
    !object(plan) ||
    !onlyKeys(plan, PLAN_KEYS) ||
    !Array.isArray(plan.items)
  ) {
    delete value.plan;
    return;
  }
  const ids = new Set<string>();
  plan.items = (plan.items as unknown[]).filter(
    (item): item is Record<string, unknown> => {
      if (
        !object(item) ||
        !onlyKeys(item, PLAN_ITEM_KEYS) ||
        !nodeFits(item.id) ||
        !PLAN_PRIORITIES.includes(item.priority as PlanPriority) ||
        typeof item.text !== "string" ||
        item.text.length === 0 ||
        !text(item.text, PLAN_LIMITS.item) ||
        (item.state !== "open" && item.state !== "done") ||
        !nodeFits(item.turnId) ||
        ids.has(item.id as string)
      )
        return false;
      // A verdict that does not parse costs the verdict, never the item: the
      // item is the writer's work list, the verdict a note on it.
      if (
        item.check !== undefined &&
        !(
          object(item.check) &&
          onlyKeys(item.check, PLAN_CHECK_KEYS) &&
          PLAN_VERDICTS.includes(item.check.verdict as PlanVerdict) &&
          typeof item.check.note === "string" &&
          text(item.check.note, PLAN_LIMITS.note) &&
          nodeFits(item.check.turnId)
        )
      )
        delete item.check;
      ids.add(item.id as string);
      return true;
    },
  );
}

const PLAN_KEYS = new Set(["items"]);
const PLAN_ITEM_KEYS = new Set([
  "id",
  "priority",
  "text",
  "state",
  "turnId",
  "check",
]);
const PLAN_CHECK_KEYS = new Set(["verdict", "note", "turnId"]);

const DRAFTING_KEYS = new Set(["need", "visited"]);
const NEED_KEYS = new Set(["kind", "nodeId", "at"]);
const ENTRY_KEYS = new Set([
  "nodeId",
  "readAt",
  "reaction",
  "understanding",
  "questions",
  "confusion",
  "attention",
  "cares",
  "keepReading",
  "why",
]);
const PREDICTION_KEYS = new Set([
  "id",
  "text",
  "madeAt",
  "state",
  "resolvedAt",
  "note",
]);

function linesFit(value: unknown, max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= READING_LIMITS.list &&
    value.every((one) => text(one, max))
  );
}

function nodeFits(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && text(value, ID_MAX);
}

function entryFits(value: unknown): boolean {
  return (
    object(value) &&
    onlyKeys(value, ENTRY_KEYS) &&
    nodeFits(value.nodeId) &&
    text(value.readAt, ID_MAX) &&
    text(value.reaction, READING_LIMITS.text) &&
    text(value.understanding, READING_LIMITS.text) &&
    linesFit(value.questions, READING_LIMITS.line) &&
    linesFit(value.confusion, READING_LIMITS.line) &&
    typeof value.attention === "number" &&
    [1, 2, 3, 4, 5].includes(value.attention) &&
    linesFit(value.cares, READING_LIMITS.name) &&
    typeof value.keepReading === "boolean" &&
    text(value.why, READING_LIMITS.line)
  );
}

function predictionFits(value: unknown): value is Record<string, unknown> {
  return (
    object(value) &&
    onlyKeys(value, PREDICTION_KEYS) &&
    typeof value.id === "string" &&
    PREDICTION_ID.test(value.id) &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    text(value.text, READING_LIMITS.line) &&
    (value.madeAt === undefined || nodeFits(value.madeAt)) &&
    (value.state === "open" ||
      value.state === "confirmed" ||
      value.state === "overturned") &&
    (value.resolvedAt === undefined || nodeFits(value.resolvedAt)) &&
    (value.note === undefined || text(value.note, READING_LIMITS.line))
  );
}

/**
 * `/verify`'s marker and its outcome. The marker is `true` or nothing, on an
 * answer in a chat that offers the command and searches the web: two layers,
 * as the run's refusals are. The outcome is kept only beside the marker, and
 * only as one of its two shapes. A sourced verdict with no sources left
 * loads as what the run would have settled it to: `inconclusive`, with no
 * fix.
 */
function sanitizeVerified(turn: Record<string, unknown>, kind: ChatKind): void {
  const offered =
    turn.role === "assistant" &&
    offersWorkflow(kind, "verify") &&
    searchesWeb(kind);
  if (turn.verifies !== undefined && (turn.verifies !== true || !offered))
    delete turn.verifies;
  const verified = turn.verified;
  if (verified === undefined) return;
  if (turn.verifies !== true || !verifyOutcomeFits(verified)) {
    delete turn.verified;
    return;
  }
  if ("verdict" in verified && (verified.sources as unknown[]).length === 0) {
    verified.verdict = "inconclusive";
    delete verified.fix;
  }
}

const VERDICT_KEYS = new Set(["verdict", "sources", "fix"]);
const UNJUDGED_KEYS = new Set(["unjudged"]);
const CLAIM_SOURCE_KEYS = new Set(["id", "stance", "quote"]);
const UNJUDGED: readonly unknown[] = ["unchecked", "nothing-found"];

function verifyOutcomeFits(value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  if ("unjudged" in value)
    return onlyKeys(value, UNJUDGED_KEYS) && UNJUDGED.includes(value.unjudged);
  const { verdict, sources, fix } = value;
  const ids = new Set<string>();
  return (
    onlyKeys(value, VERDICT_KEYS) &&
    CLAIM_VERDICTS.includes(verdict as ClaimVerdict) &&
    Array.isArray(sources) &&
    sources.length <= VERIFY_SOURCES_MAX &&
    sources.every((source) => claimSourceFits(source, ids)) &&
    (fix === undefined ||
      ((verdict === "doubtful" || verdict === "implausible") &&
        bounded(fix, VERIFY_FIX_MAX)))
  );
}

function claimSourceFits(source: unknown, ids: Set<string>): boolean {
  if (
    !object(source) ||
    !onlyKeys(source, CLAIM_SOURCE_KEYS) ||
    typeof source.id !== "string" ||
    webSourceNumber(source.id) === null ||
    ids.has(source.id) ||
    !CLAIM_STANCES.includes(source.stance as ClaimStance) ||
    (source.quote !== undefined &&
      (typeof source.quote !== "string" || !quoteBounded(source.quote)))
  )
    return false;
  ids.add(source.id);
  return true;
}

function mapCoverageFits(coverage: unknown): boolean {
  return (
    coverageFields(coverage) &&
    onlyKeys(coverage, MAP_COVERAGE_KEYS) &&
    coverage.skipped.every(
      (row) =>
        skippedRow(row) &&
        onlyKeys(row as Record<string, unknown>, MAP_SKIPPED_KEYS),
    )
  );
}

function mapArcFits(mapped: Record<string, unknown>): boolean {
  const { shape, scope } = mapped;
  return (
    onlyKeys(mapped, MAP_KEYS) &&
    mapModeFits(mapped.mode, shape, scope) &&
    (mapped.shapeFrom === "declared" ||
      (mapped.shapeFrom === "typed" && shape !== null)) &&
    mapSuggestionFits(mapped.suggestion, mapped.shapeFrom) &&
    (shape === null || isMapShapeId(shape)) &&
    isReviewScope(scope) &&
    (scope.kind === "structure" || scope.kind === "node") &&
    onlyKeys(scope as Record<string, unknown>, MAP_SCOPE_KEYS) &&
    bounded(mapped.structureRevision, 128) &&
    Array.isArray(mapped.nodes) &&
    mapNodesValid(
      mapped.nodes,
      shape as MapShapeId | null,
      mapped.mode as MapMode,
      scope,
    )
  );
}

const MAP_PASSAGES_KEYS = new Set([
  "kind",
  "shape",
  "shapeFrom",
  "scope",
  "sectionRevision",
  "nodes",
  "passages",
  "coverage",
  "suggestion",
]);
const MAP_FIT_KEYS = new Set([
  "kind",
  "scope",
  "sectionRevision",
  "nodes",
  "coverage",
  "suggestion",
]);
const MAP_SECTION_NODE_KEYS = new Set(["sourceId", "kind", "title", "words"]);
const MAP_FOUND_KEYS = new Set([
  "beat",
  "state",
  "at",
  "anchor",
  "reason",
  "outOfOrder",
]);
const MAP_MISSING_KEYS = new Set(["beat", "state", "reason"]);
const MAP_UNANSWERED_KEYS = new Set(["beat", "state"]);

/**
 * A Section map's scope: a Section scope whose one node is that Section, a
 * bare leaf, so every quote and every click lands where the drawing says,
 * and the content revision it verified against, bounded and only ever
 * compared. Returns the source id it answers to, or `null`.
 */
function sectionScopeId(mapped: Record<string, unknown>): string | null {
  const { scope, nodes } = mapped;
  if (
    !object(scope) ||
    scope.kind !== "node" ||
    !bounded(scope.nodeId, 300) ||
    !onlyKeys(scope, MAP_SCOPE_KEYS) ||
    !bounded(mapped.sectionRevision, 128) ||
    !Array.isArray(nodes) ||
    nodes.length !== 1
  )
    return null;
  const [node] = nodes as unknown[];
  const sourceId = `node:${scope.nodeId}`;
  return object(node) &&
    onlyKeys(node, MAP_SECTION_NODE_KEYS) &&
    node.sourceId === sourceId &&
    node.kind === "section" &&
    bounded(node.title, MAP_TITLE_MAX) &&
    !/[\r\n]/.test(node.title) &&
    (node.words === undefined ||
      (Number.isSafeInteger(node.words) && (node.words as number) >= 0))
    ? sourceId
    : null;
}

/**
 * A Section's passages: every beat of the shape once, in its order, because
 * the app writes them so and a gap or a stranger is a file someone else
 * wrote. Each state carries only its own fields: a position only on `found`,
 * finite and within 0 to 1; a quote only there, pointing at the scoped
 * Section; a reason only on `found` and `missing`; `unanswered` bare.
 */
function mapPassagesFits(mapped: Record<string, unknown>): boolean {
  const { shape, passages } = mapped;
  const section = sectionScopeId(mapped);
  if (
    section === null ||
    !onlyKeys(mapped, MAP_PASSAGES_KEYS) ||
    !isMapShapeId(shape) ||
    !(mapped.shapeFrom === "declared" || mapped.shapeFrom === "typed") ||
    !mapSuggestionFits(mapped.suggestion, mapped.shapeFrom) ||
    !Array.isArray(passages)
  )
    return false;
  const beats = MAP_SHAPES[shape].beats.map((beat) => beat.id);
  const line = (value: unknown) =>
    bounded(value, MAP_REASON_MAX) && !/[\r\n]/.test(value);
  return (
    passages.length === beats.length &&
    passages.every((one, at) => {
      if (!object(one) || one.beat !== beats[at]) return false;
      switch (one.state) {
        case "found":
          return (
            onlyKeys(one, MAP_FOUND_KEYS) &&
            typeof one.at === "number" &&
            Number.isFinite(one.at) &&
            one.at >= 0 &&
            one.at <= 1 &&
            anchorShape(one.anchor) &&
            onlyKeys(one.anchor as Record<string, unknown>, MAP_ANCHOR_KEYS) &&
            (one.anchor as Record<string, unknown>).sourceId === section &&
            bounded(
              (one.anchor as Record<string, unknown>).quote,
              MAP_START_MAX,
            ) &&
            line(one.reason) &&
            (one.outOfOrder === undefined || one.outOfOrder === true)
          );
        case "missing":
          return onlyKeys(one, MAP_MISSING_KEYS) && line(one.reason);
        case "unanswered":
          return onlyKeys(one, MAP_UNANSWERED_KEYS);
        default:
          return false;
      }
    })
  );
}

/**
 * A Section read for its fit alone: the note is the answer, so it is
 * required, and nothing placed may ride along: no shape, no passage, no
 * quote.
 */
function mapFitOnlyFits(mapped: Record<string, unknown>): boolean {
  return (
    sectionScopeId(mapped) !== null &&
    onlyKeys(mapped, MAP_FIT_KEYS) &&
    object(mapped.suggestion) &&
    onlyKeys(mapped.suggestion, MAP_SUGGESTION_KEYS) &&
    suggestionOf(mapped.suggestion) !== null
  );
}

// A turn's `review` names the task and the scope review-again runs
// (`completeReview`), so it is held to what a run writes: a known task, a
// scope this app can run, a bounded run id. Without it the answer stays,
// with no Review again button.
/** A run id is a uuid the app mints; anything longer is not one. */
const RUN_ID_MAX = 300;

function runId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= RUN_ID_MAX
  );
}

function sanitizeReviewRef(turn: Record<string, unknown>): void {
  const review = turn.review;
  if (review === undefined) return;
  if (
    !object(review) ||
    !runId(review.runId) ||
    !REVIEW_TASKS.includes(review.task as ReviewTask) ||
    !isReviewScope(review.scope) ||
    // Dropped whole, never kept without its name: an answer's Resume and
    // Review again read `review`, and one stripped of its reference would
    // run against every reference. And only where the command takes one,
    // as a plan, or Review again would carry a reference no command typed
    // into a plan.
    (review.references !== undefined &&
      (!isReviewReferences(review.references) ||
        !namesReference(review.task as ReviewTask)))
  )
    delete turn.review;
}

export function serializeChat(chat: ChatRecord): string {
  return `${JSON.stringify(chat, null, 2)}\n`;
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

/** Ids and revisions the plan carries: bounded like every other stored id. */
const ID_MAX = 300;

function findingIds(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((id) => text(id, ID_MAX)))
  );
}

const SOURCE_STATES: readonly ReviewSourceState[] = [
  "pending",
  "complete",
  "invalidated",
  "failed",
  "unmapped",
  "not-read",
  "too-large",
];
const SEGMENT_STATES: readonly ReviewSegmentState[] = [
  "pending",
  "complete",
  "invalidated",
];
const CANDIDATE_STATES: readonly ReviewCandidate["state"][] = [
  "pending",
  "complete",
  "too-large",
];

function reviewSource(value: unknown): boolean {
  return (
    object(value) &&
    text(value.sourceId, ID_MAX) &&
    optional(value.revision, ID_MAX) &&
    SOURCE_STATES.includes(value.state as ReviewSourceState) &&
    findingIds(value.findingIds)
  );
}

function reviewSegment(value: unknown): boolean {
  return (
    object(value) &&
    text(value.id, ID_MAX) &&
    text(value.sourceId, ID_MAX) &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    optional(value.revision, ID_MAX) &&
    SEGMENT_STATES.includes(value.state as ReviewSegmentState) &&
    findingIds(value.findingIds)
  );
}

/**
 * A candidate's concern is model text that a resumed run feeds back to the
 * verify step, so it is held to what a run writes: one line, bounded, naming
 * a bounded handful of Sections. The ids are not trusted beyond their
 * shape: a resume reads only what the chat may read at that moment, so a
 * planted id reads nothing.
 */
function reviewCandidate(value: unknown): boolean {
  return (
    object(value) &&
    text(value.id, ID_MAX) &&
    text(value.concern, REVIEW_CONCERN_MAX) &&
    !/[\r\n]/.test(value.concern) &&
    Array.isArray(value.sourceIds) &&
    value.sourceIds.length > 0 &&
    value.sourceIds.length <= REVIEW_CANDIDATE_SECTIONS_MAX &&
    value.sourceIds.every((id) => text(id, ID_MAX)) &&
    CANDIDATE_STATES.includes(value.state as ReviewCandidate["state"]) &&
    findingIds(value.findingIds)
  );
}

const SEVERITIES: readonly Finding["severity"][] = [
  "observation",
  "minor",
  "major",
];
const STATUSES: readonly FindingStatus[] = [
  "open",
  "dismissed",
  "resolved",
  "stale",
];
/** What one finding's texts may hold: far past what a model writes. */
const FINDING_TEXT_MAX = 20_000;

function evidenceAnchor(value: unknown): boolean {
  return (
    object(value) &&
    text(value.sourceId, ID_MAX) &&
    text(value.quote, FINDING_TEXT_MAX) &&
    optional(value.revision, ID_MAX) &&
    optional(value.prefix, FINDING_TEXT_MAX) &&
    optional(value.suffix, FINDING_TEXT_MAX) &&
    // The field the evidence check found the quote in.
    optional(value.field, ID_MAX)
  );
}

/**
 * A finding the plan carries to its publish. Its quotes are checked against
 * the live prose there, so this checks only that publish can walk it: a
 * malformed row would throw out of every resume, and the offer would never
 * be withdrawn.
 */
function reviewFinding(value: unknown): boolean {
  return (
    object(value) &&
    text(value.id, ID_MAX) &&
    text(value.title, FINDING_TEXT_MAX) &&
    text(value.explanation, FINDING_TEXT_MAX) &&
    optional(value.uncertainty, FINDING_TEXT_MAX) &&
    (value.unverified === undefined ||
      value.unverified === "all" ||
      value.unverified === "half") &&
    SEVERITIES.includes(value.severity as Finding["severity"]) &&
    STATUSES.includes(value.status as FindingStatus) &&
    Array.isArray(value.evidence) &&
    value.evidence.every(evidenceAnchor)
  );
}

/**
 * A resumable plan, validated element by element, all or nothing: a plan
 * with one malformed row is unreadable and its Resume is withdrawn, because
 * a half-trusted ledger would publish findings over coverage it cannot
 * vouch for. A finding's shape is checked here and its quotes are not:
 * every quote is validated against the live prose when the review
 * publishes.
 */
export function parseReview(raw: string): ReviewCheckpoint {
  if (new TextEncoder().encode(raw).byteLength > REVIEW_MAX_BYTES)
    throw new Error("review-too-large");
  const value: unknown = JSON.parse(raw);
  if (!reviewCheckpoint(value)) throw new Error("invalid-review");
  return value;
}

function reviewCheckpoint(value: unknown): value is ReviewCheckpoint {
  if (
    !object(value) ||
    // Only the schema with the two methods, the line sweep's segments and
    // the Sections, is read; any other is unreadable, not adopted.
    value.schemaVersion !== 1 ||
    typeof value.runId !== "string" ||
    typeof value.chatId !== "string" ||
    !REVIEW_STATES.includes(value.state as ReviewCheckpoint["state"]) ||
    !modelRef(value.model) ||
    typeof value.personaId !== "string" ||
    typeof value.recipe !== "string" ||
    typeof value.recipeRevision !== "string" ||
    !runUsage(value.usage) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.sources) ||
    !value.sources.every(reviewSource) ||
    !Array.isArray(value.findings) ||
    !value.findings.every(reviewFinding) ||
    !REVIEW_TASKS.includes(value.task as ReviewTask) ||
    // A plan without a scope this app can run is unreadable, not guessed at,
    // and its Resume is withdrawn.
    !isReviewScope(value.scope) ||
    (value.replaces !== undefined && !runId(value.replaces)) ||
    // The reference the review was named against: only on the
    // Sections engine, and only for a task whose command takes one. A plan
    // is unreadable rather than resumed against every reference.
    (value.references !== undefined &&
      (!isReviewReferences(value.references) ||
        value.method !== "sections" ||
        !namesReference(value.task as ReviewTask)))
  )
    return false;
  // The method is what a resume dispatches on, so an unknown one is not
  // defaulted to either: each carries a ledger the other cannot read.
  switch (value.method) {
    case "segments":
      return (
        Array.isArray(value.segments) &&
        value.segments.every(reviewSegment) &&
        typeof value.referenceRoom === "number" &&
        Number.isInteger(value.referenceRoom) &&
        value.referenceRoom >= 0
      );
    case "sections":
      return (
        (value.candidates === null ||
          (Array.isArray(value.candidates) &&
            value.candidates.length <= REVIEW_CANDIDATES_MAX &&
            value.candidates.every(reviewCandidate))) &&
        (value.facts === undefined || judgementCoverage(value.facts))
      );
    default:
      return false;
  }
}

export function serializeReview(review: ReviewCheckpoint): string {
  return `${JSON.stringify(review, null, 2)}\n`;
}
