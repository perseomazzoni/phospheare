// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { StrictMode, useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { Assistant, DEFAULT_PERSONA } from "../ai";
import type {
  Artifacts,
  ChatRecord,
  ModelProvider,
  ProjectSources,
} from "../ai";
import { useDeferredDispose } from "./useDeferredDispose";

// StrictMode's mount/cleanup/mount cycle never disposes the live instance, a
// replaced instance is disposed (a rebuild of the editor's dependencies is
// not a remount), and a real unmount disposes.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDeferredDispose", () => {
  it("does not dispose an instance StrictMode remounts", () => {
    vi.useFakeTimers();
    const value = { dispose: vi.fn() };
    const view = renderHook(() => useDeferredDispose(value), {
      wrapper: StrictMode,
    });
    vi.runAllTimers();
    expect(value.dispose).not.toHaveBeenCalled();
    view.unmount();
    vi.runAllTimers();
    expect(value.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes the previous instance when the value is replaced", () => {
    vi.useFakeTimers();
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const view = renderHook(({ value }) => useDeferredDispose(value), {
      initialProps: { value: first },
    });
    view.rerender({ value: second });
    vi.runAllTimers();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    view.unmount();
    vi.runAllTimers();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  // The chat search's document cache holds a chat's text, titles and urls,
  // and only `dispose` clears it. The editor builds its Assistant in
  // a `useMemo` keyed on the account and the project (`aiAccountId` and `ref`
  // in `EditorRoute.tsx`) and hands it to this hook, so signing out (the
  // Assistant becomes null) and switching projects (a new Assistant) both go
  // through here. The row composes that with a real Assistant warm on a
  // stable builder, and asserts the instance left behind serves and builds
  // nothing.
  it("disposes the editor's Assistant on a project switch and on sign-out, and its search builds nothing after", async () => {
    vi.useFakeTimers();
    const record = (id: string): ChatRecord => ({
      schemaVersion: 1,
      id,
      title: id,
      kind: "general",
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
      preferences: {
        personaId: DEFAULT_PERSONA.id,
        model: { providerId: "test-model", modelId: "llama-test" },
        pinnedSourceIds: [],
      },
      turns: [
        {
          id: `${id}-a`,
          role: "assistant",
          text: "An answer.",
          createdAt: "2026-09-27T00:00:00.000Z",
          outcome: "complete",
        },
      ],
    });
    const built: Assistant[] = [];
    const assistantFor = (project: string) => {
      const assistant = new Assistant({
        artifacts: {
          listChats: async () => ({ chats: [record(project)], unreadable: [] }),
        } as unknown as Artifacts,
        sources: { list: async () => [] } as unknown as ProjectSources,
        model: {} as ModelProvider,
        defaultNode: () => null,
      });
      built.push(assistant);
      return assistant;
    };
    const builder = vi.fn(() => "An answer.");
    const view = renderHook(
      ({ account, project }: { account: string | null; project: string }) => {
        const assistant = useMemo(
          () => (account === null ? null : assistantFor(project)),
          [account, project],
        );
        useDeferredDispose(assistant);
        return assistant;
      },
      { initialProps: { account: "40" as string | null, project: "book-a" } },
    );
    const warm = async (assistant: Assistant | null) => {
      if (!assistant) throw new Error("expected an Assistant");
      await assistant.initialize();
      expect(assistant.searchDocuments(builder)).toHaveLength(1);
      return assistant;
    };

    const bookA = await warm(view.result.current);
    view.rerender({ account: "40", project: "book-b" });
    const bookB = await warm(view.result.current);
    vi.runAllTimers();
    builder.mockClear();
    expect(bookA.searchDocuments(builder)).toEqual([]);
    expect(builder).not.toHaveBeenCalled();

    view.rerender({ account: null, project: "book-b" });
    expect(view.result.current).toBeNull();
    vi.runAllTimers();
    expect(bookB.searchDocuments(builder)).toEqual([]);
    expect(builder).not.toHaveBeenCalled();
    expect(built).toHaveLength(2);
  });

  it("tolerates a null value", () => {
    vi.useFakeTimers();
    const view = renderHook(() => useDeferredDispose(null));
    expect(() => {
      view.unmount();
      vi.runAllTimers();
    }).not.toThrow();
  });
});
