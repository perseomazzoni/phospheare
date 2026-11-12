// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getPref, setPref } from "../../profile/profileSync";
import { sameModel } from "../domain/types";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
} from "../domain/types";
import type { ModelProvider, RemoteModelPreferences } from "../ports";

// The curated remote set: where the writer's choice of models is kept, and the
// provider that reads it. Both sit above the AI core because the core does not
// reach for auth or browser storage, and a synced preference is both.

/**
 * The preference key, spelled only here. The portable profile holds a
 * matching domain for it (`validModels` in `portableDoc.ts`) and refuses an
 * unknown key, so no copy can echo an arbitrary blob to every installation.
 */
export const CHOSEN_MODELS_PREF = "aiModels";

/**
 * How many models the client holds. `validModels` holds the profile to the
 * same bound and drops a longer list; this one lets the pane stop a writer at
 * the limit with a sentence instead of a write the profile drops silently.
 */
export const MAX_CHOSEN_MODELS = 24;

/** `{providerId, modelId}` and nothing else: what `validModels` accepts. */
function asRef(value: unknown): ModelRef | null {
  if (typeof value !== "object" || value === null) return null;
  const { providerId, modelId } = value as Record<string, unknown>;
  if (typeof providerId !== "string" || providerId === "") return null;
  if (typeof modelId !== "string" || modelId === "") return null;
  return { providerId, modelId };
}

export class SyncedRemoteModelPreferences implements RemoteModelPreferences {
  /**
   * Parsed on every read, not trusted as stored. The cache is a JSON blob in
   * `localStorage` that a profile pull replaces wholesale, so its shape is not
   * guaranteed. A bad row is dropped: a `ModelRef` with no `providerId` would
   * route to a provider named `undefined`. Like `parseAiSettings`, it drops
   * what is not the current shape and converts nothing.
   */
  chosen(): readonly ModelRef[] {
    const raw = getPref<unknown>(CHOSEN_MODELS_PREF, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(asRef)
      .filter((ref): ref is ModelRef => ref !== null)
      .slice(0, MAX_CHOSEN_MODELS);
  }

  /**
   * Written whole, never appended to. The preference merge is last-write-wins
   * per key, so two devices editing the set at once resolve to one of the two
   * lists rather than a union, which suits a list curated by hand.
   */
  choose(models: readonly ModelRef[]): void {
    setPref(
      CHOSEN_MODELS_PREF,
      models
        .slice(0, MAX_CHOSEN_MODELS)
        .map(({ providerId, modelId }) => ({ providerId, modelId })),
    );
  }
}

/**
 * A provider that offers only what the writer chose, and answers for anything.
 *
 * `listModels` answers what the model menu offers, which is the curated set.
 * Every other member serves a run, and curation never touches those: a chat
 * records the model that answered it, so an old conversation can continue
 * after the writer drops that model from the set. Un-choosing a model changes
 * a menu; it revokes nothing.
 *
 * It wraps the OpenRouter adapter rather than living in it, because curation is
 * an account preference, not a property of a transport.
 */
export class CuratedModelProvider implements ModelProvider {
  readonly id: string;

  constructor(
    private readonly inner: ModelProvider,
    private readonly preferences: RemoteModelPreferences,
  ) {
    // The delegate's id: a descriptor passed through still names the provider
    // that built it, and the composite routes on that id, so any other id
    // would make every model offered here unroutable.
    this.id = inner.id;
  }

  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    const chosen = this.preferences.chosen();
    // A provider connected but not curated contributes nothing to the model
    // menu rather than its whole catalogue; Settings holds the full list.
    if (chosen.length === 0) return [];

    const offered = await this.inner.listModels(signal);
    return offered.filter((model) =>
      chosen.some((ref) =>
        sameModel(ref, { providerId: model.providerId, modelId: model.id }),
      ),
    );
  }

  describeModel(ref: ModelRef, signal: AbortSignal): Promise<ModelDescriptor> {
    return this.inner.describeModel(ref, signal);
  }

  estimate(request: ModelRequest): Promise<{ tokens: number; exact: boolean }> {
    return this.inner.estimate(request);
  }

  generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    return this.inner.generate(request, signal);
  }

  // No `probeTools`: on the port, absence is the answer, and a forwarding
  // `false` would read as "probed, and it has none". The wrapped OpenRouter
  // adapter does not probe.
}
