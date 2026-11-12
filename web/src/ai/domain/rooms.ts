// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { CHAT_KINDS, type ChatKind, type ReadRef } from "./types";

// ── The rooms ────────────────────────────────────────────────────────────────
//
// Each chat kind is a room with a job, and part of a job is the paperwork it
// works from. This is the one table of it: what a room reads on every turn,
// what it wants the writer to have written, and, for the two reader rooms,
// which of the writer's reference documents a reader may see at all.
//
// The writer's reference documents are the richest thing Phospheare holds
// about a book, and a room that ignores them answers from generic knowledge
// instead of from this book. So every room names the ones its job depends on,
// the persona's preset adds the ones its focus depends on
// (`PersonaPreset.reads`), a command adds its own (`AiSkill.reads`), and all
// of them are attached through the one best-effort function
// (`selectDeclared`).
//
// When a document a room relies on has not been written, or is still the
// untouched template, the room asks the writer to fill it in and come back
// (`missingWants`) rather than guessing at what the writer would have said.

export interface Room {
  /** Attached on every turn, when written and when they fit. */
  readonly reads: readonly ReadRef[];
  /** The ones whose absence the persona should ask about. */
  readonly wants: readonly ReadRef[];
  /**
   * The reference documents a reader may see beside the manuscript up to its
   * horizon. Only these: a reader's allowed set is otherwise manuscript, and
   * nothing a room reads can widen it.
   */
  readonly readerExtras: readonly ReadRef[];
}

const guidebook = (sectionId: string): ReadRef => ({
  group: "guidebook",
  sectionId,
});

/**
 * The alpha reader knows what the writer meant: the one-screen identity, the
 * promise, the theme and the logline. Never a later section, never notes,
 * never the world.
 */
const INTENT: readonly ReadRef[] = [
  guidebook("at-a-glance"),
  guidebook("promise"),
  guidebook("theme"),
  guidebook("logline"),
];

/**
 * The beta reader sees what a buyer sees: the back cover. The
 * genre half of it is the project's declared genre, which reaches every
 * prompt through the briefing; this is the other half.
 */
const BACK_COVER: readonly ReadRef[] = [guidebook("blurb")];

export const ROOMS: Readonly<Record<ChatKind, Room>> = {
  general: {
    // Who the book is for, on every turn: the one page every other room
    // reads, attached as well as wanted.
    reads: [guidebook("at-a-glance")],
    wants: [guidebook("at-a-glance")],
    readerExtras: [],
  },
  drafting: {
    // The voice contract, on every turn: a rule that has scrolled out of the
    // conversation stops being kept.
    reads: [
      guidebook("prose-style"),
      guidebook("at-a-glance"),
      guidebook("view"),
      // What a new page must not contradict: the cast's established facts
      // and limits, never their inner life, and the world's rules.
      { group: "characters", roles: ["fact", "rule"] },
      { group: "world", sectionId: "rules" },
    ],
    wants: [
      guidebook("prose-style"),
      guidebook("at-a-glance"),
      { group: "characters" },
    ],
    readerExtras: [],
  },
  "alpha-reader": {
    reads: INTENT,
    wants: [guidebook("at-a-glance"), guidebook("promise")],
    readerExtras: INTENT,
  },
  "beta-reader": {
    reads: BACK_COVER,
    wants: BACK_COVER,
    readerExtras: BACK_COVER,
  },
  editorial: {
    // Intake: the brief first, then who the book is for.
    reads: [guidebook("editing-brief"), guidebook("at-a-glance")],
    wants: [
      guidebook("editing-brief"),
      guidebook("at-a-glance"),
      guidebook("prose-style"),
    ],
    readerExtras: [],
  },
};

/** Whether two references name the same document or group. */
export function sameRef(a: ReadRef, b: ReadRef): boolean {
  return a.group === b.group && a.sectionId === b.sectionId;
}

/**
 * `lists` joined in order, each reference once, at its first place, carrying
 * what every list asked of it: the roles joined, or all of it when any list
 * asked for all. First-wins would let `/line-editing`'s
 * `characters(rule)`, ahead of a room's `characters`, narrow the room's own
 * read to the voice.
 */
export function joinReads(
  ...lists: readonly (readonly ReadRef[])[]
): ReadRef[] {
  const out: ReadRef[] = [];
  for (const list of lists)
    for (const ref of list) {
      const at = out.findIndex((one) => sameRef(one, ref));
      if (at === -1) {
        out.push(ref);
        continue;
      }
      const kept = out[at];
      const { roles: _, ...whole } = kept;
      out[at] =
        kept.roles && ref.roles
          ? { ...whole, roles: [...new Set([...kept.roles, ...ref.roles])] }
          : whole;
    }
  return out;
}

// ── Written, or still the template ───────────────────────────────────────────
//
// A section starts as a template, and a template the writer never touched is
// no more an answer than a missing file. The port strips unanswered
// questions from a reference read, so what is left of an untouched
// template is its headings and the fill-in formulas some templates offer
// (`[PROTAGONIST], a [BRIEF DESCRIPTION]…`). Neither says anything about the
// book.

const FORMULA = /\[[^\]\n]*\]/g;

/**
 * Whether a reference document, as the port read it, still says nothing the
 * writer wrote: nothing left once the headings, the bare labels and the
 * bracketed fill-in slots are gone.
 */
export function isUnwritten(text: string): boolean {
  const said = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => {
      const slots = line.match(FORMULA)?.length ?? 0;
      // A formula line is two or more slots joined by template words; a
      // writer's own line with one bracketed aside is still theirs.
      return slots >= 2 ? "" : line;
    })
    .join(" ")
    .replace(/\*\*[^*]*:\*\*/g, "")
    .replace(/[-*_>`#\s]/g, "");
  return said.length === 0;
}

// ── Other chats by the writer's names ────────────────────────────────────────
//
// The general chat points the writer at the chat that would do a request
// better, and a pointer is only useful in the words the writer will find it
// under. The instructions describe each chat in English; the names, which
// follow the interface language, travel as data beside the request, so the
// model never invents a translated name for a chat.

/**
 * One line naming every chat other than `from`, as `label` names it — or ""
 * without a `label`, so a harness sends nothing it cannot localise.
 */
export function chatKindNames(
  from: ChatKind,
  label?: (kind: ChatKind) => string,
): string {
  if (!label) return "";
  const names = CHAT_KINDS.filter((kind) => kind !== from).map(
    (kind) => `${kind}: "${label(kind).replace(/\s+/g, " ").trim()}"`,
  );
  return `The writer's interface names the other kinds of chat: ${names.join("; ")}. Use these names when you point the writer to one.`;
}
