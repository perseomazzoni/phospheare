// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The editor's services for a signed-in writer's project: the session, the
// writer's models and searches, storage reconnection and the sync queue. Only
// the full program's project route mounts it.

import { useMemo, useRef } from "react";
import { useAuth } from "../../auth/AuthContext";
import { getCurrentUserId } from "../../auth/currentUser";
import { holdOpenWork } from "../../auth/openWork";
import { connectionFor } from "../../storage/connections";
import {
  useLostPaths,
  useSyncPendingPaths,
} from "../../project/sync/useSyncState";
import { forgetLostAt, readStale } from "../../project/sync/remoteQueue";
import { getManifest } from "../../project/sync/manifestStore";
import { projectIdFor } from "../../project/projectId";
import { RoutingModelProvider } from "../../ai/adapters/routingProvider";
import {
  DeviceConnectionPreferences,
  DeviceOllamaProvider,
} from "../../ai/host/deviceConnectionAdapter";
import {
  CuratedModelProvider,
  SyncedRemoteModelPreferences,
} from "../../ai/host/remoteModels";
import {
  OPENROUTER_ID,
  openRouterProvider,
  openRouterSearch,
  wikipediaSearch,
} from "../../ai/host/openrouterConnection";
import type {
  AssistantWiring,
  EditorFace,
  EditorServices,
  ProjectPlace,
} from "./port";

/**
 * The curated remote set, read by the model button. Module scope because it
 * holds no state: every read goes to the preference cache and every write
 * through the sync drain. A stable identity keeps the memo below from
 * rebuilding every provider on each render.
 */
const remoteModelPreferences = new SyncedRemoteModelPreferences();

function useAccountFace(): EditorFace | null {
  return useAuth().user;
}

/**
 * The writer's models and searches. The device model comes first: a model on
 * the writer's own machine is free and private, and its answers never leave
 * the machine. The Assistant still needs an account, but the device model
 * spends nothing of it.
 */
function useAccountWiring(
  languageCode: () => string | undefined,
): AssistantWiring | null {
  const { user } = useAuth();
  // A primitive, so the wiring is keyed on who rather than on an object
  // every account re-read replaces: the same writer keeps the Assistant and
  // no answer is aborted, and a different one gets a new one, so a run
  // started for one account never goes on sending as another.
  const accountId = user?.id ?? null;
  const openRouter = user?.openRouter;
  // Read per search, so a verdict or a language change rebuilds nothing.
  const live = useRef({ openRouter, languageCode });
  live.current = { openRouter, languageCode };

  // One instance, so a settings change lands on the next request, not the
  // next project open.
  const connection = useMemo(() => new DeviceConnectionPreferences(), []);

  // The OpenRouter adapter, built while a key is connected, which it reads
  // per request. Unconnected, it is left out rather than listed
  // and refused: offering models that cannot answer is worse than not
  // offering them. It is wrapped in the writer's curated set; only
  // `listModels` is filtered, and a chat already pointed at a model still
  // runs, because un-choosing a model changes a menu and is not a revocation.
  //
  // Keyed on whether a key is connected, never on the status object, which
  // is replaced whenever a key's verdict changes, as `accountId` keys the
  // wiring.
  const remoteConnected = openRouter?.connected === true;
  const remoteModels = useMemo(
    () =>
      accountId === null || !remoteConnected
        ? []
        : [
            new CuratedModelProvider(
              openRouterProvider(accountId),
              remoteModelPreferences,
            ),
          ],
    [accountId, remoteConnected],
  );

  // The provider search engines, one per model, keyed like `remoteModels`.
  const providerSearch = useMemo(
    () =>
      accountId === null || !remoteConnected
        ? null
        : openRouterSearch(accountId),
    [accountId, remoteConnected],
  );

  return useMemo<AssistantWiring | null>(
    () =>
      accountId === null
        ? null
        : {
            // The composite is a lookup over this list and never invents a
            // provider for an id nobody passed in (`ai/contract.test.ts`).
            createModel: () =>
              new RoutingModelProvider(
                new DeviceOllamaProvider(connection),
                ...remoteModels,
              ),
            webSearch: {
              // The floor. The edition follows the book's language, read per
              // search, a fact the model is never told.
              wikipedia: wikipediaSearch(() => live.current.languageCode()),
              // The provider of the run's own model, when its key's live
              // verdict says it can answer now, and the memoised engine for
              // that model, so the same model is always the same object. A
              // run on a device model searches Wikipedia: no other model
              // stands in for the one the writer chose.
              provider: (model) => {
                const verdict = live.current.openRouter;
                return providerSearch &&
                  model.providerId === OPENROUTER_ID &&
                  verdict?.connected === true &&
                  verdict.state === "ready"
                  ? providerSearch(model.modelId)
                  : null;
              },
              // Who is signed in at the instant of asking: the check at
              // approval and before each send that no switch slipped past.
              accountId: getCurrentUserId,
            },
          },
    [accountId, connection, remoteModels, providerSearch],
  );
}

function useAccountRemoteProviders() {
  const openRouter = useAuth().user?.openRouter;
  return useMemo(
    () => (openRouter ? { [openRouter.providerId]: openRouter } : undefined),
    [openRouter],
  );
}

/** The pull mark the sync leaves until a pull's manifest is saved. */
async function pullUnfinished(place: ProjectPlace): Promise<boolean> {
  const projectId = projectIdFor(place);
  if (!projectId) return false;
  try {
    return (await getManifest(projectId))?.pulling === true;
  } catch {
    // An unreadable manifest store says nothing about this project's pull.
    return false;
  }
}

export const accountServices: EditorServices = {
  exit: "library",
  useFace: useAccountFace,
  useAssistantWiring: useAccountWiring,
  useRemoteProviders: useAccountRemoteProviders,
  holdOpenWork,
  connectionFor,
  usePendingPaths: useSyncPendingPaths,
  useLostPaths,
  readStale,
  forgetLostAt,
  pullUnfinished,
};
