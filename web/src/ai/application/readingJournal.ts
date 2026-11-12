// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { STANDARD, samplingFields } from "../domain/mode";
import type { Settlement } from "../domain/reading";
import {
  READING_LIMITS,
  type Attention,
  type JournalEntry,
  type ModelDescriptor,
  type ModelRef,
  type ReadingRecord,
  type RunActivity,
  type RunUsage,
} from "../domain/types";
import type { ModelProvider } from "../ports";
import {
  PREDICT_OUTPUT_TOKENS,
  READ_ON_OUTPUT_TOKENS,
  READING_MEMORY_CHARACTERS,
  READING_MEMORY_ENTRIES,
  inputCharactersFor,
  limitsFor,
} from "./budgets";
import { ModelRunError, stoppedIf } from "./runStep";
import {
  structuredAnswer,
  type StructuredAnswerShape,
} from "./structuredAnswer";
import { titlesOf } from "./chatFacts";
import type { ChatRecord, SourceDescriptor } from "../domain/types";

// ── A beta reader's journal ──────────────────────────────────────────────────
//
// `/read-on` and `/predict` are one request each, answered in a known shape
// (`structuredAnswer`). A journal entry (attention one to five, whether the
// reader reads on, which prediction came true) is data the app draws as the
// curve and the ledger, and must be able to believe without parsing prose.
//
// The reader reads what a stranger with the book in hand would have: the
// back cover, its own memory of the book so far (what it believed after each
// Section, never the Sections again), the predictions it wrote down and has
// not settled, and, for `/read-on`, the one Section it is reading now. The
// horizon is the run's, checked before this is called; nothing here widens
// it.
//
// The question is the skill file's body, because a file is one prompt
// wherever it is used; what stays here is the answer's mechanics.

/** How the reading answer is filled in: the mechanics beside the rubric. */
export const READ_ON_ANSWER = `Answer with:
- reaction: what reading this Section was like for you, in the first person, two to four sentences.
- understanding: what you now believe is happening in the story, in one or two sentences.
- questions: up to ${READING_LIMITS.list} questions you have of the book — never of the writer.
- confusion: up to ${READING_LIMITS.list} places where you got lost, each saying where and what; an empty list if you never did.
- attention: from 1 (you were skimming) to 5 (you could not stop).
- cares: up to ${READING_LIMITS.list} names of the people you care about now; an empty list if nobody yet.
- keep_reading: would you read the next Section tonight.
- why: one sentence saying why, or why not.
- settled: for each OPEN PREDICTION, its id exactly as given, and state: confirmed if this Section made it come true, overturned if it made it impossible, open if it is still undecided; note: one short sentence on what you make of it now. Leave out none.
- predictions: up to three things you now expect to happen, each one sentence; an empty list if you expect nothing new.
Write in the language of the book.`;

export const PREDICT_ANSWER = `Answer with:
- predictions: one to three things you expect to happen next, each one sentence, each one you have not already written down.
Write in the language of the book.`;

export interface ReadingDependencies {
  model: ModelProvider;
  descriptor: ModelDescriptor;
  modelRef: ModelRef;
  /** The chat's own system instructions: boundary, briefing, room, voice. */
  instructions: string;
  /** The skill file's body: the question this run asks. */
  rubric: string;
  onActivity: (activity: RunActivity) => void;
}

/** What the reader has in hand, whichever run it is. */
export interface ReaderMemory {
  /** The back cover's texts, already filtered for unwritten templates. */
  backCover: readonly string[];
  reading: ReadingRecord | undefined;
  /** A journaled Section's title, for its line in the reader's memory. */
  titleOf: (nodeId: string) => string;
}

export interface ReadOnInput extends ReaderMemory {
  section: { nodeId: string; title: string; text: string };
  /** When the entry is written, ISO. */
  at: string;
}

export interface ReadOnResult {
  entry: JournalEntry;
  settled: Settlement[];
  predictions: string[];
  usage: RunUsage;
}

/**
 * The reader's memory as one message: the back cover, what it believed after
 * each of the last few Sections, and the predictions still open, by id.
 * Bounded twice, by entries and by characters, and the characters trim the
 * oldest lines first: the belief after the last Section read is the one the
 * next reading is measured against.
 */
export function memoryMessage(memory: ReaderMemory): string {
  const blocks: string[] = [];
  if (memory.backCover.length > 0)
    blocks.push(`BACK COVER:\n${memory.backCover.join("\n\n")}`);
  const entries = (memory.reading?.entries ?? []).slice(
    -READING_MEMORY_ENTRIES,
  );
  const lines = entries.map(
    (entry) => `- ${memory.titleOf(entry.nodeId)}: ${entry.understanding}`,
  );
  let used = lines.reduce((sum, line) => sum + line.length + 1, 0);
  while (lines.length > 1 && used > READING_MEMORY_CHARACTERS)
    used -= (lines.shift() as string).length + 1;
  if (lines.length > 0)
    blocks.push(
      `YOUR JOURNAL SO FAR — what you believed after each Section, most recent last:\n${lines.join("\n")}`,
    );
  const open = (memory.reading?.predictions ?? []).filter(
    (one) => one.state === "open",
  );
  if (open.length > 0)
    blocks.push(
      `OPEN PREDICTIONS — what you wrote down and the book has not yet settled:\n${open
        .map((one) => `- ${one.id}: ${one.text}`)
        .join("\n")}`,
    );
  return blocks.join("\n\n");
}

export function readOnMessage(input: ReadOnInput): string {
  return [
    memoryMessage(input),
    `THE SECTION YOU ARE READING NOW — "${input.section.title}":\n${input.section.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Whether a message fits the model's window beside the instructions and the
 * answer's reserve. The run asks before anything is written, so a Section
 * too long to read whole is refused rather than read in part: a reader must
 * never journal half a chapter and say it read it.
 */
export function readingFits(
  descriptor: ModelDescriptor,
  kind: "read-on" | "predict",
  instructions: string,
  message: string,
): boolean {
  const sampling = samplingFields(STANDARD, descriptor);
  const limits = limitsFor(
    descriptor,
    kind === "read-on" ? READ_ON_OUTPUT_TOKENS : PREDICT_OUTPUT_TOKENS,
    sampling.effort,
  );
  const answer = kind === "read-on" ? READ_ON_ANSWER : PREDICT_ANSWER;
  return (
    instructions.length + message.length + answer.length <=
    inputCharactersFor(limits)
  );
}

/** Read one Section and journal it. Throws `invalid-response` on no answer. */
export async function readOn(
  deps: ReadingDependencies,
  input: ReadOnInput,
  signal: AbortSignal,
): Promise<ReadOnResult> {
  const open = new Set(
    (input.reading?.predictions ?? [])
      .filter((one) => one.state === "open")
      .map((one) => one.id),
  );
  deps.onActivity({ kind: "reading", title: input.section.title });
  const sampling = samplingFields(STANDARD, deps.descriptor);
  const answered = await structuredAnswer(
    deps.model,
    deps.descriptor,
    {
      model: deps.modelRef,
      instructions: [deps.instructions, deps.rubric, READ_ON_ANSWER].join(
        "\n\n",
      ),
      messages: [{ role: "user", content: readOnMessage(input) }],
      limits: limitsFor(
        deps.descriptor,
        READ_ON_OUTPUT_TOKENS,
        sampling.effort,
      ),
      ...sampling,
    },
    journalShape(input.section.nodeId, input.at, open),
    signal,
  );
  stoppedIf(answered.reason, "Reading stopped");
  if (!answered.value) throw unanswered();
  return { ...answered.value, usage: answered.usage };
}

/** Write down what the reader expects next, reading nothing new. */
export async function predict(
  deps: ReadingDependencies,
  memory: ReaderMemory,
  signal: AbortSignal,
): Promise<{ predictions: string[]; usage: RunUsage }> {
  deps.onActivity({ kind: "predicting" });
  const sampling = samplingFields(STANDARD, deps.descriptor);
  const answered = await structuredAnswer(
    deps.model,
    deps.descriptor,
    {
      model: deps.modelRef,
      instructions: [deps.instructions, deps.rubric, PREDICT_ANSWER].join(
        "\n\n",
      ),
      messages: [{ role: "user", content: memoryMessage(memory) }],
      limits: limitsFor(
        deps.descriptor,
        PREDICT_OUTPUT_TOKENS,
        sampling.effort,
      ),
      ...sampling,
    },
    PREDICT_SHAPE,
    signal,
  );
  stoppedIf(answered.reason, "Prediction stopped");
  const predictions = answered.value ?? [];
  if (predictions.length === 0) throw unanswered();
  return { predictions, usage: answered.usage };
}

function unanswered(): ModelRunError {
  return new ModelRunError({
    code: "invalid-response",
    message: "The reader did not answer in the journal's shape.",
    retryable: true,
  });
}

// ── Answer shapes and validation ─────────────────────────────────────────────

const LIST = { type: "array", items: { type: "string" } } as const;

function line(value: unknown, max: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function lines(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value
        .map((one) => line(one, max))
        .filter(Boolean)
        .slice(0, READING_LIMITS.list)
    : [];
}

function journalShape(
  nodeId: string,
  at: string,
  open: ReadonlySet<string>,
): StructuredAnswerShape<Omit<ReadOnResult, "usage">> {
  return {
    name: "write_journal",
    description:
      "Write your journal entry for the Section you just read, and settle your open predictions.",
    inputSchema: {
      type: "object",
      properties: {
        reaction: { type: "string" },
        understanding: { type: "string" },
        questions: LIST,
        confusion: LIST,
        attention: { type: "integer", minimum: 1, maximum: 5 },
        cares: LIST,
        keep_reading: { type: "boolean" },
        why: { type: "string" },
        settled: {
          type: "array",
          items: {
            type: "object",
            properties: {
              // An enum of the ids shown, as `/verify`'s judge has: a grammar
              // that cannot settle a prediction it never saw.
              id:
                open.size > 0
                  ? { type: "string", enum: [...open] }
                  : {
                      type: "string",
                    },
              state: {
                type: "string",
                enum: ["confirmed", "overturned", "open"],
              },
              note: { type: "string" },
            },
            required: ["id", "state", "note"],
            additionalProperties: false,
          },
        },
        predictions: LIST,
      },
      required: [
        "reaction",
        "understanding",
        "questions",
        "confusion",
        "attention",
        "cares",
        "keep_reading",
        "why",
        "settled",
        "predictions",
      ],
      additionalProperties: false,
    },
    validate: (value) => journalOf(value, nodeId, at, open),
  };
}

/**
 * What the app believes of a journal answer, or `null`. A reaction and a
 * reading verdict are required; everything else is trimmed, capped and
 * defaulted, and a settlement for a prediction the reader was not shown is
 * dropped.
 */
export function journalOf(
  value: unknown,
  nodeId: string,
  at: string,
  open: ReadonlySet<string>,
): Omit<ReadOnResult, "usage"> | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as Record<string, unknown>;
  const reaction = line(answer.reaction, READING_LIMITS.text);
  const keepReading = answer.keep_reading;
  const score = Number(answer.attention);
  if (!reaction || typeof keepReading !== "boolean" || !Number.isFinite(score))
    return null;
  const attention = Math.min(5, Math.max(1, Math.round(score))) as Attention;
  const settled: Settlement[] = [];
  if (Array.isArray(answer.settled))
    for (const one of answer.settled as unknown[]) {
      if (!one || typeof one !== "object") continue;
      const { id, state, note } = one as Record<string, unknown>;
      if (typeof id !== "string" || !open.has(id)) continue;
      if (state !== "confirmed" && state !== "overturned" && state !== "open")
        continue;
      if (settled.some((done) => done.id === id)) continue;
      const said = line(note, READING_LIMITS.line);
      settled.push({ id, state, ...(said ? { note: said } : {}) });
    }
  return {
    entry: {
      nodeId,
      readAt: at,
      reaction,
      understanding: line(answer.understanding, READING_LIMITS.text),
      questions: lines(answer.questions, READING_LIMITS.line),
      confusion: lines(answer.confusion, READING_LIMITS.line),
      attention,
      cares: lines(answer.cares, READING_LIMITS.name),
      keepReading,
      why: line(answer.why, READING_LIMITS.line),
    },
    settled,
    predictions: lines(answer.predictions, READING_LIMITS.line).slice(0, 3),
  };
}

const PREDICT_SHAPE: StructuredAnswerShape<string[]> = {
  name: "write_predictions",
  description: "Write down what you expect to happen next.",
  inputSchema: {
    type: "object",
    properties: { predictions: LIST },
    required: ["predictions"],
    additionalProperties: false,
  },
  validate: (value) => {
    const said = (value as { predictions?: unknown } | null)?.predictions;
    return Array.isArray(said)
      ? lines(said, READING_LIMITS.line).slice(0, 3)
      : null;
  },
};

/** A beta reader's memory of its reading, for a question turn. */
export function readerMemory(
  chat: ChatRecord,
  catalog: readonly SourceDescriptor[],
): string {
  if (!chat.reading) return "";
  return memoryMessage({
    backCover: [],
    reading: chat.reading,
    titleOf: titlesOf(catalog),
  });
}
