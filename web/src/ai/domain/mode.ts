// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ChatPreferences,
  ModelDescriptor,
  ModelRequest,
  ReasoningEffort,
} from "./types";

// A chat's mode: one dragbar with Creative writing and brainstorming on the
// left and Standard and routine tasks on the right. The position sets two
// things at once, because they are two halves of one question: how
// adventurous the wording is (temperature) and how hard the model works on
// the logic (reasoning effort).
//
//   position 0     Creative   temperature 0.9   the model's highest effort
//   position 0.5   middle     temperature 0.6   the model's own default
//   position 1     Standard   temperature 0.3   the model's least effort
//
// Temperature is interpolated linearly between the two ends. Effort is read
// on the model's own scale: each model says which efforts it takes, least
// first, and which it uses by default, and the track spans that scale. The
// Standard end is its least (`none` where it can stop, `low` where it cannot,
// `medium` where that is its floor), the middle its default, the Creative end
// its most. No level is assumed of any model, and one that names no scale is
// sent no effort, because asking a model that cannot stop thinking to stop
// fails every request.
//
// The position is stored, not the values it produces: the position is what
// the writer chose, a pair stored separately could be hand-edited into a
// combination no position gives, and the effort it means depends on the
// model the chat answers with.

/** The track's resolution: 21 stops, which is what the dragbar steps by. */
export const MODE_STEP = 0.05;

/** Where a new chat starts: the middle. A double-click on the track returns to it. */
export const DEFAULT_MODE = 0.5;

const CREATIVE_TEMPERATURE = 0.9;
const ROUTINE_TEMPERATURE = 0.3;

/**
 * What a position asks for, before any model is known: a temperature, and
 * how far up its model's effort scale to think: 0 the least it takes, 0.5
 * its own default, 1 its most. `effortFor` turns that into the model's own
 * effort.
 */
export interface Sampling {
  temperature: number;
  thinking: number;
}

/**
 * The mode a chat is in.
 *
 * The chat file lives in the writer's own folder and is replayed without a
 * schema below its top level, so this is the one road from a stored position
 * to a request. A string, a NaN or a 40 reads as the default, never a clamp,
 * because a clamped hand-edit is a setting nobody chose.
 */
export function chatMode(preferences: Pick<ChatPreferences, "mode">): number {
  const value = preferences.mode;
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : DEFAULT_MODE;
}

/**
 * A position as it is stored: snapped to the track's stops, so the chat file
 * holds `0.35` and never `0.35000000000000003`.
 */
export function modePosition(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(Math.round(clamped / MODE_STEP) * MODE_STEP * 100) / 100;
}

/**
 * What a position asks a model for. Total over 0..1: every position yields
 * a temperature inside 0.3..0.9 and a place on the model's own scale, so
 * nothing read from a file ever reaches a provider as a raw value.
 */
export function samplingFor(mode: number): Sampling {
  const position = chatMode({ mode });
  const temperature =
    Math.round(
      (CREATIVE_TEMPERATURE +
        (ROUTINE_TEMPERATURE - CREATIVE_TEMPERATURE) * position) *
        100,
    ) / 100;
  return { temperature, thinking: Math.round((1 - position) * 100) / 100 };
}

/**
 * The right end, whatever any chat says: what every piece of the assistant's
 * housekeeping asks with, from section and part summaries to compaction and
 * the editorial review's passes. Each is extraction, and a "creative" one is
 * a worse summary, not a livelier one. On each model it is the least effort
 * it takes. Only a chat's own answers take the chat's Mode.
 */
export const STANDARD: Sampling = samplingFor(1);

/**
 * The effort a place on the track means for one model: its least at 0, its
 * own default at 0.5, its most at 1, the steps between spread evenly on each
 * side of the default. `undefined` for a model that names no scale: it is
 * sent none, and keeps its own default.
 */
export function effortFor(
  thinking: number,
  descriptor: Pick<ModelDescriptor, "capabilities">,
): ReasoningEffort | undefined {
  const scale = descriptor.capabilities.efforts ?? [];
  if (scale.length === 0) return undefined;
  const top = scale.length - 1;
  const named = scale.indexOf(descriptor.capabilities.defaultEffort ?? "");
  const middle = named >= 0 ? named : Math.floor(top / 2);
  const at = Math.min(1, Math.max(0, thinking));
  const step =
    at <= 0.5
      ? Math.round(at * 2 * middle)
      : middle + Math.round((at - 0.5) * 2 * (top - middle));
  return scale[step];
}

/**
 * How far up its own scale an effort is: 0 for `none` or no effort, and one
 * step for each level above. A model that cannot stop counts as already one
 * step up, because its least effort still thinks.
 */
export function thinkingSteps(
  effort: ReasoningEffort | undefined,
  descriptor: Pick<ModelDescriptor, "capabilities">,
): number {
  const scale = descriptor.capabilities.efforts ?? [];
  const at = effort === undefined ? -1 : scale.indexOf(effort);
  if (at < 0) return 0;
  return scale[0] === "none" ? at : at + 1;
}

/**
 * What a request carries for a sampling, for the model that will answer.
 *
 * Each half is sent only where the model takes it: Ollama answers 400 to
 * `think` on a model that cannot reason, and OpenAI's reasoning models refuse
 * a temperature outright. Both gates live here so no workflow can send
 * either without its check. On a model that takes no
 * temperature the Mode is its effort alone; on one that names no effort
 * scale, its temperature alone.
 */
export function samplingFields(
  sampling: Sampling,
  descriptor: Pick<ModelDescriptor, "capabilities">,
): Pick<ModelRequest, "temperature" | "effort"> {
  const { reasoning, fixedTemperature } = descriptor.capabilities;
  const effort = reasoning
    ? effortFor(sampling.thinking, descriptor)
    : undefined;
  return {
    ...(fixedTemperature ? {} : { temperature: sampling.temperature }),
    ...(effort !== undefined ? { effort } : {}),
  };
}
