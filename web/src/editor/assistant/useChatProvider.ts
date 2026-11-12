// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";
import type { Assistant } from "../../ai";
import type { ModelRef } from "../../ai/domain/models";
import type { ChatTurn, ModelDescriptor } from "../../ai/domain/types";
import { keyRemedy, type KeyVerdict } from "./keyVerdict";

/** A remote provider as the account layer reports it. */
export type RemoteProvider = KeyVerdict & { upstreamHost?: string };

/** What the provider answering this chat means for the panel. */
export interface ChatProvider {
  /**
   * The chat's model as listed, for the Mode bar to name the effort a
   * position means on that model's own scale; `null` until listed, or when
   * it is not offered.
   */
  chatModel: ModelDescriptor | null;
  /** The provider the chat's model is on, if it has one. */
  chatProvider: string | undefined;
  /** That provider's key verdict, read and never derived. */
  chatKey: RemoteProvider | undefined;
  /** The vendor's host a command would send the book to, or `null`. */
  remoteHost: string | null;
  /** The host for any provider id, for a turn on another model. */
  hostOf: (id: string) => string;
  /** The last turn's banner already states the key's state. */
  keySaidAbove: boolean;
}

/**
 * The provider that answers the active chat: its model as described, its
 * key, and the host its bytes go to. Keyed on the chat's own provider, so a
 * writer working with their own Ollama is told nothing about a remote key
 * they are not spending.
 */
export function useChatProvider({
  assistant,
  model,
  remoteProviders,
  lastTurn,
  failedInTranscript,
}: {
  assistant: Assistant | null | undefined;
  model: ModelRef | null | undefined;
  remoteProviders: Record<string, RemoteProvider> | undefined;
  lastTurn: ChatTurn | undefined;
  failedInTranscript: boolean;
}): ChatProvider {
  // One listing each time the chat's model changes, never per render, kept
  // with the address it answers for so a switch shows no other model's
  // scale while the next listing is in flight.
  const chatProviderId = model?.providerId ?? null;
  const chatModelId = model?.modelId ?? null;
  const [described, setDescribed] = useState<ModelDescriptor | null>(null);
  useEffect(() => {
    if (!assistant || chatProviderId === null || chatModelId === null) return;
    const controller = new AbortController();
    let live = true;
    void assistant
      .listModels(controller.signal)
      .then((found) => {
        if (!live) return;
        setDescribed(
          found.find(
            (one) =>
              one.providerId === chatProviderId && one.id === chatModelId,
          ) ?? null,
        );
      })
      // Not offered, or the provider is down: the bar shows the temperature
      // alone, the only value it can then name truthfully.
      .catch(() => {
        if (live) setDescribed(null);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [assistant, chatProviderId, chatModelId]);
  const chatModel =
    described &&
    described.providerId === chatProviderId &&
    described.id === chatModelId
      ? described
      : null;

  const chatProvider = model?.providerId;
  const chatKey = chatProvider ? remoteProviders?.[chatProvider] : undefined;
  // Where a command being typed would send the book, when it is a vendor's
  // rather than this machine's: read by the `/where` notice and the wide
  // review's.
  const remoteHost =
    chatProvider && remoteProviders?.[chatProvider]
      ? (remoteProviders[chatProvider].upstreamHost ?? chatProvider)
      : null;
  // The same answer for any provider id, for a turn whose model was not the
  // chat's current one (the failure strip's credit sentence).
  const hostOf = (id: string) => remoteProviders?.[id]?.upstreamHost ?? id;
  // When the turn above failed over its key and still offers the remedy, its
  // banner already states the fact, and the composer's line would repeat it.
  // Decided by `keyRemedy`, the rule the turn itself renders by.
  const lastRemedy =
    failedInTranscript && lastTurn
      ? keyRemedy(
          lastTurn,
          lastTurn.model
            ? remoteProviders?.[lastTurn.model.providerId]
            : undefined,
        )
      : null;
  const keySaidAbove = lastRemedy === "renew" || lastRemedy === "new-key";
  return { chatModel, chatProvider, chatKey, remoteHost, hostOf, keySaidAbove };
}
