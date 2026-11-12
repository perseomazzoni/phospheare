// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  current: { id: null as string | null },
  purged: new Set<string>(),
}));

vi.mock("../../auth/currentUser", () => ({
  getCurrentUserId: () => hoisted.current.id,
}));

vi.mock("../../profile/purgeLatch", () => ({
  isUserPurged: (userId: string) => hoisted.purged.has(userId),
}));

import { OllamaProvider } from "../adapters/ollama";
import { DEFAULT_AI } from "../settings";
import {
  DeviceConnectionPreferences,
  DeviceOllamaProvider,
} from "./deviceConnectionAdapter";

beforeEach(() => {
  localStorage.clear();
  hoisted.current.id = null;
  hoisted.purged.clear();
  vi.restoreAllMocks();
});

afterEach(() => vi.restoreAllMocks());

const settings = { endpoint: "http://127.0.0.1:11434" };
const REF = { providerId: "ollama", modelId: "m" };

describe("device connection adapter", () => {
  it("stores the connection under the signed-in account's own key", () => {
    hoisted.current.id = "user-1";
    const connection = new DeviceConnectionPreferences();
    expect(connection.load().endpoint).toBe(DEFAULT_AI.endpoint);
    connection.save(settings);
    expect(
      JSON.parse(localStorage.getItem("ai.connection.user-1") ?? "null"),
    ).toMatchObject({ endpoint: "http://127.0.0.1:11434" });

    hoisted.current.id = "user-2";
    expect(connection.load().endpoint).toBe(DEFAULT_AI.endpoint);
  });

  it("keeps no connection for nobody: the default is read, nothing is written", () => {
    // A null user is both a visitor and the window before a session is adopted,
    // so a key for nobody would carry one account's endpoint to the next.
    // A stored `.anonymous` key is not read either.
    localStorage.setItem(
      "ai.connection.anonymous",
      JSON.stringify({ endpoint: "http://127.0.0.1:9999" }),
    );
    const connection = new DeviceConnectionPreferences();
    expect(connection.load()).toEqual(DEFAULT_AI);
    connection.save(settings);
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("ai.connection."),
    );
    expect(keys).toEqual(["ai.connection.anonymous"]);
    // Untouched: the save does not land in it.
    expect(localStorage.getItem("ai.connection.anonymous")).toContain("9999");
    expect(localStorage.getItem("ai.connection.null")).toBeNull();
  });

  it("refuses a write after the purge latch is held", () => {
    hoisted.current.id = "user-1";
    hoisted.purged.add("user-1");
    new DeviceConnectionPreferences().save(settings);
    expect(localStorage.getItem("ai.connection.user-1")).toBeNull();
  });

  it("stores nothing for the default address, and forgets a custom one on the way back", () => {
    hoisted.current.id = "user-1";
    const connection = new DeviceConnectionPreferences();
    connection.save(DEFAULT_AI);
    expect(localStorage.getItem("ai.connection.user-1")).toBeNull();

    connection.save(settings);
    expect(localStorage.getItem("ai.connection.user-1")).not.toBeNull();
    connection.save(DEFAULT_AI);
    expect(localStorage.getItem("ai.connection.user-1")).toBeNull();
    expect(connection.load()).toEqual(DEFAULT_AI);
  });

  it("falls back to the default on unreadable storage", () => {
    hoisted.current.id = "user-1";
    localStorage.setItem("ai.connection.user-1", "{broken");
    expect(new DeviceConnectionPreferences().load().endpoint).toBe(
      "http://localhost:11434",
    );
  });

  it("delegates model calls to an Ollama provider built from current settings", async () => {
    hoisted.current.id = "user-1";
    new DeviceConnectionPreferences().save(settings);
    const list = vi
      .spyOn(OllamaProvider.prototype, "listModels")
      .mockResolvedValue([]);
    const describe = vi
      .spyOn(OllamaProvider.prototype, "describeModel")
      .mockResolvedValue({
        id: "m",
        providerId: "ollama",
        label: "m",
        kind: "device" as const,
        capabilities: { tools: false, structuredOutput: true },
      });
    const estimate = vi
      .spyOn(OllamaProvider.prototype, "estimate")
      .mockResolvedValue({ tokens: 1, exact: false });
    const generate = vi
      .spyOn(OllamaProvider.prototype, "generate")
      .mockImplementation(async function* () {
        yield { type: "completed" as const, reason: "answer" as const };
      });
    const probe = vi
      .spyOn(OllamaProvider.prototype, "probeTools")
      .mockResolvedValue(true);

    const provider = new DeviceOllamaProvider(
      new DeviceConnectionPreferences(),
    );
    const signal = new AbortController().signal;
    await provider.listModels(signal);
    await provider.describeModel(REF, signal);
    await provider.estimate({
      model: REF,
      instructions: "",
      messages: [],
      tools: [],
      limits: { inputTokens: 1, outputTokens: 1 },
    });
    for await (const event of provider.generate(
      {
        model: REF,
        instructions: "",
        messages: [],
        tools: [],
        limits: { inputTokens: 1, outputTokens: 1 },
      },
      signal,
    )) {
      expect(event.type).toBe("completed");
    }
    expect(list).toHaveBeenCalled();
    expect(describe).toHaveBeenCalledWith(REF, signal);
    expect(estimate).toHaveBeenCalled();
    expect(generate).toHaveBeenCalled();
    const probed = { ...REF, modelRevision: "digest" };
    await expect(provider.probeTools(probed, signal)).resolves.toBe(true);
    expect(probe).toHaveBeenCalledWith(probed, signal);
  });
});
