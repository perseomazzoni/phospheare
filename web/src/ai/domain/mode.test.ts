// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODE,
  STANDARD,
  chatMode,
  effortFor,
  modePosition,
  samplingFields,
  samplingFor,
  thinkingSteps,
} from "./mode";
import type { ModelCapabilities } from "./types";

// Scales as OpenRouter lists them, least first.
const LUNA = ["none", "low", "medium", "high", "xhigh", "max"];
const SONNET = ["low", "medium", "high", "xhigh", "max"];
const GEMINI = ["low", "medium", "high"];
const PRO = ["medium", "high", "xhigh"];

const model = (
  efforts?: string[],
  defaultEffort?: string,
  more: Partial<ModelCapabilities> = {},
) => ({
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: true,
    ...(efforts ? { efforts } : {}),
    ...(defaultEffort ? { defaultEffort } : {}),
    ...more,
  },
});

describe("a chat's mode", () => {
  it("starts in the middle until the chat moves it", () => {
    expect(chatMode({})).toBe(DEFAULT_MODE);
    expect(DEFAULT_MODE).toBe(0.5);
    expect(chatMode({ mode: 0 })).toBe(0);
    expect(chatMode({ mode: 1 })).toBe(1);
  });

  it("never lets a hand-edited chat file reach a provider", () => {
    // Out of range, or not a number at all, is the default — never a clamp,
    // which would be a setting nobody chose.
    for (const mode of [-0.1, 1.1, 40, Number.NaN, Infinity])
      expect(chatMode({ mode })).toBe(DEFAULT_MODE);
    expect(chatMode({ mode: "0.2" as unknown as number })).toBe(DEFAULT_MODE);
  });

  it("asks for the two set temperatures and the two ends of a scale", () => {
    expect(samplingFor(0)).toEqual({ temperature: 0.9, thinking: 1 });
    expect(samplingFor(1)).toEqual({ temperature: 0.3, thinking: 0 });
    expect(STANDARD).toEqual({ temperature: 0.3, thinking: 0 });
  });

  it("moves both while the bar is dragged between them", () => {
    expect(samplingFor(0.5)).toEqual({ temperature: 0.6, thinking: 0.5 });
    expect(samplingFor(0.25)).toEqual({ temperature: 0.75, thinking: 0.75 });
    expect(samplingFor(0.7)).toEqual({ temperature: 0.48, thinking: 0.3 });
    // Monotone: dragging right never warms the wording nor deepens the
    // thinking.
    let previous = { temperature: Infinity, thinking: Infinity };
    for (let step = 0; step <= 20; step += 1) {
      const next = samplingFor(step / 20);
      expect(next.temperature).toBeLessThanOrEqual(previous.temperature);
      expect(next.thinking).toBeLessThanOrEqual(previous.thinking);
      expect(next.temperature).toBeGreaterThanOrEqual(0.3);
      expect(next.temperature).toBeLessThanOrEqual(0.9);
      previous = next;
    }
  });

  it("is total: a bad position asks for the middle, not for a raw value", () => {
    expect(samplingFor(Number.NaN)).toEqual(samplingFor(DEFAULT_MODE));
    expect(samplingFor(7)).toEqual(samplingFor(DEFAULT_MODE));
  });

  it("reads effort on the model's own scale: least, its default, most", () => {
    // Nothing is assumed of a model: Standard is the least it takes, the
    // middle its own default, Creative its most.
    expect(effortFor(0, model(LUNA, "medium"))).toBe("none");
    expect(effortFor(0.5, model(LUNA, "medium"))).toBe("medium");
    expect(effortFor(1, model(LUNA, "medium"))).toBe("max");
    // Claude Sonnet 5.5 cannot stop: its least is low, which it accepts.
    expect(effortFor(0, model(SONNET, "high"))).toBe("low");
    expect(effortFor(0.5, model(SONNET, "high"))).toBe("high");
    expect(effortFor(0.25, model(SONNET, "high"))).toBe("medium");
    expect(effortFor(1, model(SONNET, "high"))).toBe("max");
    expect(effortFor(0, model(GEMINI, "medium"))).toBe("low");
    expect(effortFor(1, model(GEMINI, "medium"))).toBe("high");
    // GPT-5.5 Pro starts at medium, so medium is the least it is asked.
    expect(effortFor(0, model(PRO, "medium"))).toBe("medium");
    // No default named: the middle of the scale.
    expect(effortFor(0.5, model(["none", "low", "medium", "high"]))).toBe(
      "low",
    );
    // No scale named: nothing is assumed, and nothing is sent.
    expect(effortFor(0, model())).toBeUndefined();
    expect(effortFor(1, model([]))).toBeUndefined();
    // Every position yields a word on the scale, and never a step down as the
    // thinking deepens.
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const at = SONNET.indexOf(
        effortFor(step / 20, model(SONNET, "high")) ?? "",
      );
      expect(at).toBeGreaterThanOrEqual(previous);
      previous = at;
    }
  });

  it("never asks a model that must reason to stop", () => {
    // Claude Sonnet 5.5 and Gemini 3.8 Flash answer `none` with a 400,
    // "Reasoning is mandatory for this endpoint and cannot be disabled",
    // which would fail every structured step.
    expect(samplingFields(STANDARD, model(SONNET, "high"))).toEqual({
      temperature: 0.3,
      effort: "low",
    });
    expect(samplingFields(STANDARD, model(GEMINI, "medium")).effort).toBe(
      "low",
    );
    expect(samplingFields(STANDARD, model(LUNA, "medium")).effort).toBe("none");
  });

  it("counts thinking steps up the model's own scale", () => {
    expect(thinkingSteps("none", model(LUNA))).toBe(0);
    expect(thinkingSteps("low", model(LUNA))).toBe(1);
    expect(thinkingSteps("medium", model(LUNA))).toBe(2);
    // A model that cannot stop thinks at its least: one step up already.
    expect(thinkingSteps("low", model(SONNET))).toBe(1);
    expect(thinkingSteps("max", model(SONNET))).toBe(5);
    expect(thinkingSteps("medium", model(PRO))).toBe(1);
    expect(thinkingSteps(undefined, model(LUNA))).toBe(0);
    expect(thinkingSteps("ultra", model(LUNA))).toBe(0);
  });

  it("sends effort only to a model that can reason and names a scale", () => {
    expect(
      samplingFields(STANDARD, {
        capabilities: { tools: true, structuredOutput: true, efforts: LUNA },
      }),
    ).toEqual({ temperature: 0.3 });
    expect(samplingFields(samplingFor(0), model(LUNA, "medium"))).toEqual({
      temperature: 0.9,
      effort: "max",
    });
    expect(samplingFields(samplingFor(0), model())).toEqual({
      temperature: 0.9,
    });
  });

  it("sends no temperature to a model that takes none", () => {
    // OpenAI's reasoning models list `reasoning` and not `temperature`, and a
    // request carrying one is theirs to refuse. The Mode is its effort alone.
    expect(
      samplingFields(
        STANDARD,
        model(LUNA, "medium", { fixedTemperature: true }),
      ),
    ).toEqual({ effort: "none" });
  });

  it("stores a position on the track's own stops", () => {
    expect(modePosition(0.35000000000000003)).toBe(0.35);
    expect(modePosition(0.333)).toBe(0.35);
    expect(modePosition(-2)).toBe(0);
    expect(modePosition(3)).toBe(1);
  });
});
