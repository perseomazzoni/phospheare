// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Assistant } from "../../ai";
import type { AssistantSnapshot } from "../../ai/application/assistantTypes";
import { QUESTION_ARGUMENT_MAX } from "../../ai/domain/types";
import type {
  ChatRecord,
  ChatTurn,
  EvidenceAnchor,
} from "../../ai/domain/types";
import type { CommandNames } from "../../ai/domain/skills";
import {
  NO_WEB_CITATIONS,
  webCitations,
  type WebCitations,
} from "../../ai/domain/webCitations";
import type { AiTurnProps } from "./AiTurn";
import { editedQuestion } from "./panelSend";
import type { OpenNode } from "./summarisePart";
import { turnActions, turnFacts } from "./turnActions";
import type { RemoteProvider } from "./useChatProvider";

/** The props of an answer that its actions and its voice decide. */
export type TurnActionProps = Pick<
  AiTurnProps,
  | "agentName"
  | "live"
  | "web"
  | "nameHint"
  | "onOpenSource"
  | "onFindingStatus"
  | "onShowEvidence"
  | "onResumeReview"
  | "onRetry"
  | "onEdit"
  | "onRenew"
  | "onCompleteSearch"
  | "onCompleteReview"
  | "onCompleteMap"
  | "onMapWith"
  | "onOpenRoute"
  | "keyVerdict"
>;

/**
 * What every answer in the open chat can do, bound to the assistant: the
 * turn being written now, the voice each answer speaks in, its web
 * citations, the actions `turnActions` offers, and the notice a click on its
 * evidence leaves.
 */
export function useTurnActions({
  assistant,
  active,
  snapshot,
  lastTurn,
  commandNames,
  open,
  onNotify,
  setFollowing,
  writeDraft,
  relistNow,
  remoteProviders,
  bareNamingReview,
  renew,
}: {
  assistant: Assistant | null | undefined;
  active: ChatRecord | null;
  snapshot: Pick<
    AssistantSnapshot,
    "running" | "queued" | "activity" | "runningChatId"
  >;
  lastTurn: ChatTurn | undefined;
  commandNames: CommandNames;
  open: OpenNode | null;
  onNotify: ((text: string, undo?: () => void) => void) | undefined;
  setFollowing: (following: boolean) => void;
  writeDraft: (chatId: string, value: string) => void;
  relistNow: () => void;
  remoteProviders: Record<string, RemoteProvider> | undefined;
  bareNamingReview: string | undefined;
  renew: (providerId: string) => void;
}): {
  /** The turn being written right now, or `null`. */
  liveTurnId: string | null;
  /** What the last click on evidence came to, when it is worth saying. */
  evidenceNotice: string | null;
  /** The props `turn` at index `at` takes from its actions. */
  propsFor: (turn: ChatTurn, at: number) => TurnActionProps;
} {
  const { t } = useTranslation();
  const [evidenceNotice, setEvidenceNotice] = useState<string | null>(null);
  // A notice about a click is about the answer it was made on: the next run
  // is a new question, and it does not inherit "that passage has changed".
  useEffect(() => {
    if (snapshot.running) setEvidenceNotice(null);
  }, [snapshot.running]);

  // The turn being written right now, if a chat run is writing one here. The
  // test is `activity`, which only a chat run publishes: a full review marks
  // its chat as running from its first second but writes its turn only at
  // the end, so "last turn of the running chat" alone would point at an old,
  // finished answer for the whole review and give it a live line.
  const liveTurnId =
    snapshot.running &&
    snapshot.activity &&
    snapshot.runningChatId === active?.id &&
    lastTurn?.role === "assistant"
      ? lastTurn.id
      : null;

  // The open chat's web citations, one walk for every turn: what each answer
  // may cite, whether its model links are inert, and the one numbering its
  // markers, its sources list and its copy share. The walk re-runs as an
  // answer streams, and hands a settled turn back its last committed entry
  // when nothing about it changed, so the answers above do not re-render per
  // token. That entry comes from a ref written after commit, never during
  // render: a render React throws away must not become the next one's
  // `previous`.
  const committedWeb = useRef<ReadonlyMap<string, WebCitations>>(undefined);
  const webByTurn = useMemo(
    () =>
      webCitations(
        active?.turns ?? [],
        liveTurnId ?? undefined,
        committedWeb.current,
        active?.searchedBefore,
      ),
    [active, liveTurnId],
  );
  useEffect(() => {
    committedWeb.current = webByTurn;
  }, [webByTurn]);

  const settleEvidence = (
    outcome: "selected" | "changed" | "unavailable" | "held",
  ) => {
    // `held` is the host's save or discard question, which speaks for itself.
    setEvidenceNotice(
      outcome === "selected" || outcome === "held"
        ? null
        : t(`dock.evidence.${outcome}`),
    );
    if (outcome === "changed") relistNow();
  };

  // The answer being written carries no voice until it lands; it speaks in
  // the chat's.
  const agentNameOf = (turn: ChatTurn) => {
    const voice =
      turn.personaId ??
      (turn.id === liveTurnId ? active?.preferences.personaId : undefined);
    return voice && assistant ? assistant.personaName(voice) : null;
  };

  const facts = turnFacts(
    active?.turns ?? [],
    snapshot.running,
    snapshot.queued,
  );

  const propsFor = (turn: ChatTurn, at: number): TurnActionProps => {
    const offer = turnActions(facts, turn);
    const runId = turn.runId;
    return {
      agentName: agentNameOf(turn),
      live: turn.id === liveTurnId,
      web: webByTurn.get(turn.id) ?? NO_WEB_CITATIONS,
      nameHint:
        offer.last && turn.role === "assistant" ? bareNamingReview : undefined,
      onOpenSource: (sourceId) => {
        if (!assistant) return;
        void assistant.sources.open(sourceId).then(settleEvidence);
      },
      onFindingStatus: (turnId, findingId, status) =>
        void assistant?.sources.updateFindingStatus(turnId, findingId, status),
      onShowEvidence: (anchor: EvidenceAnchor) => {
        if (!assistant) return;
        void assistant.sources.revealEvidence(anchor).then(settleEvidence);
      },
      onResumeReview: (id) => void assistant?.reviews.resume(id),
      onRetry: offer.retry
        ? (turnId) => void assistant?.edits.retry(turnId)
        : undefined,
      // The toast, carrying the Undo, arrives once the edited question is on
      // disk and its answer is under way.
      onEdit: offer.edit
        ? (turnId, text) => {
            if (!assistant) return false;
            const edited = editedQuestion(
              text,
              active,
              commandNames,
              turn.quote,
              open,
            );
            if (!edited) return false;
            void (
              edited.withoutQuote
                ? assistant.edits.edit(turnId, edited.text, edited.command, {
                    withoutQuote: true,
                  })
                : assistant.edits.edit(turnId, edited.text, edited.command)
            ).then((outcome) => {
              if (outcome === "started")
                onNotify?.(t("dock.edited"), () => {
                  void assistant.edits.undo();
                });
            });
            // Over its bound the assistant refuses and says why; the box
            // keeps the words, as the composer does.
            return (
              (edited.command?.argument?.length ?? 0) <= QUESTION_ARGUMENT_MAX
            );
          }
        : undefined,
      onRenew: offer.renew ? renew : undefined,
      onCompleteSearch: offer.completeSearch
        ? () => {
            setFollowing(true);
            if (runId) void assistant?.locate.complete(runId);
          }
        : undefined,
      onCompleteReview: offer.completeReview
        ? () => {
            setFollowing(true);
            if (runId) void assistant?.reviews.complete(runId);
          }
        : undefined,
      onCompleteMap: offer.completeMap
        ? () => {
            setFollowing(true);
            if (runId) void assistant?.maps.complete(runId);
          }
        : undefined,
      onMapWith: offer.mapWith
        ? (shape) => {
            // The same scope the answer read, on the shape its fit note
            // named: a new turn whose question is the literal command.
            const scope = turn.mapped?.scope;
            if (!scope) return;
            setFollowing(true);
            void assistant?.maps.run(scope, shape);
          }
        : undefined,
      onOpenRoute: offer.openRoute
        ? (route) => {
            if (!assistant || !active) return;
            // The chat the answer pointed to, opened with the writer's own
            // question waiting in its field to send, change or clear, never
            // sent for them.
            const asked = active.turns[at - 1];
            void assistant.chats
              .create(route.kind, { through: route.through })
              .then((chat) => {
                // A plain question only: a command's text is its expanded
                // instruction, not the writer's.
                if (
                  asked?.role === "user" &&
                  !asked.command &&
                  asked.text.trim()
                )
                  writeDraft(chat.id, asked.text);
              });
          }
        : undefined,
      keyVerdict:
        offer.last && turn.model
          ? remoteProviders?.[turn.model.providerId]
          : undefined,
    };
  };

  return { liveTurnId, evidenceNotice, propsFor };
}
