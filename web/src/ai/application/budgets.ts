// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelDescriptor, ReasoningEffort } from "../domain/types";
import { CHARACTERS_PER_TOKEN } from "../domain/ratios";
import { effortFor, thinkingSteps } from "../domain/mode";
import { ModelRunError } from "./runStep";

// ── Run limits ───────────────────────────────────────────────────────────────
//
// Every run limit lives here and no caller restates one. Each character limit
// derives from the model's reported context window: a fixed table would waste
// most of a large window and, on a small one, refuse with advice no setting
// can follow. The step and tool-call ceilings are flat runaway-loop guards.

export interface RunBudget {
  /** Characters of one source that may enter context. */
  sourceCharacters: number;
  /** Characters of all selected sources together. */
  totalCharacters: number;
  /** Characters of conversation history before compaction is needed. */
  historyCharacters: number;
  /**
   * Characters of the references and notes a review declares it reads,
   * before what the attached Section spent is taken off.
   */
  referenceCharacters: number;
  /** Inference steps for one ordinary chat run. */
  steps: number;
  /** Tool calls accepted per inference step, and per run. */
  toolCallsPerStep: number;
  toolCallsPerRun: number;
  /** Model-visible read window for one read_source call. */
  readWindow: number;
  /** Index rows this window can afford before the manuscript collapses. */
  manifestRows: number;
  /** The step allowance this budget was derived from. */
  inputTokens: number;
  outputTokens: number;
}

/** At most three requests wait behind the running one; a fourth is refused. */
export const QUEUE_LIMIT = 3;

/** Context headroom: at least 15% of the effective window stays unspent. */
export const CONTEXT_HEADROOM = 0.15;

/**
 * What a model that does not report its window is assumed to hold. It errs
 * low, because a guess too high overflows the window (`limitsFor` says what
 * that costs). An 8k window is below the input floor and is refused, so the
 * assumption is 16k. The Ollama adapter sends its own `num_ctx` from these
 * limits, so the runtime allocates what is assumed here.
 */
export const DEFAULT_CONTEXT_TOKENS = 16_384;

/** The generation reserve: a share of the window, floored and capped. */
const OUTPUT_SHARE = 0.15;
const OUTPUT_MIN = 512;
const OUTPUT_MAX = 8_192;

/**
 * Output held back for a reasoning model's thinking, per step up its own
 * effort scale. Thinking tokens are generated tokens: they count
 * against `num_predict` on Ollama and `max_tokens` on OpenRouter. A reserve
 * sized for the answer alone lets a model asked to think spend it before the
 * answer starts, and the run stops at `length` with nothing to show. It is
 * added on top of the answer's reserve, so the input side shrinks by this
 * much and the size guard refuses a window too small for both.
 *
 * A step is one level above `none` on the model's own list
 * (`thinkingSteps`). The value is flat, not a share, because how long a model
 * thinks tracks the effort asked for, not its window. It is an estimate; a
 * step that runs past it ends cut off, not lost.
 */
export const THINKING_STEP_TOKENS = 1_024;

/**
 * Characters held back from the source budget for the instructions, the tool
 * definitions and the turn itself.
 *
 * Sized from the measured length of a chat's system instructions with the
 * references' usage clause, about 14,000 characters. A smaller reserve lets a
 * small window plan material it cannot hold, which the size guard then
 * refuses or history compaction pays for.
 */
export const INSTRUCTION_RESERVE = 14_000;

/**
 * Rows the project index may carry before it collapses to Parts.
 *
 * The index is O(nodes) and travels on every turn, so on a long book it
 * degrades rather than eat the source allowance and refuse runs with advice
 * the writer cannot act on.
 *
 * This is the ceiling, not the allowance: `RunBudget.manifestRows` is what a
 * given model gets. Past whichever is smaller, the manuscript collapses to
 * its Parts and `inspect_structure` pages the rest. The ceiling keeps a large
 * remote model from being re-sent a 400-chapter table of contents every turn.
 */
const MANIFEST_ROWS_MAX = 120;

/**
 * What one index row costs, in characters.
 *
 * `  120. section · node:EL2874 · The Customs House [summary: outdated]` is 68
 * characters with its newline; a short row without freshness is 32. The
 * value sits at the pessimistic end, because an underestimate lets the index
 * overrun its reserve and the size guard refuses the run. The row allowance
 * derives from it, so it must match what the index renderer writes.
 */
const MANIFEST_ROW_CHARACTERS = 64;

/** Header lines, the two section headings, and the collapse note. */
const MANIFEST_HEADER_CHARACTERS = 420;

/**
 * Characters held back for the index, on top of the instruction reserve.
 *
 * Kept apart from `INSTRUCTION_RESERVE`, which covers text the app sizes;
 * this covers text the writer's project sizes. One sum would hide which grew
 * when a request stopped fitting.
 */
const MANIFEST_RESERVE = 2_400;

/**
 * The share of the source allowance the index may take.
 *
 * `MANIFEST_RESERVE` is not sized to cover `MANIFEST_ROWS_MAX`, because the
 * reserve feeds `MIN_INPUT_TOKENS`: sizing it for the ceiling raises the
 * refusal floor for every small window. The allowance scales instead. The
 * share is modest because the index is orientation, and the window is for
 * the writer's prose.
 */
const MANIFEST_SHARE = 0.08;

function manifestRowsFor(totalCharacters: number): number {
  const affordable = Math.max(
    MANIFEST_RESERVE,
    Math.floor(totalCharacters * MANIFEST_SHARE),
  );
  return Math.max(
    1,
    Math.min(
      MANIFEST_ROWS_MAX,
      Math.floor(
        (affordable - MANIFEST_HEADER_CHARACTERS) / MANIFEST_ROW_CHARACTERS,
      ),
    ),
  );
}

/**
 * How much of a tool's answer is kept on the turn for later turns to reuse.
 * It is bounded because a `read_source` payload is the writer's prose, and an
 * unbounded one would put a second copy of the manuscript in the chat file
 * once per turn.
 *
 * It sits far below `readWindow`. The model is told when the slice is a
 * prefix and can read on with a range, so a small slice costs one extra tool
 * call, not a lost answer.
 */
export const TOOL_RESULT_RETAINED = 2_000;

// ── Web results in context ───────────────────────────────────────────────────
//
// How much of what a search returned the model reads. The transport
// caps (`TITLE_MAX`, `EXCERPT_MAX` in `domain/webText.ts`) bound an engine's
// rows; these are context decisions, and they sit below them, so an excerpt the
// transport clipped is always clipped again here and `clipped` is never a lie.
// The title's cap is not here: a citation shows the title the model was shown,
// so it is the domain's (`WEB_TITLE_CHARACTERS` in `webText.ts`).

/**
 * The most of one excerpt the model reads, on a window that has the room:
 * the characters a request has left under its input allowance.
 */
export const WEB_EXCERPT_CHARACTERS = 1_200;

/**
 * The most one search's answer may take in context, whatever room the window
 * has. The fitting holds every search to it, so a large window never lets one
 * page's excerpts crowd out the book.
 */
export const WEB_SEARCH_CHARACTERS_MAX = 8_000;

/**
 * The least of one excerpt worth showing. The same floor as
 * `REVIEW_ROW_FLOOR`: below it an excerpt is a phrase, and a phrase
 * cannot settle whether a thing is true. A window that cannot hold one result
 * per search at this floor is told the results are too large, before the
 * writer is asked anything.
 */
export const WEB_EXCERPT_FLOOR = 300;

/**
 * The share of the room left in the window that one step's search results
 * may take. Half, so the model can still read a Section after it searched.
 */
export const WEB_RESULTS_ROOM_SHARE = 0.5;

// ── Margin comments in context ───────────────────────────────────────────────
//
// The comments of the attached chapters ride beside their prose. They are
// notes about the book, never the book, so they are held well below it: at
// most this many characters, and never more than this share of what the
// sources may spend, so on a small window a busy margin cannot push the
// chapter it is about out of its own prompt. Past the cap, threads are
// counted rather than shown.
export const COMMENTS_CONTEXT_CHARACTERS = 4_000;
export const COMMENTS_CONTEXT_SHARE = 0.1;

/**
 * How many consecutive words of the writer's text make a query "the book's
 * words". Fewer flags names and stock phrases a search needs; more lets a
 * sentence of the book through.
 */
export const BOOK_WORDS_RUN = 6;

/**
 * The smallest input allowance worth running: everything the app puts in the
 * request before any evidence, its orders and its index, and as much again
 * for the evidence itself. Below it the model would get its orders, a map of
 * a book it cannot open, and nothing to apply them to, so the run is refused.
 * It also keeps the subtraction in `budgetFor` from going negative.
 */
const MIN_INPUT_TOKENS =
  Math.ceil((INSTRUCTION_RESERVE + MANIFEST_RESERVE) / CHARACTERS_PER_TOKEN) *
  2;

/** Recent conversation may hold this share of the input before compaction. */
const HISTORY_SHARE = 0.4;

/**
 * The declared references' share of the input, and a flat ceiling on it.
 *
 * They ride every turn of a review chat, not only the one that asked, so a
 * share the size of the history's would buy the Characters sheet at the cost
 * of the conversation. The ceiling is for large windows: past it, the model
 * fetches what a review needs from the references with `read_source` rather
 * than having it attached on every turn. What does not fit is named.
 */
const REFERENCE_SHARE = 0.25;
const REFERENCE_MAX = 40_000;

/**
 * One tool call may not eat the whole window. `read_source` pages, so a
 * ceiling costs the model a second call rather than an answer.
 */
const READ_WINDOW_CEILING = 40_000;

/** Runaway-loop guards, flat whatever the window. */
const RUN_STEPS = 8;
const TOOL_CALLS_PER_STEP = 8;
const TOOL_CALLS_PER_RUN = 24;

/**
 * The input/output character budgets the workflows derive from token limits,
 * here so that no caller re-derives them with its own arithmetic.
 */
export const INPUT_CHARS_PER_TOKEN = 3;
/** A digest's cap, in characters per reserved output token. */
export const OUTPUT_CHARS_PER_TOKEN = 4;

export function inputCharactersFor(limits: { inputTokens: number }): number {
  return Math.max(2_000, limits.inputTokens * INPUT_CHARS_PER_TOKEN);
}

export function outputCharactersFor(limits: { outputTokens: number }): number {
  return limits.outputTokens * OUTPUT_CHARS_PER_TOKEN;
}

export interface StepLimits {
  inputTokens: number;
  outputTokens: number;
}

/**
 * The input/output allowance for one inference step, from the model's own
 * advertised window. A caller with a fixed digest in mind passes its output
 * reserve; everyone else takes the derived share.
 *
 * A window too small to hold the instructions plus any evidence is rejected
 * here rather than silently stripping them, and the refusal names the only
 * remedy there is: a different model, or a narrower scope.
 */
export function limitsFor(
  descriptor: ModelDescriptor,
  outputTokens?: number,
  /** The effort the request carries; it sizes `THINKING_STEP_TOKENS`. */
  effort?: ReasoningEffort,
): StepLimits {
  const windowTokens = descriptor.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  const answer =
    outputTokens ??
    Math.min(
      descriptor.maxOutputTokens ?? OUTPUT_MAX,
      Math.max(OUTPUT_MIN, Math.floor(windowTokens * OUTPUT_SHARE)),
    );
  // Most structured steps name no effort and send the Standard end, which on
  // a model that cannot stop is still a step of thinking, so an unnamed
  // effort is read as the model's least one.
  const sent =
    effort ??
    (descriptor.capabilities.reasoning ? effortFor(0, descriptor) : undefined);
  const thinking = thinkingSteps(sent, descriptor) * THINKING_STEP_TOKENS;
  // Never past what the model says it can generate at all.
  const output = Math.min(
    answer + thinking,
    descriptor.maxOutputTokens ?? Number.POSITIVE_INFINITY,
  );
  // The headroom hedges against estimation error. A local runtime reports no
  // token count before the call, so the app divides characters by a ratio and
  // holds back a share of the window. An underestimate makes the runtime drop
  // tokens off the front of the prompt with no error, taking the instructions
  // with them.
  //
  // A provider that counts exactly need not pay it: `estimate()` answers
  // `exact` per request, since an adapter may count exactly on some requests
  // and not others. Waiving the headroom means reading `exact` at the size
  // guard, not adding a capability flag.
  const inputTokens =
    Math.floor(windowTokens * (1 - CONTEXT_HEADROOM)) - output;
  if (inputTokens < MIN_INPUT_TOKENS)
    throw new ModelRunError({
      code: "context-too-large",
      message:
        "This model's context window is too small for the assistant's instructions and evidence. Choose a model with a larger context window.",
      retryable: false,
    });
  return { inputTokens, outputTokens: output };
}

/** Every run limit, derived from the model that will answer. */
export function budgetFor(
  descriptor: ModelDescriptor,
  effort?: ReasoningEffort,
): RunBudget {
  const limits = limitsFor(descriptor, undefined, effort);
  // `limitsFor` has refused anything under `MIN_INPUT_TOKENS`, so this
  // subtraction cannot go negative.
  const totalCharacters =
    Math.floor(limits.inputTokens * CHARACTERS_PER_TOKEN) -
    INSTRUCTION_RESERVE -
    MANIFEST_RESERVE;
  return {
    // One source may fill the admissible window, so no document the model
    // could hold is refused.
    sourceCharacters: totalCharacters,
    totalCharacters,
    historyCharacters: Math.floor(totalCharacters * HISTORY_SHARE),
    referenceCharacters: Math.min(
      Math.floor(totalCharacters * REFERENCE_SHARE),
      REFERENCE_MAX,
    ),
    steps: RUN_STEPS,
    toolCallsPerStep: TOOL_CALLS_PER_STEP,
    toolCallsPerRun: TOOL_CALLS_PER_RUN,
    readWindow: Math.min(totalCharacters, READ_WINDOW_CEILING),
    manifestRows: manifestRowsFor(totalCharacters),
    inputTokens: limits.inputTokens,
    outputTokens: limits.outputTokens,
  };
}

/**
 * How far one segment of a long source overlaps the next, when a workflow
 * reads it in windows. A passage that straddles a cut is whole in one of the
 * two windows when it is shorter than this, which is why a quote the app
 * verifies is asked to stay short.
 */
export const SEGMENT_OVERLAP = 600;

// ── Workflow bounds ──────────────────────────────────────────────────────────
//
// The `/where` bounds are runaway guards, like the step limits: the
// ranking reads every summary whatever the window, and these bound how
// much prose the run then reads in full — the part that costs minutes on a
// local model and money on a remote one.

/**
 * The longest description of a moment the writer may send. It travels as
 * data inside every step of the run, so it is bounded where the run starts
 * rather than trusted to fit.
 */
export const LOCATE_SENTENCE_MAX = 500;

/**
 * The book's names as a `/where` step reads them, and as a summary
 * is given its cast to spell. A long cast is bounded, because the list is for
 * recognising and spelling, not a census.
 *
 * A name longer than `CHARACTER_NAME_LENGTH` is dropped rather than cut: a
 * truncated name is a different name. `KNOWN_NAMES_CHARACTERS` bounds the
 * whole block, which rides beside every window a judge reads, so it is kept
 * well under the smallest source allowance `budgetFor` answers, and
 * `quoteInSection` plans its windows net of it.
 */
export const CHARACTER_NAMES_MAX = 60;
export const CHARACTER_NAME_LENGTH = 60;
export const KNOWN_NAME_ALIASES_MAX = 8;
export const KNOWN_NAMES_CHARACTERS = 2_000;

/** Sections one ranking step may put forward, most likely first. */
export const LOCATE_PICKS_PER_CHUNK = 4;

/**
 * Sections the whole run reads in full. On a book whose summaries need
 * several ranking steps, each step's picks are interleaved by rank until this
 * many are chosen, with no extra call to merge them.
 */
export const LOCATE_CANDIDATES_MAX = 8;

/**
 * How much of one summary a ranking row carries. A summary is written to be
 * short, but it is a file the writer can edit; one grown long would crowd
 * the others out of the step.
 */
export const LOCATE_SUMMARY_CHARACTERS = 2_000;

/**
 * The answer a wide review's reading step may write: findings across
 * several Sections, each with its quotes. The fit test measures the input
 * against the window left after this reserve; measured against the default
 * share, a Part that fits would make a request larger than the test allowed.
 */
export const REVIEW_DIRECT_OUTPUT_TOKENS = 4_000;

/** A map step answers with one short tool call. */
export const REVIEW_MAP_OUTPUT_TOKENS = 1_500;

/**
 * The least of a summary a map row carries once the rows are shrunk to fit
 * one step: below it a summary stops saying what happens, so the map chunks
 * instead.
 */
export const REVIEW_ROW_FLOOR = 300;

/**
 * The most of a map step a structure review's `LENGTHS` block may take:
 * a share of what the step leaves after its reserve, so
 * the rows keep the larger part of the step they exist for. The block is one
 * line per node of the frame and grows with the book; a block over this is
 * not sent at all, never cut, as `lengthsBlock` requires.
 */
export const REVIEW_LENGTHS_SHARE = 0.25;

/**
 * `/map`'s bounds. A placement step answers for at most
 * `MAP_UNITS_PER_STEP` rows: on a CPU the output tokens dominate, so a step
 * is bounded by what it must write as well as by what it reads. A Part row
 * carries each of its Sections' summaries cut to its share of the room, never
 * below `MAP_PART_LINE_FLOOR`; a summary opens on what happens, so its
 * opening says what the Section does. A Part that still does not fit is
 * reported too large, never thinned further. At most `MAP_ANCHORS_MAX`
 * issues are read for a quote, one window each, which is all a default
 * `/map` sends to a remote model beyond the summaries.
 */
export const MAP_UNITS_PER_STEP = 12;
export const MAP_PART_LINE_FLOOR = 150;
export const MAP_ANCHORS_MAX = 3;

/**
 * The fit step's answer: one small call naming a shape and one line
 * of why, sized for that alone, since on a CPU the output tokens are the
 * step's cost.
 */
export const MAP_FIT_OUTPUT_TOKENS = 500;

/**
 * A Section map's answer: one entry per beat, each a start copied
 * from the prose and a line of why. Three Acts has three beats and the most
 * is Freytag's five; about 2,000 tokens leaves room for a long start on
 * every one.
 */
export const MAP_BEATS_OUTPUT_TOKENS = 2_000;

/**
 * Room a Section map holds back beside the Section for what is not text it
 * can measure: the tool's schema and the request's framing. The
 * instructions, the `PASSAGE` header and the retry's worst case are each
 * measured by the code that writes them (`mapSectionRoom`), so this is only
 * what they cannot count.
 */
export const MAP_BEATS_RESERVE = 1_500;

/**
 * The most results `/verify`'s judge reads: three a search at the
 * three-search cap, after the dedupe. Few enough that each is read, not
 * skimmed, on an 8B model; the fit spreads them over the searches so one
 * wide search cannot crowd out the others.
 */
export const VERIFY_JUDGE_RESULTS = 9;

/** The proposing step's answer: up to three short queries, thinking off. */
export const VERIFY_PROPOSE_OUTPUT_TOKENS = 300;

/**
 * The judge's answer: a verdict, up to five sources with their quotes, the
 * reasoning and a fix. `limitsFor` adds the reserve for its thinking on top.
 */
export const VERIFY_JUDGE_OUTPUT_TOKENS = 1_200;

/**
 * A beta reader's journal entry: a reaction, what it believes,
 * its questions, its people, whether it reads on, the open predictions it
 * settles and up to three new ones, each a short line.
 */
export const READ_ON_OUTPUT_TOKENS = 1_500;

/** `/predict`'s answer: up to three predictions, a line each. */
export const PREDICT_OUTPUT_TOKENS = 400;

/**
 * One chunk's facts (`application/ledger.ts`): up to `CLAIM_LIMITS.perChunk`
 * claims of seven short fields each, about fifty tokens a claim.
 */
export const LEDGER_OUTPUT_TOKENS = 4_000;

/** One candidate's judgement (`judge.ts`): a verdict and three short lines. */
export const JUDGE_OUTPUT_TOKENS = 600;

/**
 * The book's place and thing groups (`application/entities.ts`): numbers
 * only, a few tokens each, for at most `ENTITY_NAMES_MAX` names.
 */
export const ENTITY_OUTPUT_TOKENS = 2_000;

/**
 * How much of its own journal a reader is reminded of before reading on: the
 * last few entries' "what I believe is happening", most recent last. The
 * journal is never re-read whole: what a reader remembers of chapter two by
 * chapter twenty is its belief, not its notes.
 */
export const READING_MEMORY_ENTRIES = 8;
export const READING_MEMORY_CHARACTERS = 4_000;

/** Whether history needs a compaction pass before the next step. */
export function historyOverBudget(
  characters: number,
  budget: RunBudget,
): boolean {
  return characters > budget.historyCharacters;
}
