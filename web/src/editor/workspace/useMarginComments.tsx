// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Assistant } from "../../ai";
import {
  useMarginAnswers,
  type MarginAnswerer,
} from "../comments/host/answers";
import { useCommentsService, useNodeComments } from "../comments/host/comments";
import {
  selectedPlacement,
  textOf,
  type CommentDraft,
  type MarginWalk,
} from "../comments/presentation/Margin";
import { paragraphText } from "../engine/application/diff/blocks";
import type { EditorEngine } from "../views/engine";
import type { PersonaFace } from "../comments/presentation/faces";
import AiSearchAsk from "../assistant/AiSearchAsk";
import { activityWords } from "../assistant/runStatus";

// The margin's comments as the workspace holds them: the node they belong
// to, whether they are shown, the room the measure keeps for them, the walk
// from the bar and the palette, the comment the bubble started, and the
// faces the margin draws personas with, which are the Assistant's own, so
// the demo draws only people's threads.

export interface MarginCommentsOptions {
  engine: EditorEngine;
  activeFile: string | null;
  /** The open node's id, or null on the Desk. */
  activeNodeId: string | null;
  /** The project file's value for hidden comments. */
  storedHidden: boolean;
  /** Persists the writer's show or hide. */
  onCommentsHidden?: (hidden: boolean) => void;
  assistant: Assistant | null;
}

export function useMarginComments({
  engine,
  activeFile,
  activeNodeId,
  storedHidden,
  onCommentsHidden,
  assistant,
}: MarginCommentsOptions) {
  const { t } = useTranslation();
  const commentsService = useCommentsService();
  const commentNodeId = activeFile ? activeNodeId : null;

  // Hidden comments mean no margin at all: no cards, no dots, no painted
  // passage, and no room kept. Held here as well as in the project's file so
  // the press answers at once; the file's value wins again whenever it
  // changes, from another tab or a reopen.
  const [commentsHidden, setCommentsHiddenNow] = useState(storedHidden);
  useEffect(() => setCommentsHiddenNow(storedHidden), [storedHidden]);
  const showComments = useCallback(
    (shown: boolean) => {
      setCommentsHiddenNow(!shown);
      onCommentsHidden?.(!shown);
    },
    [onCommentsHidden],
  );
  const toggleComments = useCallback(
    () => showComments(commentsHidden),
    [showComments, commentsHidden],
  );
  // Whether the open chapter has comments to show: anything not resolved, on
  // a passage or on the chapter. Only then, and while shown, does the shell
  // ask the measure to make room (`data-margin` in `editor.css`), so a
  // chapter with none, or with comments hidden, keeps its prose in place.
  const openComments = useNodeComments(commentNodeId);
  const marginRoom =
    !commentsHidden &&
    openComments?.status === "ready" &&
    openComments.file.threads.some((thread) => thread.state !== "resolved");
  // The comments toggle exists where a comment could: a margin with a node
  // open.
  const handleComments =
    commentsService && commentNodeId ? toggleComments : undefined;
  // Previous and Next comment, the margin's walk reached from the bar and the
  // palette: offered while a shown comment sits on a passage, the only kind
  // with a place in the text to go to.
  const marginWalk = useRef<MarginWalk>(null);
  const walkable =
    marginRoom &&
    openComments.file.threads.some(
      (thread) => thread.state !== "resolved" && thread.anchor !== null,
    );
  const previousComment = useCallback(() => marginWalk.current?.step(-1), []);
  const nextComment = useCallback(() => marginWalk.current?.step(1), []);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  useEffect(() => setCommentDraft(null), [commentNodeId]);
  const personaFaces = useMemo<readonly PersonaFace[]>(
    () => assistant?.allPersonas() ?? [],
    [assistant],
  );
  // A persona the writer calls in a thread answers there, through the
  // assistant; with no assistant nobody is called and nothing waits. What it
  // does on the way is said in the dock's words, and a search it wants is the
  // dock's ask, drawn in the thread's card.
  const marginScroller = useRef<HTMLElement | null>(null);
  const answerComment = useMemo<MarginAnswerer | null>(
    () =>
      assistant
        ? (request, onDoing, onAsking) =>
            assistant.margin.answer(
              request,
              (activity) =>
                onDoing?.(activity ? activityWords(t, activity).shown : null),
              (waiting) =>
                onAsking?.(
                  waiting ? (
                    <AiSearchAsk
                      key={waiting.ask.askId}
                      ask={waiting.ask}
                      onAnswer={waiting.answer}
                      holdsBookWords={waiting.holdsBookWords}
                      scroller={marginScroller}
                      revealedAt={Date.now()}
                      onSpeak={() => undefined}
                      onDecided={() => undefined}
                    />
                  ) : null,
                ),
            )
        : null,
    [assistant, t],
  );
  const marginAnswers = useMarginAnswers(answerComment, personaFaces);

  // A comment on the selection the bubble was shown for: a passage inside one
  // paragraph or across several. The engine's selection must cover the words
  // the bubble showed, or the comment anchors where the writer never chose.
  // Compared word for word, because the page spells a paragraph break its own
  // way ("\n\n" in some browsers) where the engine's text has one "\n".
  // Absent where there is nowhere to keep a comment.
  const commentOn = useCallback(
    (shownText: string) => {
      const words = (text: string) => text.replace(/\s+/g, " ").trim();
      const placement = selectedPlacement(engine);
      if (!placement) return;
      const covered = words(textOf(engine.doc.map(paragraphText), placement));
      if (!covered || covered !== words(shownText)) return;
      // Asking to comment is asking to see the comments.
      if (commentsHidden) showComments(true);
      setCommentDraft({ placement });
    },
    [engine, commentsHidden, showComments],
  );
  const commentOnSelection =
    commentsService && commentNodeId ? commentOn : undefined;

  return {
    commentsService,
    commentNodeId,
    commentsHidden,
    showComments,
    marginRoom,
    handleComments,
    marginWalk,
    walkable,
    previousComment,
    nextComment,
    commentDraft,
    setCommentDraft,
    commentOnSelection,
    personaFaces,
    marginAnswers,
  };
}
