// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ModelDescriptor } from "../../ai/domain/models";
import type { ChatTurn } from "../../ai/domain/types";
import { assistantTestStub } from "./assistantStub.fixture";
import type { KeyVerdict } from "./keyVerdict";
import { useChatProvider, type RemoteProvider } from "./useChatProvider";

// Pins what the provider answering a chat means for the panel: the listed
// model the Mode bar names its scale from, the host a command's bytes go to,
// and whether the turn above already states the key's state.

afterEach(() => cleanup());

const model = (providerId: string, id: string) =>
  ({ providerId, id, label: id }) as unknown as ModelDescriptor;

const verdict = (state: KeyVerdict["state"]): RemoteProvider => ({
  connected: true,
  state,
  notice: null,
  waitUntil: null,
  limitUsd: null,
  upstreamHost: "openrouter.ai",
});

const failedTurn = (errorCode: string): ChatTurn =>
  ({
    id: "t2",
    role: "assistant",
    text: "",
    outcome: "failed",
    errorCode,
    model: { providerId: "openrouter", modelId: "m1" },
  }) as unknown as ChatTurn;

describe("the provider answering a chat", () => {
  it("names the chat's model as listed, and no other", async () => {
    const assistant = assistantTestStub();
    vi.mocked(assistant.listModels).mockResolvedValue([
      model("openrouter", "m0"),
      model("openrouter", "m1"),
    ]);
    const { result } = renderHook(() =>
      useChatProvider({
        assistant,
        model: { providerId: "openrouter", modelId: "m1" },
        remoteProviders: undefined,
        lastTurn: undefined,
        failedInTranscript: false,
      }),
    );
    await waitFor(() => expect(result.current.chatModel?.id).toBe("m1"));
    expect(assistant.listModels).toHaveBeenCalledTimes(1);
  });

  it("shows no model's scale for a switched chat while its listing is in flight", async () => {
    const assistant = assistantTestStub();
    vi.mocked(assistant.listModels).mockResolvedValueOnce([
      model("openrouter", "m1"),
    ]);
    const { result, rerender } = renderHook(
      ({ modelId }: { modelId: string }) =>
        useChatProvider({
          assistant,
          model: { providerId: "openrouter", modelId },
          remoteProviders: undefined,
          lastTurn: undefined,
          failedInTranscript: false,
        }),
      { initialProps: { modelId: "m1" } },
    );
    await waitFor(() => expect(result.current.chatModel?.id).toBe("m1"));
    vi.mocked(assistant.listModels).mockReturnValueOnce(new Promise(() => {}));
    rerender({ modelId: "m2" });
    expect(result.current.chatModel).toBeNull();
  });

  it("sends a command's bytes to the vendor's host, and to nobody for a local model", () => {
    const remoteProviders = { openrouter: verdict("ready") };
    const remote = renderHook(() =>
      useChatProvider({
        assistant: null,
        model: { providerId: "openrouter", modelId: "m1" },
        remoteProviders,
        lastTurn: undefined,
        failedInTranscript: false,
      }),
    ).result.current;
    expect(remote.remoteHost).toBe("openrouter.ai");
    expect(remote.chatKey?.state).toBe("ready");
    expect(remote.hostOf("elsewhere")).toBe("elsewhere");

    const local = renderHook(() =>
      useChatProvider({
        assistant: null,
        model: { providerId: "ollama", modelId: "llama" },
        remoteProviders,
        lastTurn: undefined,
        failedInTranscript: false,
      }),
    ).result.current;
    expect(local.remoteHost).toBeNull();
    expect(local.chatKey).toBeUndefined();
  });

  it("leaves the key's line to the failed turn above when it offers the remedy", () => {
    const said = (state: KeyVerdict["state"], failedInTranscript: boolean) =>
      renderHook(() =>
        useChatProvider({
          assistant: null,
          model: { providerId: "openrouter", modelId: "m1" },
          remoteProviders: { openrouter: verdict(state) },
          lastTurn: failedTurn("key-expired"),
          failedInTranscript,
        }),
      ).result.current.keySaidAbove;
    expect(said("expired", true)).toBe(true);
    expect(said("limit-reached", true)).toBe(true);
    // A key that answers again offers Try again, which says nothing of it.
    expect(said("ready", true)).toBe(false);
    expect(said("expired", false)).toBe(false);
  });
});
