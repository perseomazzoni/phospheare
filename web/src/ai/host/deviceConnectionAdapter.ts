// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { getCurrentUserId } from "../../auth/currentUser";
import { isUserPurged } from "../../profile/purgeLatch";
import {
  DEFAULT_AI,
  aiSettingsKey,
  parseAiSettings,
  serializeAiSettings,
} from "../settings";
import type {
  AiConnectionSettings,
  ModelDescriptor,
  ModelEvent,
  ModelRequest,
  ModelRef,
} from "../domain/types";
import type { ConnectionPreferences, ModelProvider } from "../ports";
import { OllamaProvider } from "../adapters/ollama";

// The device-local Ollama connection: endpoint, model and resource preset,
// none of them secret. It belongs to this device and this account. A project
// copied to another machine uses that machine's setup, so the connection never
// enters a project file or the synced preferences, and the storage key scopes
// it to the account.
//
// The adapter sits above the AI core because the core does not reach for auth
// or browser storage. It honours the purge latch, so a late write cannot
// restore settings a sign-out wiped.

// With no current id it fails closed both ways: it reads the default and writes
// nothing. `getCurrentUserId` is null for a visitor and before a writer session
// is adopted, so a key for "nobody" would cross accounts: one account's
// endpoint written in that window, read back by the next.
export class DeviceConnectionPreferences implements ConnectionPreferences {
  load(): AiConnectionSettings {
    const key = aiSettingsKey(getCurrentUserId());
    if (key === null) return DEFAULT_AI;
    try {
      return parseAiSettings(localStorage.getItem(key));
    } catch {
      return DEFAULT_AI;
    }
  }

  save(settings: AiConnectionSettings): void {
    const userId = getCurrentUserId();
    const key = aiSettingsKey(userId);
    if (key === null || (userId && isUserPurged(userId))) return;
    try {
      // The default is code, not data: `load` answers `DEFAULT_AI` for a
      // missing key, so saving the default removes the key. A change to
      // `DEFAULT_AI` then reaches every writer who never chose an address. A
      // throw here (an address off the device) leaves the key as it was.
      const serialized = serializeAiSettings(settings);
      if (serialized === serializeAiSettings(DEFAULT_AI))
        localStorage.removeItem(key);
      else localStorage.setItem(key, serialized);
    } catch {
      // Storage disabled: the in-memory settings last the session.
    }
  }
}

/**
 * The Ollama provider whose endpoint follows the device settings. One adapter
 * is cached per endpoint, so the cold/warm bookkeeping survives across calls
 * and a changed port in Settings still applies on the next request.
 */
export class DeviceOllamaProvider implements ModelProvider {
  readonly id = "ollama";
  private readonly providers = new Map<string, OllamaProvider>();

  constructor(private readonly connection: ConnectionPreferences) {}

  private provider(): OllamaProvider {
    const endpoint = this.connection.load().endpoint;
    const existing = this.providers.get(endpoint);
    if (existing) return existing;
    const created = new OllamaProvider(endpoint);
    this.providers.set(endpoint, created);
    return created;
  }

  listModels(signal: AbortSignal): Promise<ModelDescriptor[]> {
    return this.provider().listModels(signal);
  }

  describeModel(ref: ModelRef, signal: AbortSignal): Promise<ModelDescriptor> {
    return this.provider().describeModel(ref, signal);
  }

  estimate(request: ModelRequest): Promise<{ tokens: number; exact: boolean }> {
    return this.provider().estimate(request);
  }

  generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    return this.provider().generate(request, signal);
  }

  probeTools(ref: ModelRef, signal: AbortSignal): Promise<boolean> {
    return this.provider().probeTools(ref, signal);
  }
}
