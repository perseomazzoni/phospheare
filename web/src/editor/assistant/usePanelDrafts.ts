// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantSnapshot } from "../../ai/application/assistant";
import type { ChatRecord } from "../../ai/domain/types";

/**
 * The refused queued questions already given back, by identity. Kept outside
 * any one mount, because the panel remounts while the snapshot keeps the last
 * hand-back.
 */
const appliedReturns = new WeakSet<object>();

/**
 * The Ask face's per-chat composer drafts.
 *
 * The panel owns the live draft copy while it is mounted. The shell's
 * mirror is refs, not state, so a keystroke never re-renders the workspace
 * around the dock, and a dock face switch still finds the draft. The prop
 * only seeds this mount. The mirror is written synchronously from the ref,
 * not from an effect: a send that resolves `"rejected"` after the panel
 * unmounted must still restore the writer's text where the shell finds it.
 */
export function usePanelDrafts({
  owned,
  onDrafts,
  chats,
  returned,
  activeChatId,
  onQuote,
}: {
  /** The shell's mirror, which seeds this mount. */
  owned: Record<string, string> | undefined;
  onDrafts: ((next: Record<string, string>) => void) | undefined;
  chats: readonly ChatRecord[];
  returned: AssistantSnapshot["returned"];
  activeChatId: string | undefined;
  onQuote: (quote: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => owned ?? {},
  );
  // Aliases the shell's map. Every writer here replaces the map, so the
  // alias cannot corrupt it.
  const draftsRef = useRef(drafts);
  /** The one write path for the panel's draft copy and the shell's mirror. */
  const commitDrafts = useCallback(
    (next: Record<string, string>) => {
      draftsRef.current = next;
      onDrafts?.(next);
      setDrafts(next);
    },
    [onDrafts],
  );
  const writeDraft = (chatId: string, value: string) => {
    commitDrafts({ ...draftsRef.current, [chatId]: value });
  };
  /**
   * Whether a chat's field is empty now. A refusal comes once the run has
   * looked, and the writer may have begun the next line by then, so only an
   * empty field takes words back.
   */
  const fieldEmpty = (chatId: string) => !(draftsRef.current[chatId] ?? "");
  /** A refused command's words, back into the field, if it is empty. */
  const giveBack = (chatId: string, words: string) => {
    if (fieldEmpty(chatId)) writeDraft(chatId, words);
  };

  // The chat list is not loaded here. The bridge owns the listing and runs it
  // at project open, before any face can be switched, so the palette's chat
  // search works cold; a panel-mount listing would re-read every chat file
  // on each Ask-face remount for no gain.
  //
  // A deleted chat's draft is dead, and the shell's mirror is re-seeded into
  // the panel on every remount, so left alone the entries would outlive their
  // chats and grow without bound. Pruned only against a non-empty list: an
  // empty one is also the not-yet-loaded state, and pruning against it would
  // wipe the shell's mirror before the bridge's listing lands.
  useEffect(() => {
    if (chats.length === 0) return;
    const live = new Set(chats.map((chat) => chat.id));
    const stale = Object.keys(draftsRef.current).filter((id) => !live.has(id));
    if (stale.length === 0) return;
    const nextDrafts = { ...draftsRef.current };
    for (const id of stale) delete nextDrafts[id];
    commitDrafts(nextDrafts);
  }, [chats, commitDrafts]);

  // A queued question refused when its turn came comes back the same way:
  // it left the field when it was queued, and nothing else holds it.
  // Each hand-back is a new object, applied once for the
  // session: the panel remounts on every dock-face switch, and the snapshot
  // still holds the last one.
  useEffect(() => {
    if (!returned || appliedReturns.has(returned)) return;
    appliedReturns.add(returned);
    if (draftsRef.current[returned.chatId] ?? "") return;
    writeDraft(returned.chatId, returned.text);
    if (returned.quote && returned.chatId === activeChatId)
      onQuote(returned.quote);
  });

  return { drafts, writeDraft, giveBack, fieldEmpty };
}
