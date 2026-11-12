// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useLayoutEffect, useState, type RefObject } from "react";
import { askWaiting, type Assistant } from "../../ai";
import type { AssistantSnapshot } from "../../ai/application/assistantTypes";
import type { AiSearchAskProps } from "./AiSearchAsk";

/**
 * A web search waiting on the writer, and whether it waits in another chat.
 * One predicate serves the ask, the Stop, the jump, the switcher and the
 * buttons, so no two of them can disagree about a moment. Pure, because the
 * transcript's scroll reads it before the ask's own state exists.
 */
export function waitingAsk(
  snapshot: Pick<AssistantSnapshot, "pendingSearch" | "runningChatId">,
  activeChatId: string | undefined,
): {
  pending: AssistantSnapshot["pendingSearch"] | null;
  askElsewhere: boolean;
} {
  const pending = askWaiting(snapshot) ? snapshot.pendingSearch : null;
  return {
    pending,
    askElsewhere: !!pending && snapshot.runningChatId !== activeChatId,
  };
}

/**
 * The one search the writer must approve, from the moment it is shown to
 * the moment it is decided: its arming, the words the live region says for
 * it, and the jump that brings it into view.
 */
export function useSearchAsk({
  assistant,
  pending,
  askElsewhere,
  dockOpen,
  scrollRef,
  stageRef,
  setFollowing,
}: {
  assistant: Assistant | null | undefined;
  pending: AssistantSnapshot["pendingSearch"] | null;
  askElsewhere: boolean;
  dockOpen: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  setFollowing: (following: boolean) => void;
}): {
  /** What the live region says: the ask's own words, or `fallback`. */
  spoken: (fallback: string) => string;
  /** The props of the ask on screen, or `null` when none waits. */
  askProps: AiSearchAskProps | null;
  /** Scrolls to the latest answer and, when a search waits here, to it. */
  jump: () => void;
} {
  // Every explicit reveal restarts the ask's arming: the dock opening, which
  // an observer cannot tell (`dockOpen`), and the jump to the asking chat.
  // One stamp, read by whichever ask is on screen.
  const [revealedAt, setRevealedAt] = useState(0);
  // A layout effect, as is the ask's restart: a passive one leaves a painted,
  // still-armed Search for a frame or two after the dock opens, and a press
  // landing then would approve a search the writer has not read.
  useLayoutEffect(() => {
    if (dockOpen) setRevealedAt(Date.now());
  }, [dockOpen]);
  // What the live region says for the ask on screen, by its id, so a new
  // ask never borrows the last one's words for the frame before it speaks.
  const [askSpoken, setAskSpoken] = useState<{
    askId: string;
    words: string;
  } | null>(null);

  const spoken = (fallback: string) =>
    pending && askSpoken?.askId === pending.askId ? askSpoken.words : fallback;

  const askProps: AiSearchAskProps | null =
    pending && assistant
      ? {
          ask: pending,
          onAnswer: (answer) => assistant.answerSearches(pending.askId, answer),
          holdsBookWords: (query) =>
            assistant.searchQueryHoldsBookWords(pending.askId, query),
          scroller: scrollRef,
          revealedAt,
          onSpeak: (said) =>
            setAskSpoken({ askId: pending.askId, words: said }),
          onDecided: (inside) => {
            // Focus goes back to the composer only when it was in the ask,
            // so nothing is taken from a writer who is elsewhere.
            if (inside)
              stageRef.current?.parentElement
                ?.querySelector<HTMLTextAreaElement>(".composer textarea")
                ?.focus();
          },
        }
      : null;

  const jump = () => {
    setFollowing(true);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    if (!pending || askElsewhere) return;
    // The jump unmounts once the ask is in view, and focus would fall to the
    // page, so it goes to the ask: the first open field, or else the ask's
    // named group (the rows' fieldset, or the ask itself on a resend or while
    // several queries are still read-only text), never a tick or a button.
    // The restarted arming means the Enter that pressed the jump cannot land
    // as a Search.
    setRevealedAt(Date.now());
    const ask = element?.querySelector<HTMLElement>(".ai-ask");
    (
      ask?.querySelector<HTMLElement>("textarea:not(:disabled)") ??
      ask?.querySelector<HTMLElement>("fieldset") ??
      ask
    )?.focus();
  };

  return { spoken, askProps, jump };
}
