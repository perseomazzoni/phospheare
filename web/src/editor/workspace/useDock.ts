// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { askWaiting, type Assistant } from "../../ai";
import type { ReferenceGroupId } from "../../project/reference";
import { useBackCloses } from "../../ui/overlay/useBackCloses";
import type { DockFace } from "../components/Dock";

// The dock: one surface, two faces. The dock and the structure panel expand
// and collapse independently: opening the dock does not fold the panel, and
// the panel does not move the dock. Where they meet on a short window the
// panels stack, the structure panel over the command bar and the dock over
// the structure panel, so a panel's header is never under the bar.
//
// Two hooks, because the reference session sits between them: it needs the
// dock's setters, and the controls that open a face need its guarded
// `requestFace`.

/** A subscription to nothing, for the store absent without an Assistant. */
const noSubscription = () => () => undefined;

export interface DockOptions {
  /**
   * The Assistant, or null. The bridge builds none for the demo, and every
   * way into it keys on this being null, never on the route.
   */
  assistant: Assistant | null;
  /** The phone plane, where the open dock holds a history entry. */
  phone: boolean;
}

/** The dock's open state and face, and what survives a face switch. */
export function useDock({ assistant, phone }: DockOptions) {
  const [dockOpen, setDockOpen] = useState(false);
  const [dockFace, setDockFace] = useState<DockFace>("reference");

  // The face on screen, derived at render and never written back. No control
  // sets "ask" without an Assistant, but a missed one would leave the Dock's
  // fitted track with no pressed cell, and an effect correcting the state
  // would paint the wrong face for a frame. Every read of the face goes
  // through this, so the Dock, the bar's pressed states and the toggles
  // agree; the state stays the writer's last choice.
  const face = dockFace === "ask" && !assistant ? "reference" : dockFace;
  // Whether a web search waits on the writer. One boolean from the
  // Assistant's snapshot, so nothing above the dock learns what an ask holds
  // or which chat it is in: the controls carry state only.
  const askWaits = useSyncExternalStore(
    assistant?.subscribe ?? noSubscription,
    () => (assistant ? askWaiting(assistant.getSnapshot()) : false),
    () => false,
  );
  // Whether a chat is answering, for the Ask tab's spark, under the same
  // one-boolean rule as `askWaits`.
  const askRuns = useSyncExternalStore(
    assistant?.subscribe ?? noSubscription,
    () => (assistant ? assistant.getSnapshot().running : false),
    () => false,
  );

  const closeDock = useCallback(() => setDockOpen(false), []);
  // On Android, back is the universal dismiss: the open dock holds one
  // history entry, popped whichever way it closes.
  useBackCloses(phone && dockOpen, closeDock);

  // The reference cards the writer left open. Held here, not in the panel,
  // because the panel unmounts when the dock shows another face: the fold
  // survives the switch, and a remount renders it already open, with no fold
  // animation unless a press moved it.
  const [refCards, setRefCards] = useState<Set<ReferenceGroupId>>(
    () => new Set(),
  );
  const handleRefCards = useCallback(
    (next: SetStateAction<ReadonlySet<ReferenceGroupId>>) => {
      setRefCards(
        (prev) => new Set(typeof next === "function" ? next(prev) : next),
      );
    },
    [],
  );
  const [quote, setQuote] = useState<string | null>(null);
  // The assistant's per-chat drafts and scroll positions live here, above the
  // dock's face switch: the panel unmounts when Reference or Notes is shown,
  // and a half-typed question must survive that. Refs, not state: the panel
  // owns the live copy while mounted, so a keystroke re-renders the composer
  // and not the whole workspace.
  const aiDraftsRef = useRef<Record<string, string>>({});
  const handleAiDrafts = useCallback((next: Record<string, string>) => {
    aiDraftsRef.current = next;
  }, []);

  return {
    dockOpen,
    setDockOpen,
    setDockFace,
    face,
    askWaits,
    askRuns,
    closeDock,
    refCards,
    handleRefCards,
    quote,
    setQuote,
    aiDraftsRef,
    handleAiDrafts,
  };
}

export type DockState = ReturnType<typeof useDock>;

export interface DockNavigationOptions {
  dock: DockState;
  assistant: Assistant | null;
  /**
   * The reference session's guarded face switch: a dirty reference draft is
   * asked about first, as on every way to another face.
   */
  requestFace: (face: DockFace, then?: () => void) => void;
}

/** Every way to change the dock's face, and the one rule they share. */
export function useDockNavigation({
  dock,
  assistant,
  requestFace,
}: DockNavigationOptions) {
  const { dockOpen, setDockOpen, face, askWaits, setQuote } = dock;

  // A conversation the writer found in the search. The panel has already
  // opened the node, since the assistant face binds to the open Section, so
  // this only shows the face.
  const openChat = useCallback(() => {
    requestFace("ask");
    setDockOpen(true);
  }, [requestFace, setDockOpen]);
  // A search hit on a chat, from either tree (the phone's sheet or the
  // desk's panel): the chat, or the turn inside it, then the face.
  const openChatAt = useCallback(
    (chatId?: string, turnId?: string) => {
      if (chatId && turnId) assistant?.revealTurn(chatId, turnId);
      else if (chatId) assistant?.selectChat(chatId);
      openChat();
    },
    [assistant, openChat],
  );

  // The reference face with no file named, showing its own list to pick
  // from.
  const openReferenceTab = useCallback(() => {
    requestFace("reference");
    setDockOpen(true);
  }, [requestFace, setDockOpen]);

  const toggleAsk = useCallback(() => {
    setDockOpen((now) => (now && face === "ask" ? false : true));
    requestFace("ask");
  }, [face, requestFace, setDockOpen]);
  // Whether a control that opens the Ask face carries the waiting mark: a
  // search waits and the face is not in view. Every such control's behaviour
  // follows its mark, so this one predicate decides both.
  const askCalls = askWaits && !(dockOpen && face === "ask");
  // What the bar's button, the Dock's Ask tab and the palette's entry do while
  // marked: bring the writer to the chat holding the ask, which the
  // Assistant picks so the shell never learns which, and open the face. Once
  // the face is in view the controls act as usual, and the chat title button
  // and the jump lead to the ask: a press on an unmarked control never swaps
  // the writer's chat.
  //
  // The reveal rides the face switch, so cancelling a dirty reference
  // draft's prompt swaps no chat behind the face kept.
  const openAsk = useCallback(() => {
    requestFace("ask", () => assistant?.revealPendingSearch());
    setDockOpen(true);
  }, [assistant, requestFace, setDockOpen]);
  // The Ask handler the bar and the palette share: absent with no Assistant, so
  // each leaves its button out rather than offering a face that is not there.
  const handleAsk = assistant ? (askCalls ? openAsk : toggleAsk) : undefined;
  // The Dock's own tabs: the Ask tab is the same handler while it is marked.
  const onDockFace = useCallback(
    (next: DockFace) => {
      if (next === "ask" && askCalls) openAsk();
      else requestFace(next);
    },
    [askCalls, openAsk, requestFace],
  );

  // Asking about the selection: the same guarded switch as every other way
  // to the Ask face, and the quote lands only once the face has switched.
  const ask = useCallback(
    (text: string) => {
      requestFace("ask", () => setQuote(text));
      setDockOpen(true);
    },
    [requestFace, setQuote, setDockOpen],
  );
  const askAbout = assistant ? ask : undefined;

  const toggleSnapshot = useCallback(() => {
    setDockOpen((now) => (now && face === "snapshot" ? false : true));
    requestFace("snapshot");
  }, [face, requestFace, setDockOpen]);

  return {
    askCalls,
    handleAsk,
    askAbout,
    onDockFace,
    openChatAt,
    openReferenceTab,
    toggleSnapshot,
  };
}
