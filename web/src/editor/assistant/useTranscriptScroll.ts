// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";
import type { Assistant } from "../../ai";
import type { ChatRecord } from "../../ai/domain/types";

/**
 * Put a transcript at its foot, and re-assert it across the next two frames.
 *
 * When this runs the transcript has only just been committed: every turn is
 * markdown not yet laid out, `content-visibility: auto` leaves what is off
 * screen unmeasured, and a webfont can still land. `scrollHeight` is
 * therefore an underestimate, and the browser clamps a `scrollTop` past it,
 * so one assignment can open the panel on the first message instead of the
 * last. Re-asserting converges because each scroll forces more of the skipped
 * content to be measured.
 *
 * Two frames, not a loop with a settle test: the numbers are estimates in
 * flight, so "unchanged" is not a reliable stop, and a transcript that keeps
 * re-scrolling while the writer reads is worse than one that lands a few
 * pixels short. Returns its own cancel, because an unmounted panel's frames
 * must not fire.
 */
function settleScroll(element: HTMLElement) {
  const put = () => {
    element.scrollTop = element.scrollHeight;
  };
  put();
  // jsdom without `pretendToBeVisual` has no frames, and the single
  // assignment is correct where nothing is ever laid out.
  if (typeof requestAnimationFrame !== "function") return undefined;
  let left = 2;
  let handle = 0;
  const again = () => {
    put();
    if (--left > 0) handle = requestAnimationFrame(again);
  };
  handle = requestAnimationFrame(again);
  return () => cancelAnimationFrame(handle);
}

/**
 * The transcript's scroller: it follows the conversation while the writer
 * stays near its foot, opens every chat on its last message, and brings a
 * search hit's turn into view.
 */
export function useTranscriptScroll({
  assistant,
  chats,
  activeChatId,
  pendingAskId,
  revealTurnId,
}: {
  assistant: Assistant | null | undefined;
  chats: readonly ChatRecord[];
  activeChatId: string | undefined;
  /** The search waiting on the writer, which the transcript follows too. */
  pendingAskId: string | undefined;
  /** A search hit's turn, to reveal once. */
  revealTurnId: string | null | undefined;
}) {
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-follow only while the writer remains near the bottom; scrolling up
  // detaches it and offers one quiet way back. Scrolling never re-renders the
  // workspace beyond this one boolean.
  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    setFollowing(distance < 48);
  };
  // A search posed to the writer follows too: it arrives without a change to
  // the chats, and it is what the writer must answer.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && following) element.scrollTop = element.scrollHeight;
  }, [chats, following, activeChatId, pendingAskId]);
  // A chat always opens on its last message. A conversation is read from its
  // end, and a writer who picks one out of the list is asking for what was
  // last said in it.
  //
  // No per-chat scroll position is restored. It would be a second owner of
  // this scroller racing the follow effect: both fire on the same commit, an
  // assignment by either raises a scroll event that flips `following`, and
  // which one wins depends on whether the bridge re-listed the chats that
  // tick.
  const restoreKey = activeChatId ?? null;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setFollowing(true);
    return settleScroll(element);
  }, [restoreKey]);

  // A search hit's exact turn: reveal it once, then hand the state back.
  useEffect(() => {
    const turnId = revealTurnId;
    if (!assistant || !turnId) return undefined;
    // Escaped: the id is the chat file's own text, and any of it may read as
    // selector syntax.
    const element = document.querySelector(
      `[data-turn-id="${CSS.escape(turnId)}"]`,
    );
    if (element instanceof HTMLElement) {
      setFollowing(false);
      // jsdom has no layout and no scrollIntoView; a real browser does.
      element.scrollIntoView?.({ block: "center" });
      element.classList.add("is-revealed");
      const timer = window.setTimeout(
        () => element.classList.remove("is-revealed"),
        1600,
      );
      assistant.clearRevealTurn();
      return () => window.clearTimeout(timer);
    }
    assistant.clearRevealTurn();
    return undefined;
  }, [assistant, revealTurnId]);

  return { scrollRef, following, setFollowing, onScroll };
}
