// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import type { Assistant } from "../../ai";
import type { ChatRecord, SourceDescriptor } from "../../ai/domain/types";
import {
  namesReference,
  nearestCommand,
  parseCommand,
  skillFor,
  skillForReviewTask,
  skillsFor,
  type AiSkill,
  type CommandNames,
} from "../../ai/domain/skills";
import { partFor } from "../../ai/domain/parts";
import { transitOf } from "./commandTransit";
import type { OpenNode } from "./summarisePart";

/** A line naming a reference the book does not hold, refused before Enter. */
export type RefusedReference = { command: string; typed: string };

/** A lone `/word` that is no command in this chat, and its nearest command. */
export type UnknownCommand = {
  typed: string;
  near: ReturnType<typeof nearestCommand>;
};

/** What the composer is told about the line being typed. */
export interface Question {
  question: string;
  setQuestion: (value: string) => void;
  refused: RefusedReference | null;
  setRefused: (refused: RefusedReference | null) => void;
  unknownCommand: UnknownCommand | null;
  setUnknownCommand: (unknown: UnknownCommand | null) => void;
  /** The drafting room's first question is up. */
  asksNeed: boolean;
  /** Where the writer stopped in the open Section, for that question. */
  stopped: string | null;
  /** `part`, `section` or nothing: the word naming where the writer is. */
  openWord: "part" | "section" | null;
  /** The command word the latest answer's hint teaches, if any. */
  bareNamingReview: string | undefined;
  /** What a command being typed would send to a vendor, said before Enter. */
  transit: ReturnType<typeof transitOf>;
  /** The command being typed, by its first word, when this chat offers it. */
  guided: AiSkill | null;
}

/**
 * The line being typed in the active chat: the draft it is, the refusals
 * that stand while it is unchanged, what Enter would send where, and the
 * drafting room's first question, which fills the line.
 */
export function useQuestion({
  assistant,
  active,
  running,
  drafts,
  writeDraft,
  catalogue,
  catalogueRead,
  open,
  commandNames,
  remoteHost,
}: {
  assistant: Assistant | null | undefined;
  active: ChatRecord | null;
  running: boolean;
  drafts: Record<string, string>;
  writeDraft: (chatId: string, value: string) => void;
  catalogue: readonly SourceDescriptor[];
  catalogueRead: boolean;
  open: (OpenNode & { title?: string }) | null;
  commandNames: CommandNames;
  remoteHost: string | null;
}): Question {
  // Where the writer stopped in the open Section, when this drafting chat is
  // coming back to it. Read from the manuscript each time the question is
  // asked again (a new Section, a new answer) and never kept, because the
  // chat holds no prose.
  const asksNeed =
    active?.kind === "drafting" &&
    !running &&
    assistant?.room.draftingNeed() === null;
  const [stopped, setStopped] = useState<string | null>(null);
  const openId = open?.id;
  const answered = active?.turns.length ?? 0;
  useEffect(() => {
    setStopped(null);
    if (!asksNeed || !assistant) return;
    let live = true;
    void assistant.room
      .draftingStoppedAt()
      .then((line) => {
        if (live) setStopped(line);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [asksNeed, assistant, active?.id, openId, answered]);
  // The word naming where the writer is, which the menu notes teach from.
  // Read at render, as the declaration is, because the open node moves
  // without a re-list. `part` where a `part` run would run, `section` in a
  // loose Section, and nothing until the catalogue has been read, since a
  // guess would teach a refused word.
  const openWord =
    !catalogueRead || !open
      ? null
      : partFor(catalogue, open.id) !== null
        ? "part"
        : open.kind === "section"
          ? "section"
          : null;
  const question = active ? (drafts[active.id] ?? "") : "";
  // A line that named a reference the book does not hold is refused here,
  // before anything is sent: no turn, nothing stored, and the words left in
  // the field. The refusal clears when the writer changes them.
  const [refused, setRefused] = useState<RefusedReference | null>(null);
  // A lone `/word` that is no command in this chat is refused the same way,
  // naming the command it most likely meant and, when that lives in another
  // kind of chat, which one.
  const [unknownCommand, setUnknownCommand] = useState<UnknownCommand | null>(
    null,
  );
  useEffect(() => setUnknownCommand(null), [question, active?.id]);
  useEffect(() => setRefused(null), [question, active?.id]);
  // The command word of a bare review by a command that takes a name, while
  // it is this chat's review: what the latest answer's hint teaches when a
  // reference had no room. The chat's preference describes its latest
  // review only, so no older answer carries it.
  const reviewTask = active?.preferences.reviewTask;
  const reviewScope = active?.preferences.reviewScope;
  const bareNamingReview =
    active?.kind === "editorial" &&
    reviewTask &&
    namesReference(reviewTask) &&
    !active.preferences.reviewReferences &&
    reviewScope &&
    reviewScope.kind !== "part" &&
    reviewScope.kind !== "structure"
      ? `/${skillForReviewTask(reviewTask)?.command ?? ""}`
      : undefined;
  const setQuestion = (value: string) => {
    if (!active) return;
    writeDraft(active.id, value);
  };
  // What a command being typed would send to a vendor, said before Enter.
  // One notice, read from the parse the submit uses, so it is up when, and
  // only when, Enter would start that run. It is decided by what the command
  // runs (`actionOf`), so a new workflow is a compile error here, not a
  // silent gap.
  const typed =
    active && remoteHost
      ? parseCommand(question, skillsFor(active.kind), commandNames)
      : null;
  const transit = typed ? transitOf(typed, catalogue, open) : null;
  // The command being typed, by its first word alone, when this chat offers
  // it, whatever follows. Its guide is up from the moment the menu fills the
  // field with `/where `, before the line parses as anything Enter would run,
  // because that is when the writer needs to know what to type.
  const typedWord = /^\/(\S+)/.exec(question)?.[1];
  const guided =
    active && typedWord ? skillFor(typedWord, skillsFor(active.kind)) : null;
  return {
    question,
    setQuestion,
    refused,
    setRefused,
    unknownCommand,
    setUnknownCommand,
    asksNeed,
    stopped,
    openWord,
    bareNamingReview,
    transit,
    guided: guided ?? null,
  };
}
