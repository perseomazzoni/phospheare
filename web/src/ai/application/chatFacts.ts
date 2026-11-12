// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// What a chat record says of itself: its title, what its turns read, the
// documents its persona wants, and whether it is a focused review. Pure
// readings of the record, which the aggregate and every run share.

import { personaById, presetFor } from "../domain/personas";
import { ROOMS, joinReads } from "../domain/rooms";
import {
  actionOf,
  namesReference,
  readsFor,
  skillFor,
  skillsFor,
} from "../domain/skills";
import type {
  ChatRecord,
  ReadRef,
  SourceDescriptor,
  TurnCommand,
} from "../domain/types";
import { oneLine } from "./context";

/** A manuscript node's title by its id, for a reader's memory lines. */
export function titlesOf(
  catalog: readonly SourceDescriptor[],
): (nodeId: string) => string {
  const titles = new Map(
    catalog
      .filter((one) => one.nodeId !== undefined && one.kind === "manuscript")
      .map((one) => [one.nodeId as string, one.title] as const),
  );
  return (nodeId) => titles.get(nodeId) ?? nodeId;
}

/** How long a title taken from the first request may run, in characters. */
const TITLE_FROM_REQUEST = 72;

/**
 * A chat's title from its first request: one line, cut at a word and marked
 * as cut. A raw slice stops mid-thought and reads as the whole question, with
 * nothing to say more was asked.
 */
export function chatTitleFrom(request: string): string {
  const line = oneLine(request);
  if (Array.from(line).length <= TITLE_FROM_REQUEST) return line;
  const head = Array.from(line)
    .slice(0, TITLE_FROM_REQUEST - 1)
    .join("");
  const space = head.lastIndexOf(" ");
  const cut = space > TITLE_FROM_REQUEST / 2 ? head.slice(0, space) : head;
  return `${cut.replace(/[\s,;:.–—-]+$/u, "")}…`;
}

/**
 * What this chat's turns read besides the prose: the declared references of
 * its review, and only in a review at a near scope. A reader chat is never
 * handed a character sheet or a note. Its horizon keeps them out too; this
 * refuses by kind first, so the rule does not rest on the horizon alone.
 */
export function reviewReads(chat: ChatRecord): readonly ReadRef[] {
  const task = chat.preferences.reviewTask;
  if (chat.kind !== "editorial" || !reviewsFocused(chat) || !task) return [];
  return readsFor(task);
}

/**
 * The documents whose absence this chat's persona should ask about: what the
 * room wants, then what the persona's focus reads. A continuity editor with
 * no Continuity Index is working blind, and says so.
 */
export function wantsOf(chat: ChatRecord): readonly ReadRef[] {
  const persona = personaById(chat.preferences.personaId, chat.kind);
  const preset = persona
    ? presetFor(persona, chat.kind, chat.preferences.preset).reads
    : [];
  return joinReads(ROOMS[chat.kind].wants, preset);
}

/**
 * Whether this chat's turns are a review at a near scope, which may submit
 * findings and report coverage, rather than questions. The planned
 * sweep publishes its own turn and never passes through here.
 */
export function reviewsFocused(chat: ChatRecord): boolean {
  const scope = chat.preferences.reviewScope;
  // `runReview` clears a wide scope, so these two can only come from a
  // hand-edited chat file, and such a claim is not a focused review.
  return (
    scope !== undefined && scope.kind !== "structure" && scope.kind !== "part"
  );
}

/**
 * Everything a turn of this chat attaches besides the prose, in priority
 * order: the focused review's own reads (the Editing brief first),
 * then what the room works from, then what the persona's focus works from.
 * One best-effort function attaches them all (`selectDeclared`), so a room's
 * paperwork yields to the prose and the history as a review's does.
 *
 * A reader's list is its room's alone (Lumi's presets read nothing).
 */
export function declaredReads(chat: ChatRecord): readonly ReadRef[] {
  const persona = personaById(chat.preferences.personaId, chat.kind);
  const preset = persona
    ? presetFor(persona, chat.kind, chat.preferences.preset).reads
    : [];
  return joinReads(reviewReads(chat), ROOMS[chat.kind].reads, preset);
}

/**
 * What a question command reads besides the room (`reads:` in its file):
 * `/scene-plan`'s cast and places. Only for a command this chat offers and
 * that asks a question (a review's reads are `reviewReads`'), and, in a
 * reader chat, never past the room's extras, which the skill reader already
 * refuses at build time and the boundary drops again at read time.
 */
export function questionReads(
  chat: ChatRecord,
  command: TurnCommand | undefined,
): readonly ReadRef[] {
  const skill = command ? skillFor(command.skill, skillsFor(chat.kind)) : null;
  return skill && actionOf(skill) === "question" ? skill.reads : [];
}

/**
 * The reference this chat's review was named against, or
 * `undefined` for every declared read. Only in a focused editorial review
 * (never a reader), and only for a task whose command takes a name: a chat
 * file that claims one for another task is claiming what no command typed,
 * and is read as its task reads.
 */
export function namedReferences(
  chat: ChatRecord,
): readonly string[] | undefined {
  const task = chat.preferences.reviewTask;
  if (reviewReads(chat).length === 0 || !task || !namesReference(task))
    return undefined;
  return chat.preferences.reviewReferences;
}
