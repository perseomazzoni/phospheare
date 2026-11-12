// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  MAX_STREAM_BYTES,
  MAX_STREAM_LINE_BYTES,
  MAX_TOOL_CALLS,
  OpenRouterStreamDecoder,
} from "./openrouterStream";
import type { ModelEvent } from "../domain/types";

// Pins the SSE decoder as a pure function of the bytes it is handed: the
// framing rules, the bounds checked before bytes are kept, the
// error frames, and what `finish` owes. The adapter's own tests drive it
// through a stream.

const bytes = (text: string) => new TextEncoder().encode(text);

function decode(...chunks: string[]): ModelEvent[] {
  const decoder = new OpenRouterStreamDecoder("openrouter", "vendor/asked");
  const events: ModelEvent[] = [];
  for (const chunk of chunks) events.push(...decoder.push(bytes(chunk)));
  events.push(...decoder.finish());
  return events;
}

const frame = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;
const delta = (
  d: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => frame({ model: "vendor/answered", choices: [{ delta: d, ...extra }] });
const DONE = "data: [DONE]\n\n";
const types = (events: ModelEvent[]) => events.map((event) => event.type);

describe("framing", () => {
  it("starts with the model the vendor says answered", () => {
    expect(decode(delta({ content: "Hi" }), DONE)[0]).toEqual({
      type: "started",
      model: { providerId: "openrouter", modelId: "vendor/answered" },
    });
    expect(
      decode(frame({ choices: [{ delta: { content: "Hi" } }] }), DONE)[0],
    ).toEqual({
      type: "started",
      model: { providerId: "openrouter", modelId: "vendor/asked" },
    });
  });

  it("joins a frame's data lines, strips one space, and ignores comments and other fields", () => {
    const body = JSON.stringify({
      choices: [{ delta: { content: "two lines" } }],
    });
    const between = body.indexOf(":") + 1;
    const joined = decode(
      ": OPENROUTER PROCESSING\n\nevent: message\nid: 7\nretry: 10\n",
      `data:${body.slice(0, between)}\ndata: ${body.slice(between)}\n\n`,
      DONE,
    );
    expect(types(joined)).toEqual(["started", "text-delta", "completed"]);
    expect(joined).toContainEqual({ type: "text-delta", text: "two lines" });

    // The lines join with "\n", so a split inside a string breaks the frame.
    const inside = decode(
      `data: ${body.slice(0, 5)}\ndata: ${body.slice(5)}\n\n`,
      DONE,
    );
    expect(types(inside)).toEqual(["failed"]);
  });

  it("reads CRLF line endings", () => {
    const events = decode(
      delta({ content: "a" }).replace(/\n/g, "\r\n"),
      "data: [DONE]\r\n\r\n",
    );
    expect(types(events)).toEqual(["started", "text-delta", "completed"]);
  });

  it("counts a last frame with no blank line, and a last line with no newline", () => {
    expect(
      types(
        decode(delta({ content: "a" }, { finish_reason: "stop" }).trimEnd()),
      ),
    ).toEqual(["started", "text-delta", "completed"]);
  });

  it("reassembles a frame split inside a multi-byte character", () => {
    const whole = bytes(delta({ content: "città" }) + DONE);
    const at = whole.indexOf(0xc3) + 1;
    const decoder = new OpenRouterStreamDecoder("openrouter", "m");
    const events = [
      ...decoder.push(whole.subarray(0, at)),
      ...decoder.push(whole.subarray(at)),
      ...decoder.finish(),
    ];
    expect(events).toContainEqual({ type: "text-delta", text: "città" });
  });

  it("reads nothing after the terminator", () => {
    const events = decode(
      delta({ content: "a" }),
      DONE,
      delta({ content: "late" }),
    );
    expect(events.filter((event) => event.type === "text-delta")).toEqual([
      { type: "text-delta", text: "a" },
    ]);
  });

  it("fails a body that was never SSE", () => {
    expect(decode('{"error":"bad gateway"}')).toEqual([
      {
        type: "failed",
        error: {
          code: "invalid-response",
          message: "The provider sent nothing this app could read.",
          retryable: false,
        },
      },
    ]);
  });

  it("fails a frame that is not JSON, and stops there", () => {
    const events = decode("data: {nope\n\n", delta({ content: "a" }));
    expect(events).toEqual([
      {
        type: "failed",
        error: {
          code: "invalid-response",
          message: "The provider sent a malformed stream.",
          retryable: false,
        },
      },
    ]);
  });
});

describe("the vendor's error frames", () => {
  it.each([
    [402, "resource-exhausted", true],
    ["429", "model-busy", true],
    ["rate_limit_exceeded", "model-busy", true],
    [408, "timeout", true],
    [504, "timeout", true],
    ["timeout", "timeout", true],
    ["server_error", "connection", true],
    [502, "connection", true],
    [400, "provider-rejected", false],
    ["moderation", "provider-rejected", false],
  ] as const)("maps code %j to %s", (code, mapped, retryable) => {
    const events = decode(
      delta({ content: "half" }),
      frame({ error: { code, message: "echoed prompt" } }),
    );
    const last = events[events.length - 1];
    expect(last).toMatchObject({
      type: "failed",
      error: { code: mapped, retryable },
    });
    expect(JSON.stringify(last)).not.toContain("echoed prompt");
  });

  it("fails a run the vendor ended with finish_reason error", () => {
    const events = decode(
      delta({ content: "a" }, { finish_reason: "error" }),
      DONE,
    );
    expect(events[events.length - 1]).toMatchObject({
      type: "failed",
      error: { code: "connection", retryable: true },
    });
  });
});

describe("tool calls", () => {
  const call = (index: number, fields: Record<string, unknown>) => ({
    index,
    ...fields,
  });

  it("assembles fragments by index, in index order, with a synthesised id when none came", () => {
    const events = decode(
      delta({
        tool_calls: [
          call(1, { function: { name: "grep", arguments: '{"q":' } }),
        ],
      }),
      delta({
        tool_calls: [
          call(0, {
            id: "a",
            function: { name: "list_sources", arguments: "{}" },
          }),
        ],
      }),
      delta(
        { tool_calls: [call(1, { function: { arguments: '"x"}' } })] },
        { finish_reason: "tool_calls" },
      ),
      DONE,
    );
    expect(events.filter((event) => event.type === "tool-call-ready")).toEqual([
      {
        type: "tool-call-ready",
        call: { id: "a", name: "list_sources", arguments: {} },
      },
      {
        type: "tool-call-ready",
        call: { id: "call_1", name: "grep", arguments: { q: "x" } },
      },
    ]);
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "tools",
    });
  });

  it("reports tools when the vendor said stop beside a call", () => {
    const events = decode(
      delta(
        {
          tool_calls: [
            call(0, { id: "a", function: { name: "grep", arguments: "{}" } }),
          ],
        },
        { finish_reason: "stop" },
      ),
      DONE,
    );
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "tools",
    });
  });

  it.each([
    ['{"q":', "A tool call's arguments could not be read."],
    ["[]", "A tool call's arguments could not be read."],
    ["", "A tool call arrived without its arguments."],
  ])("fails arguments %j rather than defaulting them", (args, message) => {
    const events = decode(
      delta({
        tool_calls: [
          call(0, { id: "a", function: { name: "grep", arguments: args } }),
        ],
      }),
      DONE,
    );
    expect(events[events.length - 1]).toEqual({
      type: "failed",
      error: { code: "invalid-response", message, retryable: false },
    });
  });

  it("fails a call with no name", () => {
    const events = decode(
      delta({
        tool_calls: [call(0, { id: "a", function: { arguments: "{}" } })],
      }),
      DONE,
    );
    expect(events[events.length - 1]).toMatchObject({
      type: "failed",
      error: { code: "invalid-response" },
    });
  });

  it("drops a call cut off at the output limit, and ends at the limit", () => {
    const events = decode(
      delta({ content: "Let me check." }),
      delta(
        {
          tool_calls: [
            call(0, {
              id: "a",
              function: { name: "grep", arguments: '{"q":"ha' },
            }),
          ],
        },
        { finish_reason: "length" },
      ),
      DONE,
    );
    expect(types(events)).toEqual(["started", "text-delta", "completed"]);
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "limit",
    });
  });

  it("refuses a step that asks for more calls than the app accepts", () => {
    const calls = Array.from({ length: MAX_TOOL_CALLS + 1 }, (_, index) =>
      call(index, {
        id: `c${index}`,
        function: { name: "grep", arguments: "{}" },
      }),
    );
    const events = decode(delta({ tool_calls: calls }), DONE);
    expect(events[events.length - 1]).toEqual({
      type: "failed",
      error: {
        code: "invalid-response",
        message: "The provider sent more than this app accepts.",
        retryable: false,
      },
    });
  });

  it("refuses arguments past a mebibyte across all calls", () => {
    const half = "x".repeat(600 * 1024);
    const events = decode(
      delta({
        tool_calls: [
          call(0, { id: "a", function: { name: "grep", arguments: half } }),
        ],
      }),
      delta({
        tool_calls: [
          call(1, { id: "b", function: { name: "grep", arguments: half } }),
        ],
      }),
      DONE,
    );
    expect(events[events.length - 1]).toMatchObject({
      type: "failed",
      error: { code: "invalid-response" },
    });
  });
});

describe("the model's working", () => {
  it("shows the plain reasoning, and an empty piece for details alone", () => {
    const events = decode(
      delta({ reasoning: "Thinking." }),
      delta({
        reasoning_details: [
          { type: "reasoning.encrypted", data: "blob", index: 0 },
        ],
      }),
      delta({ content: "Answer." }, { finish_reason: "stop" }),
      DONE,
    );
    expect(events.filter((event) => event.type === "reasoning-delta")).toEqual([
      { type: "reasoning-delta", text: "Thinking." },
      { type: "reasoning-delta", text: "" },
    ]);
    // An answered step has no continuation to replay its working into.
    expect(types(events)).not.toContain("block");
  });

  it("hands the working back on a step that asked for tools, merged by index, reasoning.* only", () => {
    const events = decode(
      delta({
        reasoning_details: [
          { type: "reasoning.text", text: "Step ", index: 0, format: "x" },
        ],
      }),
      delta({
        reasoning_details: [
          { type: "reasoning.text", text: "one.", index: 0, signature: null },
        ],
      }),
      delta({
        reasoning_details: [
          { type: "reasoning.text", index: 0, signature: "sig" },
        ],
      }),
      delta({
        reasoning_details: [
          { type: "vendor.other", text: "no", index: 1 },
          ["list"],
          { nested: { no: 1 } },
        ],
      }),
      delta(
        {
          tool_calls: [
            { index: 0, id: "a", function: { name: "grep", arguments: "{}" } },
          ],
        },
        { finish_reason: "tool_calls" },
      ),
      DONE,
    );
    expect(events.find((event) => event.type === "block")).toEqual({
      type: "block",
      block: {
        replay: [
          {
            type: "reasoning.text",
            text: "Step one.",
            index: 0,
            format: "x",
            signature: "sig",
          },
        ],
      },
    });
    const order = types(events);
    expect(order.indexOf("tool-call-ready")).toBeLessThan(
      order.indexOf("block"),
    );
  });

  it("replays nothing once the working passes its cap", () => {
    const big = "x".repeat(200 * 1024);
    const events = decode(
      delta({
        reasoning_details: [{ type: "reasoning.text", text: big, index: 0 }],
      }),
      delta({
        reasoning_details: [{ type: "reasoning.text", text: big, index: 0 }],
      }),
      delta({
        tool_calls: [
          { index: 0, id: "a", function: { name: "grep", arguments: "{}" } },
        ],
      }),
      DONE,
    );
    expect(types(events)).not.toContain("block");
    expect(events[events.length - 1]).toEqual({
      type: "completed",
      reason: "tools",
    });
  });
});

describe("usage and endings", () => {
  it("reports the tokens it was told, the cached part included, and absent ones as absent", () => {
    const events = decode(
      delta({ content: "a" }, { finish_reason: "stop" }),
      frame({
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 4 },
          cost: 0.001,
        },
      }),
      DONE,
    );
    expect(events.slice(-2)).toEqual([
      { type: "usage", inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 },
      { type: "completed", reason: "answer" },
    ]);

    const partial = decode(
      delta({ content: "a" }),
      frame({ usage: { prompt_tokens: "10", completion_tokens: 3 } }),
      DONE,
    );
    expect(partial).toContainEqual({ type: "usage", outputTokens: 3 });
  });

  it("keeps the reported cost for the account", () => {
    const decoder = new OpenRouterStreamDecoder("openrouter", "m");
    decoder.push(
      bytes(
        frame({
          choices: [{ delta: { content: "a" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.25 },
        }),
      ),
    );
    expect(decoder.spend()).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0.25,
    });
  });

  it.each([
    ["stop", "answer"],
    ["end_turn", "answer"],
    ["length", "limit"],
    ["max_tokens", "limit"],
    ["content_filter", "refusal"],
    ["stop_sequence", "stop-sequence"],
    ["something_new", "answer"],
  ])("ends %s as %s", (finish, reason) => {
    const events = decode(
      delta({ content: "a" }, { finish_reason: finish }),
      DONE,
    );
    expect(events[events.length - 1]).toEqual({ type: "completed", reason });
  });
});

describe("the bounds", () => {
  it("refuses a line past a mebibyte before keeping it", () => {
    const decoder = new OpenRouterStreamDecoder("openrouter", "m");
    expect(
      decoder.push(new Uint8Array(MAX_STREAM_LINE_BYTES + 1).fill(0x61)),
    ).toEqual([
      {
        type: "failed",
        error: {
          code: "invalid-response",
          message: "The provider sent more than this app accepts.",
          retryable: false,
        },
      },
    ]);
    expect(decoder.push(bytes(DONE))).toEqual([]);
    expect(decoder.finish()).toEqual([]);
  });

  it("refuses a frame whose data lines together pass a mebibyte", () => {
    const line = `data: ${"x".repeat(600 * 1024)}\n`;
    const events = decode(line, line, "\n");
    expect(events[0]).toMatchObject({
      type: "failed",
      error: { code: "invalid-response" },
    });
  });

  it("refuses a stream past its whole cap", () => {
    const decoder = new OpenRouterStreamDecoder("openrouter", "m");
    // Keepalive comments, each a mebibyte with its newline: 32 MiB a push.
    const half = new Uint8Array(32 * 1024 * 1024).fill(0x3a);
    for (let end = 1024 * 1024 - 1; end < half.length; end += 1024 * 1024)
      half[end] = 0x0a;
    expect(decoder.push(half)).toEqual([]);
    expect(decoder.push(half)).toEqual([]);
    expect(MAX_STREAM_BYTES).toBe(64 * 1024 * 1024);
    expect(decoder.push(bytes("\n"))[0]).toMatchObject({
      type: "failed",
      error: { code: "invalid-response" },
    });
  });
});
