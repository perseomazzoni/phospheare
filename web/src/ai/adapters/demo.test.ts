// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { DEMO_MODEL, DemoModelProvider, type DemoModelCopy } from "./demo";
import type { ModelEvent, ModelMessage, ModelRequest } from "../domain/types";

const english: DemoModelCopy = {
  replies: ["First reply.", "Second reply,\nover two lines.", "Third reply."],
  disclaimer: "A static reply.",
};

function request(questions: number): ModelRequest {
  const messages: ModelMessage[] = [];
  for (let i = 0; i < questions; i++) {
    if (i > 0) messages.push({ role: "assistant", content: "earlier" });
    messages.push({ role: "user", content: `question ${i + 1}` });
  }
  return {
    model: DEMO_MODEL,
    instructions: "be helpful",
    messages,
    tools: [],
    limits: { inputTokens: 30_000, outputTokens: 2_000 },
  } as ModelRequest;
}

async function collect(
  provider: DemoModelProvider,
  req: ModelRequest,
  signal = new AbortController().signal,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.generate(req, signal)) events.push(event);
  return events;
}

function textOf(events: ModelEvent[]): string {
  return events
    .map((event) => (event.type === "text-delta" ? event.text : ""))
    .join("");
}

describe("the demo model", () => {
  it("ends every reply with the disclaimer as its own paragraph", async () => {
    const provider = new DemoModelProvider(() => english, 0);
    for (let asked = 1; asked <= 5; asked++) {
      const text = textOf(await collect(provider, request(asked)));
      expect(text.endsWith(`\n\n_${english.disclaimer}_`)).toBe(true);
    }
  });

  it("walks the replies in order and starts over after the last", async () => {
    const provider = new DemoModelProvider(() => english, 0);
    const texts = [];
    for (let asked = 1; asked <= 4; asked++)
      texts.push(textOf(await collect(provider, request(asked))));

    expect(texts).toEqual([
      "First reply.\n\n_A static reply._",
      "Second reply,\nover two lines.\n\n_A static reply._",
      "Third reply.\n\n_A static reply._",
      "First reply.\n\n_A static reply._",
    ]);
  });

  it("streams a whole answer and ends it as an answer", async () => {
    const provider = new DemoModelProvider(() => english, 0);
    const events = await collect(provider, request(1));

    expect(events[0]).toEqual({ type: "started", model: DEMO_MODEL });
    expect(
      events.filter((event) => event.type === "text-delta").length,
    ).toBeGreaterThan(1);
    expect(events.some((event) => event.type === "tool-call-ready")).toBe(
      false,
    );
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "answer",
    });
  });

  it("answers a cancelled request with a cancellation and no text", async () => {
    const provider = new DemoModelProvider(() => english, 0);
    const controller = new AbortController();
    controller.abort();
    const events = await collect(provider, request(1), controller.signal);

    expect(events).toEqual([
      expect.objectContaining({
        type: "failed",
        error: expect.objectContaining({ code: "cancelled" }),
      }),
    ]);
  });

  it("stops streaming when the writer stops the answer", async () => {
    const provider = new DemoModelProvider(() => english, 5);
    const controller = new AbortController();
    const events: ModelEvent[] = [];
    for await (const event of provider.generate(
      request(1),
      controller.signal,
    )) {
      events.push(event);
      if (event.type === "text-delta") controller.abort();
    }

    expect(events[events.length - 1]).toMatchObject({
      type: "failed",
      error: { code: "cancelled" },
    });
    expect(textOf(events)).not.toContain(english.disclaimer);
  });

  it("reads its words per answer, so a language switch lands on the next one", async () => {
    let copy = english;
    const provider = new DemoModelProvider(() => copy, 0);
    const before = textOf(await collect(provider, request(1)));
    copy = { replies: ["Prima."], disclaimer: "Fisso." };
    const after = textOf(await collect(provider, request(1)));

    expect(before).toBe("First reply.\n\n_A static reply._");
    expect(after).toBe("Prima.\n\n_Fisso._");
  });

  it("lists one device model named ShAIne that reports tools", async () => {
    const provider = new DemoModelProvider(() => english, 0);
    const [model, ...rest] = await provider.listModels(
      new AbortController().signal,
    );

    expect(rest).toEqual([]);
    expect(model).toMatchObject({
      id: "ShAIne",
      label: "ShAIne",
      providerId: DEMO_MODEL.providerId,
      kind: "device",
      capabilities: { tools: true },
    });
  });
});
