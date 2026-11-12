// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Entry, Thread } from "../domain/model";
import { useMarginAnswers, type MarginAnswerer } from "./answers";

afterEach(cleanup);

const PERSONAS = [
  { id: "wren", name: "Wren" },
  { id: "ash", name: "Ash" },
];

const entry = (body: string, author: Entry["author"] = { kind: "writer" }) =>
  ({ id: "e", author, at: "2026-10-05T00:00:00Z", body }) as Entry;

const thread = (owner: Entry["author"]): Thread => ({
  id: "t1",
  state: "open",
  anchor: null,
  entries: [entry("Opening.", owner)],
});

/** An answer the test settles by hand, so the waiting is visible. */
function deferredAnswers() {
  const calls: {
    personaId: string;
    settle: (ok: boolean) => void;
    doing?: (line: string | null) => void;
    asking?: (ask: unknown) => void;
  }[] = [];
  const answer: MarginAnswerer = vi.fn(
    (request, onDoing, onAsking) =>
      new Promise<{ ok: boolean }>((resolve) =>
        calls.push({
          personaId: request.personaId,
          settle: (ok) => resolve({ ok }),
          doing: onDoing,
          asking: onAsking,
        }),
      ),
  );
  return { answer, calls };
}

describe("useMarginAnswers", () => {
  it("answers the personas an entry tags, one after the other, saying who is writing", async () => {
    const { answer, calls } = deferredAnswers();
    const { result } = renderHook(() => useMarginAnswers(answer, PERSONAS));
    act(() =>
      result.current.onWriterEntry?.(
        "EL2",
        thread({ kind: "writer" }),
        entry("@Ash and @Wren, what do you think?"),
      ),
    );
    await act(async () => undefined);
    expect(calls.map((c) => c.personaId)).toEqual(["ash"]);
    expect(result.current.replyState("t1")).toEqual({ writing: "Ash" });
    await act(async () => calls[0].settle(true));
    // The second answers only after the first, so it reads the first's note.
    expect(calls.map((c) => c.personaId)).toEqual(["ash", "wren"]);
    expect(result.current.replyState("t1")).toEqual({ writing: "Wren" });
    await act(async () => calls[1].settle(true));
    expect(result.current.replyState("t1")).toBeUndefined();
  });

  // An answer that reads the book says what it is reading.
  it("says what an answer is doing on its way, and stops saying it", async () => {
    const { answer, calls } = deferredAnswers();
    const { result } = renderHook(() => useMarginAnswers(answer, PERSONAS));
    act(() =>
      result.current.onWriterEntry?.(
        "EL2",
        thread({ kind: "persona", id: "wren" }),
        entry("Where else?"),
      ),
    );
    await act(async () => undefined);
    act(() => calls[0].doing?.("Reading “Two”"));
    expect(result.current.replyState("t1")).toEqual({
      writing: "Wren",
      doing: "Reading “Two”",
    });
    act(() => calls[0].doing?.(null));
    expect(result.current.replyState("t1")).toEqual({
      writing: "Wren",
      doing: null,
    });
    await act(async () => calls[0].settle(true));
    expect(result.current.replyState("t1")).toBeUndefined();
  });

  // A search waiting on the writer stays beside what the answer is doing,
  // and goes once answered.
  it("keeps a search's ask beside what the answer is doing", async () => {
    const { answer, calls } = deferredAnswers();
    const { result } = renderHook(() => useMarginAnswers(answer, PERSONAS));
    act(() =>
      result.current.onWriterEntry?.(
        "EL2",
        thread({ kind: "persona", id: "wren" }),
        entry("Is that true?"),
      ),
    );
    await act(async () => undefined);
    act(() => calls[0].asking?.("ASK"));
    act(() => calls[0].doing?.("Waiting for you"));
    expect(result.current.replyState("t1")).toEqual({
      writing: "Wren",
      asking: "ASK",
      doing: "Waiting for you",
    });
    act(() => calls[0].asking?.(null));
    expect(result.current.replyState("t1")?.asking).toBeNull();
    await act(async () => calls[0].settle(true));
    expect(result.current.replyState("t1")).toBeUndefined();
  });

  it("answers with the thread's own persona when nobody is tagged", async () => {
    const { answer, calls } = deferredAnswers();
    const { result } = renderHook(() => useMarginAnswers(answer, PERSONAS));
    act(() =>
      result.current.onWriterEntry?.(
        "EL2",
        thread({ kind: "persona", id: "wren" }),
        entry("Why?"),
      ),
    );
    await act(async () => undefined);
    expect(calls.map((c) => c.personaId)).toEqual(["wren"]);
  });

  it("says an answer did not come, and asks again on retry", async () => {
    const { answer, calls } = deferredAnswers();
    const { result } = renderHook(() => useMarginAnswers(answer, PERSONAS));
    act(() =>
      result.current.onWriterEntry?.(
        "EL2",
        thread({ kind: "writer" }),
        entry("@Wren?"),
      ),
    );
    await act(async () => undefined);
    await act(async () => calls[0].settle(false));
    const failed = result.current.replyState("t1")?.failed;
    expect(failed?.name).toBe("Wren");
    act(() => failed?.retry());
    await act(async () => undefined);
    expect(calls).toHaveLength(2);
    expect(result.current.replyState("t1")).toEqual({ writing: "Wren" });
  });

  it("calls nobody without an assistant, and nobody for a writer's untagged thread", async () => {
    const { result } = renderHook(() => useMarginAnswers(null, PERSONAS));
    expect(result.current.onWriterEntry).toBeUndefined();
    const { answer } = deferredAnswers();
    const withOne = renderHook(() => useMarginAnswers(answer, PERSONAS));
    act(() =>
      withOne.result.current.onWriterEntry?.(
        "EL2",
        thread({ kind: "writer" }),
        entry("Just a note to myself."),
      ),
    );
    await act(async () => undefined);
    expect(answer).not.toHaveBeenCalled();
  });
});
