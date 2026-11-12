// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "../domain/types";
import { WEB_SEARCHES_PER_RUN } from "../domain/webEngine";
import { WEB_RESULTS_MAX } from "../domain/webText";
import {
  CONTEXT_HEADROOM,
  DEFAULT_CONTEXT_TOKENS,
  INSTRUCTION_RESERVE,
  THINKING_STEP_TOKENS,
  VERIFY_JUDGE_RESULTS,
  budgetFor,
  historyOverBudget,
  limitsFor,
} from "./budgets";

const descriptor = (contextTokens?: number): ModelDescriptor => ({
  id: "test",
  providerId: "ollama",
  label: "test",
  kind: "device" as const,
  capabilities: { tools: true, structuredOutput: true },
  contextTokens,
});

/** A model that reasons on its own scale, least first. */
const scaled = (efforts: string[], window = 32_000): ModelDescriptor => ({
  ...descriptor(window),
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: true,
    efforts,
  },
});

describe("run budgets", () => {
  it("reserves headroom and output before admitting input", () => {
    const limits = limitsFor(descriptor(32_000));
    expect(limits.inputTokens).toBe(
      Math.floor(32_000 * (1 - CONTEXT_HEADROOM)) - limits.outputTokens,
    );
    expect(limits.inputTokens).toBeGreaterThan(1_000);
  });

  it("sizes the index by what the window can afford, and never above the ceiling", () => {
    // The reserve and the row count derive from one measured row cost, so
    // they agree with the renderer and with each other.
    //
    // The allowance scales with the window rather than the reserve covering
    // 120 rows: the reserve feeds `MIN_INPUT_TOKENS`, so sizing it for the
    // ceiling would push the refusal floor past what a small window admits.
    // A small model gets a short index and collapses sooner. The smallest
    // window admitted is 16k.
    const small = budgetFor(descriptor(16_384));
    const large = budgetFor(descriptor(200_000));
    expect(small.manifestRows).toBeGreaterThan(0);
    expect(small.manifestRows).toBeLessThan(large.manifestRows);
    // The ceiling holds, because the index travels on every turn.
    expect(large.manifestRows).toBe(120);
    // And the rows it promises fit what was held back for them.
    expect(small.manifestRows * 64).toBeLessThanOrEqual(
      Math.max(2_400, Math.floor(small.totalCharacters * 0.08)),
    );
  });

  it("honours a model's own output ceiling over the default", () => {
    // `OUTPUT_MAX` is an Ollama-flavoured number. A hosted model that
    // publishes its own maximum is the better fact, and the budget takes it.
    expect(
      limitsFor({ ...descriptor(200_000), maxOutputTokens: 1_024 })
        .outputTokens,
    ).toBe(1_024);
  });

  // A fixed table of presets would admit a fraction of a large model's
  // window and discard the rest without saying so.
  it("admits the model's own window, not a fixed table", () => {
    const small = budgetFor(descriptor(16_000));
    const large = budgetFor(descriptor(131_072));
    expect(large.inputTokens).toBeGreaterThan(90_000);
    expect(large.totalCharacters).toBeGreaterThan(small.totalCharacters * 5);
  });

  it("assumes a conservative window when the model reports none", () => {
    expect(limitsFor(descriptor()).inputTokens).toBe(
      limitsFor(descriptor(DEFAULT_CONTEXT_TOKENS)).inputTokens,
    );
  });

  it("caps the generation reserve so a huge window does not spend it all", () => {
    expect(limitsFor(descriptor(131_072)).outputTokens).toBe(8_192);
    expect(limitsFor(descriptor(16_384)).outputTokens).toBeLessThan(8_192);
  });

  it("holds back thinking room for a model that must reason, whatever it is asked", () => {
    // Claude Sonnet 5.5 is sent its least, "low", where the app asks for
    // the Standard end (`samplingFields`), and most structured steps size
    // their output without naming an effort at all: the room has to come
    // from the model.
    const sonnet = scaled(["low", "medium", "high", "xhigh", "max"]);
    const plain = limitsFor(descriptor(32_000));
    expect(limitsFor(sonnet).outputTokens).toBe(
      plain.outputTokens + THINKING_STEP_TOKENS,
    );
    expect(limitsFor(sonnet, 2_000, "low").outputTokens).toBe(
      2_000 + THINKING_STEP_TOKENS,
    );
    // An effort it is asked for keeps its own room, by its step on the scale.
    expect(limitsFor(sonnet, 2_000, "high").outputTokens).toBe(
      2_000 + 3 * THINKING_STEP_TOKENS,
    );
    // GPT-5.5 Pro's least is medium, and still one step of thinking.
    expect(limitsFor(scaled(["medium", "high"]), 2_000).outputTokens).toBe(
      2_000 + THINKING_STEP_TOKENS,
    );
    // A model that can stop, asked to, holds no room at all.
    expect(limitsFor(scaled(["none", "low"]), 2_000).outputTokens).toBe(2_000);
  });

  it("holds back room for a model's thinking when it is asked to think", () => {
    // Thinking tokens are generated tokens: without this, "medium" on a small
    // window spends the answer's reserve and stops at `length`. The room is
    // one step per level up the model's own scale: on one that
    // can stop, "low" takes one step and "medium" two.
    const luna = scaled(["none", "low", "medium", "high"]);
    const plain = limitsFor(descriptor(32_000));
    const none = limitsFor(luna, undefined, "none");
    const low = limitsFor(luna, undefined, "low");
    const medium = limitsFor(luna, undefined, "medium");
    expect(none).toEqual(plain);
    expect(low.outputTokens).toBe(plain.outputTokens + THINKING_STEP_TOKENS);
    expect(medium.outputTokens).toBe(
      plain.outputTokens + 2 * THINKING_STEP_TOKENS,
    );
    // Out of the input side, so the size guard refuses honestly.
    expect(medium.inputTokens).toBe(
      plain.inputTokens - 2 * THINKING_STEP_TOKENS,
    );
    expect(budgetFor(luna, "medium").outputTokens).toBe(medium.outputTokens);
    // A caller's own reserve gets the thinking room on top.
    expect(limitsFor(luna, 2_000, "low").outputTokens).toBe(
      2_000 + THINKING_STEP_TOKENS,
    );
    // A level the model does not name is no room: nothing guessed.
    expect(limitsFor(luna, 2_000, "ultra").outputTokens).toBe(2_000);
    // Never past what the model says it can generate.
    expect(
      limitsFor(
        {
          ...scaled(["none", "low", "medium"], 200_000),
          maxOutputTokens: 4_000,
        },
        undefined,
        "medium",
      ).outputTokens,
    ).toBe(4_000);
  });

  it("lets a caller name its own output reserve", () => {
    expect(limitsFor(descriptor(32_000), 2_000).outputTokens).toBe(2_000);
  });

  it("refuses a model whose window cannot hold instructions and evidence", () => {
    expect(() => limitsFor(descriptor(2_000))).toThrow(/too small/);
  });

  it("reserves what the instructions measure, and refuses an 8k window", () => {
    // A chat's instructions measure 9,000 to 14,000 characters, and the
    // reserve covers them so a small window never plans material it cannot
    // hold. With that reserve an 8k window has too little left to be
    // useful, so it is refused up front, not mid-run.
    expect(INSTRUCTION_RESERVE).toBeGreaterThanOrEqual(14_000);
    expect(() => limitsFor(descriptor(8_192))).toThrow(/too small/);
    expect(limitsFor(descriptor(16_384)).inputTokens).toBeGreaterThan(0);
    // A model that reports no window is assumed to hold 16k, not refused.
    expect(DEFAULT_CONTEXT_TOKENS).toBe(16_384);
  });

  // Runaway-loop guards, not context-size questions, so they do not move
  // with the window.
  it("keeps the loop guards flat across every window", () => {
    const small = budgetFor(descriptor(16_000));
    const large = budgetFor(descriptor(131_072));
    expect(large.steps).toBe(small.steps);
    expect(large.toolCallsPerStep).toBe(small.toolCallsPerStep);
    expect(large.toolCallsPerRun).toBe(small.toolCallsPerRun);
  });

  it("holds one read call to a window a second call can continue", () => {
    expect(budgetFor(descriptor(131_072)).readWindow).toBe(40_000);
  });

  it("bounds history against the derived budget", () => {
    const budget = budgetFor(descriptor(16_000));
    expect(historyOverBudget(1_000, budget)).toBe(false);
    expect(historyOverBudget(budget.historyCharacters + 1, budget)).toBe(true);
  });

  it("gives a review's references a quarter of the input, and a ceiling", () => {
    // They ride every turn of a review chat, so they may not crowd out the
    // conversation on a small window, nor fill a large one unasked.
    const small = budgetFor(descriptor(16_384));
    expect(small.referenceCharacters).toBe(
      Math.floor(small.totalCharacters * 0.25),
    );
    expect(budgetFor(descriptor(1_000_000)).referenceCharacters).toBe(40_000);
  });
});

describe("/verify's judge reading", () => {
  it("fits between one result a search and every result of every search", () => {
    // The lower bound keeps the fit's "never below one a row" satisfiable
    // under the limit; the upper one keeps the limit a limit.
    expect(WEB_SEARCHES_PER_RUN).toBeLessThanOrEqual(VERIFY_JUDGE_RESULTS);
    expect(VERIFY_JUDGE_RESULTS).toBeLessThanOrEqual(
      WEB_RESULTS_MAX * WEB_SEARCHES_PER_RUN,
    );
  });
});
