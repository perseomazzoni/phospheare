// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { fold } from "../domain/textMatch";

// The prompt layers, measured on matched tasks. The question is whether the
// persona layers (`composeVoice`) narrow what the writer gets: a voice that
// refers a valid request away, or answers only its own department. A unit
// test can check only that the voice frame states its authority order, so
// the same requests, in the same rooms, are answered with the persona layers
// and genre and without them, and scored on whether the request was done and
// relevant, not on how the persona sounded.
//
// The tasks and pure scoring only; `scripts/layers-eval.mjs` runs the real
// assistant.

/** What a task asks for, by the department it would fall to. */
export type TaskSpecialty =
  "lookup" | "continuity" | "line" | "structure" | "character" | "mixed";

export interface LayerTask {
  id: string;
  specialty: TaskSpecialty;
  /** The planted book (seeded slips to find) or the clean one. */
  book: "planted" | "clean";
  /** The writer's request, as typed. */
  prompt: string;
  /**
   * What a complete answer must carry, as groups: each group is met when
   * the answer contains any of its words. The continuity task's groups are
   * the planted slips, supplied by the runner.
   */
  facts: readonly (readonly string[])[];
}

export const LAYER_TASKS: Readonly<Record<"en" | "it", readonly LayerTask[]>> =
  {
    en: [
      {
        id: "lookup",
        specialty: "lookup",
        book: "clean",
        prompt:
          "When the narrator arrives, what is Hollis wearing, and how old is she?",
        facts: [["red jacket"], ["hat"], ["sixty-one", "61"]],
      },
      {
        id: "continuity",
        specialty: "continuity",
        book: "planted",
        prompt:
          "Read the whole book and list every contradiction you find — names, ages, colours, days — with the two places that disagree.",
        facts: [],
      },
      {
        id: "line",
        specialty: "line",
        book: "clean",
        prompt:
          "Rewrite the opening paragraph of 'the pass' so it is tighter, keeping every fact in it.",
        facts: [["bus"], ["friday", "8 march"], ["hollis"], ["red"], ["hat"]],
      },
      {
        id: "structure",
        specialty: "structure",
        book: "clean",
        prompt:
          "Which of the four sections does the least work in the story, and what would you change about it?",
        facts: [["the pass", "the logbook", "the village", "the storm"]],
      },
      {
        id: "character",
        specialty: "character",
        book: "clean",
        prompt: "What does Hollis want, as far as the book shows it?",
        facts: [["hollis"]],
      },
      {
        id: "mixed",
        specialty: "mixed",
        book: "clean",
        prompt:
          "Give me two line-level fixes for 'the storm', and tell me whether its ending sets up what comes next.",
        facts: [["storm"]],
      },
    ],
    it: [
      {
        id: "lookup",
        specialty: "lookup",
        book: "clean",
        prompt:
          "Quando il narratore arriva, com'è vestita Ottavia e quanti anni ha?",
        facts: [["cappotto verde"], ["berretto"], ["cinquantadue", "52"]],
      },
      {
        id: "continuity",
        specialty: "continuity",
        book: "planted",
        prompt:
          "Leggi tutto il libro ed elencami ogni contraddizione che trovi — nomi, età, colori, giorni — con i due punti in cui non tornano.",
        facts: [],
      },
      {
        id: "line",
        specialty: "line",
        book: "clean",
        prompt:
          "Riscrivimi il primo paragrafo de 'il faro' più asciutto, senza perdere nessuna informazione.",
        facts: [
          ["traghetto"],
          ["venerdì", "14 ottobre"],
          ["ottavia"],
          ["cappotto"],
          ["berretto"],
        ],
      },
      {
        id: "structure",
        specialty: "structure",
        book: "clean",
        prompt:
          "Quale delle quattro sezioni lavora meno per la storia, e cosa ci cambieresti?",
        facts: [["il faro", "il registro", "il paese", "la tempesta"]],
      },
      {
        id: "character",
        specialty: "character",
        book: "clean",
        prompt:
          "Che cosa vuole Ottavia, per quello che il libro lascia vedere?",
        facts: [["ottavia"]],
      },
      {
        id: "mixed",
        specialty: "mixed",
        book: "clean",
        prompt:
          "Dammi due correzioni di frase per 'la tempesta', e dimmi se il finale prepara quello che viene dopo.",
        facts: [["tempesta"]],
      },
    ],
  };

/** The share of `facts` groups the answer meets (1 when there are none). */
export function factsCovered(
  answer: string,
  facts: readonly (readonly string[])[],
): number {
  if (facts.length === 0) return 1;
  const text = fold(answer);
  return (
    facts.filter((group) => group.some((word) => text.includes(fold(word))))
      .length / facts.length
  );
}

/**
 * The colleagues the answer names: a referral in this app is prose, never
 * a field (`voice.ts` says whose department a thing is), so it is counted
 * by the other personas' names in the text. The persona answering is not
 * a referral to itself.
 */
export function referralsIn(
  answer: string,
  self: string,
  names: readonly string[],
): string[] {
  return names.filter(
    (name) => name !== self && new RegExp(`\\b${name}\\b`, "u").test(answer),
  );
}

/** A blind grader's reading of one answer. */
export interface Grade {
  /** Did the answer do what the writer asked: all of it, part, or none. */
  done: "all" | "part" | "none";
  /**
   * Did it decline, postpone or hand any part of the request to someone else
   * instead of doing it.
   */
  handedOff: boolean;
  /** Is it about this book and this request. */
  relevant: "yes" | "partly" | "no";
  why: string;
}

/**
 * What the grader is told. It sees the book, the request and the answer,
 * never which arm, room or persona answered, and judges the work, not the
 * voice: completion and relevance, not persona compliance.
 */
export const GRADER_INSTRUCTIONS = `You grade one answer an assistant gave a writer about their book. You are shown the book, the writer's request and the answer; you are not told who answered or how they were instructed, and how the answer sounds is not your concern. Judge three things. done: did the answer do what the writer asked — "all" of it, "part" of it, or "none". A question the answer asks back instead of doing the work counts as not done for that part. handedOff: did the answer decline, postpone, or send any part of the request to someone else (another assistant, another chat, the writer) INSTEAD of doing it — true or false; naming a colleague while still doing the work is not handing off. relevant: is the answer about this book and this request — "yes", "partly" or "no". Give a one-sentence why.`;

export const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["done", "handedOff", "relevant", "why"],
  properties: {
    done: { type: "string", enum: ["all", "part", "none"] },
    handedOff: { type: "boolean" },
    relevant: { type: "string", enum: ["yes", "partly", "no"] },
    why: { type: "string" },
  },
} as const;

/** The grader's answer as a `Grade`, or `null` for any other shape. */
export function gradeOf(answer: string): Grade | null {
  let value: unknown;
  try {
    value = JSON.parse(answer);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { done, handedOff, relevant, why } = value as Record<string, unknown>;
  if (
    !["all", "part", "none"].includes(done as string) ||
    typeof handedOff !== "boolean" ||
    !["yes", "partly", "no"].includes(relevant as string)
  )
    return null;
  return {
    done: done as Grade["done"],
    handedOff,
    relevant: relevant as Grade["relevant"],
    why: typeof why === "string" ? why : "",
  };
}

/** One answered task, as the summary reads it. */
export interface LayerRow {
  arm: "layers" | "bare";
  task: string;
  persona: string;
  room: string;
  facts: number;
  referrals: number;
  grade: Grade | null;
}

export interface ArmSummary {
  arm: LayerRow["arm"];
  answers: number;
  /** Mean of done: all 1, part ½, none 0, over graded answers. */
  done: number;
  handedOff: number;
  /** Mean of relevant: yes 1, partly ½, no 0. */
  relevant: number;
  /** Mean share of required facts carried. */
  facts: number;
  /** Answers that named a colleague. */
  referring: number;
  ungraded: number;
}

const SCORE = { all: 1, part: 0.5, none: 0, yes: 1, partly: 0.5, no: 0 };

/** Each arm's means over its rows, the arms in the order given. */
export function summarize(
  rows: readonly LayerRow[],
  arms: readonly LayerRow["arm"][] = ["layers", "bare"],
): ArmSummary[] {
  return arms.map((arm) => {
    const mine = rows.filter((row) => row.arm === arm);
    const graded = mine.flatMap((row) => (row.grade ? [row.grade] : []));
    const mean = (values: readonly number[]) =>
      values.length === 0
        ? 0
        : Math.round(
            (values.reduce((sum, one) => sum + one, 0) / values.length) * 1000,
          ) / 1000;
    return {
      arm,
      answers: mine.length,
      done: mean(graded.map((one) => SCORE[one.done])),
      handedOff: graded.filter((one) => one.handedOff).length,
      relevant: mean(graded.map((one) => SCORE[one.relevant])),
      facts: mean(mine.map((row) => row.facts)),
      referring: mine.filter((row) => row.referrals > 0).length,
      ungraded: mine.length - graded.length,
    };
  });
}
