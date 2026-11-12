// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ModelProvider } from "../ports";
import type {
  ModelDescriptor,
  ModelEvent,
  ModelRef,
  ModelRequest,
} from "../domain/types";
import { estimateRequestTokens } from "../domain/estimate";

/**
 * One provider in front of the two kinds a model can be reached by.
 *
 * A composite, not a registry: the composition root hands in the delegates,
 * and an id nobody handed in is not turned into anything.
 * `routingProvider.test.ts` pins that refusal.
 *
 * The list stays short. OpenRouter fronts every hosted vendor, so the SPA
 * has two adapters, Ollama on the device and OpenRouter for the rest, each
 * instantiated once per connected provider. A vendor OpenRouter serves needs
 * no entry here.
 *
 * It never guesses. A `ModelRef` naming a provider that is not here is an
 * ordinary state: a chat records its model, the writer disconnects
 * that provider, and the chat stays on screen with its history. Falling back
 * to another provider would answer in a different model's voice, charge a
 * different account and record the wrong pair in the turn, so the answer is
 * a refusal that names the problem.
 */
export class RoutingModelProvider implements ModelProvider {
  /**
   * Never a valid `ModelRef.providerId`, and nothing mints one. Every
   * descriptor this returns carries its delegate's id, because the delegate
   * built it, so `find` refuses a ref naming `routing` as it refuses any
   * other unknown id.
   */
  readonly id = "routing";

  private readonly providers: readonly ModelProvider[];

  constructor(...providers: readonly ModelProvider[]) {
    this.providers = providers;
  }

  /**
   * Everything reachable, in the order the composition root passed the
   * providers: the device first.
   *
   * An Ollama that is not running is the common case, and one rejection must
   * not empty a menu with remote models to offer. Rejections are dropped
   * rather than reported: the menu has to open, and its settings row is how
   * a writer fixes a provider that is down.
   */
  async listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    const listings = await Promise.allSettled(
      this.providers.map((provider) => provider.listModels(signal)),
    );

    return listings.flatMap((listing) =>
      listing.status === "fulfilled" ? listing.value : [],
    );
  }

  async describeModel(
    ref: ModelRef,
    signal: AbortSignal,
  ): Promise<ModelDescriptor> {
    return this.require(ref.providerId).describeModel(ref, signal);
  }

  /**
   * Routed where it can be, counted here where it cannot.
   *
   * The fallback is not a guess: every adapter estimates with
   * `estimateRequestTokens`, so the number is the one the delegate would
   * produce. Routing lets a provider that can count exactly say so. The
   * fallback lets a chat whose provider was disconnected reach `generate`,
   * where the refusal is a `failed` event the transcript can render, rather
   * than an unhandled throw a step earlier.
   */
  async estimate(
    request: ModelRequest,
  ): Promise<{ tokens: number; exact: boolean }> {
    const provider = this.find(request.model.providerId);
    return provider
      ? provider.estimate(request)
      : estimateRequestTokens(request);
  }

  /**
   * A run, or a refusal yielded rather than thrown, because this is the path
   * a writer is looking at. `not-configured` copy sends the writer to
   * Settings.
   */
  async *generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const provider = this.find(request.model.providerId);

    if (!provider) {
      yield {
        type: "failed",
        error: {
          code: "not-configured",
          message: `No provider is connected for ${request.model.providerId}.`,
          retryable: false,
        },
      };
      return;
    }

    yield* provider.generate(request, signal);
  }

  /**
   * Delegated, and throws where the delegate has none.
   *
   * `probeTools` is optional on the port so a provider that cannot probe
   * says so by not implementing it, and the answer differs per ref, so the
   * composite cannot answer for the whole list. Returning `false` would read
   * as "probed, and this model has no tools", hiding a working model's tool
   * support. Callers gate on `descriptor.kind === "device"` before asking, so
   * the throw marks a caller that skipped the gate.
   */
  async probeTools(ref: ModelRef, signal: AbortSignal): Promise<boolean> {
    const provider = this.require(ref.providerId);

    if (!provider.probeTools)
      throw new Error(`probe-unsupported:${ref.providerId}`);

    return provider.probeTools(ref, signal);
  }

  private find(providerId: string): ModelProvider | undefined {
    return this.providers.find((provider) => provider.id === providerId);
  }

  private require(providerId: string): ModelProvider {
    const provider = this.find(providerId);
    if (!provider) throw new Error(`no-provider-for:${providerId}`);
    return provider;
  }
}
