// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A chat turn's request, ordered by rate of change.
//
// Prompt caching is prefix-based everywhere it exists: llama.cpp and
// Ollama reuse the KV cache up to the first byte that differs, OpenAI
// caches prefixes automatically, and Anthropic marks them explicitly.
// One ordering serves all of them, stable first and volatile last,
// because a change at position N throws away everything after it,
// including the whole history and the attached chapter.
//
// The blocks sit in the order they change in:
//   PROSE_BOUNDARY   never
//   projectBriefing  when the writer edits their project properties
//   workflow         per chat kind / review task
//   persona          when the writer switches voice mid-conversation
//   ---- and below, in the final user message ----
//   references       a review's declared documents, every turn
//   manifest         whenever a section is renamed or a summary goes stale
//   sources          every turn
//   the question     every turn
//
// The briefing is above the persona because a persona swap is a control
// the writer presses, while a project's title and language are set once.
// The manifest is below the line for the opposite reason: it moves
// while the writer is writing.
//
// The references change rarely, so by rate of change they belong above
// the line. They are below it because above it is the system
// instructions, whose authority a document from a shared folder must not
// borrow, so they are re-read with every turn. They come first in the
// message by the same rate-of-change order.
//
// An empty block is left out.

import { genreBriefing } from "../domain/genres";
import {
  NAMED_REFERENCE_CLAUSE,
  PROSE_BOUNDARY,
  REQUEST_LANGUAGE,
  projectBriefing,
  workflowInstructions,
} from "../domain/policy";
import type { ChatKind, ProjectFacts, ReviewTask } from "../domain/types";

/** The blocks of a turn's final user message, each one text or empty. */
export interface RequestParts {
  /** A review's declared documents. */
  references: string;
  /** The documents the chat wants that the writer has not written. */
  missing: string;
  /**
   * A beta reader's memory of its reading: what it believed after each
   * Section and what it still expects, so a `/review` or a `/put-down` comes
   * from the reader who kept the journal. Its memory, never its notes whole.
   */
  readerMemory: string;
  /**
   * What the writer said they need for this Section, so the room's opening
   * question is not asked again.
   */
  need: string;
  /** Where the writer stopped, on coming back. */
  momentum: string;
  /**
   * The other chats by the names the writer's interface gives them, for the
   * one-line pointer General and Drafting may give. Data beside the request,
   * never in the instructions: the names follow the interface language, and
   * the cached prefix must not move when the writer switches it.
   */
  chatNames: string;
  /** What the book's other chats found, for an editor's letter. */
  letter: string;
  /** The pre-pass over the attached prose. */
  briefing: string;
  /** A typed fact check's list, beside the prose it is about. */
  facts: string;
  manifest: string;
  /** The attached prose. */
  sources: string;
  /** The margin of the chapters attached. */
  margin: string;
  /** The writer's words. */
  request: string;
  /**
   * Whether the request is a typed command: the language line stands under
   * the writer's own words only (`REQUEST_LANGUAGE`).
   */
  command: boolean;
}

/** A turn's final user message, the volatile end of the request. */
export function requestMessage(parts: RequestParts): string {
  return [
    parts.references,
    parts.missing,
    parts.readerMemory,
    parts.need,
    parts.momentum,
    parts.chatNames,
    parts.letter,
    parts.briefing,
    parts.facts,
    parts.manifest,
    parts.sources,
    parts.margin,
    `Writer request:\n${parts.request}`,
    parts.command ? "" : REQUEST_LANGUAGE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What a turn's system instructions are made of. */
export interface InstructionParts {
  facts: ProjectFacts | null;
  kind: ChatKind;
  reviewTask: ReviewTask | undefined;
  /** Whether a name narrowed what the review checks against. */
  named: boolean;
  /**
   * How to read the references, or empty when the turn attached none: a
   * blank page the room declares attaches nothing, and the clause would
   * explain an empty block on every turn.
   */
  referenceClause: string;
  persona: string;
}

/** A turn's system instructions, the stable start of the request. */
export function turnInstructions(parts: InstructionParts): string {
  return [
    PROSE_BOUNDARY,
    projectBriefing(parts.facts, parts.kind),
    // The declared genre's contract, right after the book it belongs to:
    // fixed per project.
    genreBriefing(parts.facts, parts.kind),
    workflowInstructions(parts.kind, parts.reviewTask),
    // After the rubric, and only when a name narrowed what it checks
    // against: fixed text.
    parts.named ? NAMED_REFERENCE_CLAUSE : "",
    parts.referenceClause,
    parts.persona,
  ]
    .filter(Boolean)
    .join("\n\n");
}
