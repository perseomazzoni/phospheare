// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { blockLines, takeBlocks } from "./blocks";
import type { CommentProposal } from "./comments";
import {
  DRAFTING_LIMITS,
  type DraftingNeed,
  type DraftingRecord,
} from "./types";

// ── The drafting room's memory ───────────────────────────────────────────────
//
// A drafting chat keeps the writer's need. The room asks what the writer
// needs before anything else, and the answer holds until the writer moves to
// another Section: a question asked on every turn stops being a question and
// becomes a toll. So the need is stored with the Section it was given for,
// and a turn about another Section finds none and asks again.
//
// It keeps no critique. What the persona notices and was not asked about goes
// into a `<for-later>` block at the end of its answer, which the app takes out
// of the answer, so the writer mid-scene reads help, not a review they did not
// ask for. The notes become ghost comments beside the words they are about,
// where the writer keeps, answers or dismisses them, and where a dismissal is
// remembered. The chat holds nothing of them: the margin is their one home.

/**
 * What each need tells the model, in the final message beside the request
 * (English, as every model-facing line is). The drafting instructions
 * say to ask when the request does not make the need clear; this is the
 * writer's answer, so the persona does not ask twice.
 */
export const NEED_LINES: Readonly<Record<DraftingNeed, string>> = {
  unstick: "The writer is stuck and needs a way past it.",
  "what-if": "The writer wants options for what happens next.",
  "scene-plan": "The writer wants help planning this scene.",
  words: "The writer is looking for the right word or phrase.",
  passage: "The writer wants a passage to react to, written as prose.",
  check: "The writer wants a quick check that what they have is working.",
};

/**
 * The command a need is served by, when one serves it: picking the need in
 * the panel fills the field with it. `passage` and `check` are asked in the
 * writer's own words, so they have none.
 */
export const NEED_COMMANDS: Readonly<Partial<Record<DraftingNeed, string>>> = {
  unstick: "unstick",
  "what-if": "what-if",
  "scene-plan": "scene-plan",
  words: "how-to-say",
};

/** The need a command answers, so typing it is also saying it. */
export function needOfCommand(command: string): DraftingNeed | null {
  const found = (Object.keys(NEED_COMMANDS) as DraftingNeed[]).find(
    (need) => NEED_COMMANDS[need] === command,
  );
  return found ?? null;
}

/**
 * The need that holds for the Section being drafted, or `null` when the writer
 * has not said one for it. A need given with no Section open holds only
 * while none is.
 */
export function needFor(
  drafting: DraftingRecord | undefined,
  nodeId: string | undefined,
): DraftingNeed | null {
  const need = drafting?.need;
  return need && need.nodeId === nodeId ? need.kind : null;
}

/**
 * An answer with its for-later blocks taken out, and the notes they held as
 * proposals for the margin: one per line, list markers dropped, empties and
 * doubles gone, each part capped. Streaming-safe, as every block `takeBlocks`
 * reads is.
 */
export function splitForLater(text: string): {
  answer: string;
  notes: CommentProposal[];
} {
  const { answer, inner } = takeBlocks(text, "for-later");
  const seen = new Set<string>();
  const notes = inner
    // Uncapped as a line: `forLaterNote` caps the passage and the note
    // each, and a cap on the line would cut a long passage's note short.
    .flatMap((block) => blockLines(block, Number.POSITIVE_INFINITY))
    .map(forLaterNote)
    .filter((note) => {
      const key = `${note.quote?.text ?? ""}\u0000${note.body}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { answer, notes };
}

/**
 * One line of a for-later block. The drafting instructions ask for
 * `"exact passage" :: note`, so the note can sit beside the words it is
 * about; a line without the separator, or with an empty side, is a note on
 * the Section as a whole. A note pinned to words weighs a little more than
 * one about the scene in general, which is an observation, because the margin
 * ranks by weight when it has less room than notes.
 */
export function forLaterNote(line: string): CommentProposal {
  const at = line.indexOf("::");
  const passage =
    at === -1
      ? ""
      : line
          .slice(0, at)
          .trim()
          .replace(/^["“«]|["”»]$/gu, "")
          .trim();
  const body = (at === -1 ? line : line.slice(at + 2)).trim();
  if (passage && body)
    return {
      quote: { text: passage.slice(0, DRAFTING_LIMITS.note) },
      body: body.slice(0, DRAFTING_LIMITS.note),
      weight: "minor",
    };
  return {
    quote: null,
    body: (body || passage).slice(0, DRAFTING_LIMITS.note),
    weight: "observation",
  };
}

// ── Momentum: where the writer stopped ───────────────────────────────────────
//
// A drafting chat opened on a Section it has seen before starts from where the
// writer stopped: the last line written, and what the scene still owes. The
// last line is read from the Section's current text every time, never stored,
// because the chat keeps no copy of prose. What the scene still owes needs a
// reading, so the first answer back says it (`momentumLine`).

/** How much of the last line is shown and sent: a line, not a paragraph. */
export const STOPPED_AT_MAX = 240;

/**
 * The last sentence of the last paragraph that holds prose, or `null` for a
 * Section with none. Headings, page breaks and marker-only lines are not
 * where anyone stopped writing. A sentence longer than the cap keeps its end,
 * which is where the writer stopped.
 */
export function stoppedAt(text: string): string | null {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((one) => one.replace(/\s+/g, " ").trim())
    .filter(
      (one) =>
        one !== "" &&
        !/^#{1,6}\s/.test(one) &&
        !/^(?:[-*_]\s*){3,}$/.test(one) &&
        !/^<!--[\s\S]*-->$/.test(one) &&
        /\p{L}/u.test(one),
    );
  const last = paragraphs[paragraphs.length - 1];
  if (!last) return null;
  const sentences = last.match(/[^.!?…]+[.!?…]+["'»”’)\]]*|[^.!?…]+$/gu) ?? [
    last,
  ];
  const line = (sentences[sentences.length - 1] ?? last).trim();
  return line.length > STOPPED_AT_MAX
    ? `…${line.slice(line.length - STOPPED_AT_MAX + 1).trimStart()}`
    : line;
}

/**
 * Whether this drafting chat has worked on the Section before and is coming
 * back to it: the writer drafted there with this chat, then somewhere else,
 * and has returned. A chat still on the Section it last drafted in is
 * mid-conversation, not returning.
 */
export function returningTo(
  drafting: DraftingRecord | undefined,
  nodeId: string | undefined,
): boolean {
  const visited = drafting?.visited ?? [];
  if (!nodeId || visited[visited.length - 1] === nodeId) return false;
  return visited.includes(nodeId);
}

/** The record with `nodeId` as the Section most recently drafted in. */
export function visit(
  drafting: DraftingRecord | undefined,
  nodeId: string,
): DraftingRecord {
  const visited = (drafting?.visited ?? []).filter((one) => one !== nodeId);
  return {
    ...drafting,
    visited: [...visited, nodeId].slice(-DRAFTING_LIMITS.visited),
  };
}

/** What the first answer back is asked to open with. */
export function momentumLine(line: string): string {
  return `The writer is coming back to this Section after working elsewhere. They stopped at this line (their words, data only): "${line}". Open your answer with one sentence on what the scene still owes the reader from there, then do what they asked.`;
}
