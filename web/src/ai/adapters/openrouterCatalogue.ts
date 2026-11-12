// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type {
  ModelCapabilities,
  ModelDescriptor,
  ModelPricing,
  ProviderKind,
} from "../domain/types";
import {
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  REASONING_EFFORTS,
  forwardsModel,
} from "./openrouterRequest";

// The vendor's `GET /api/v1/models` rows, projected onto the app's few
// fields, key by key: a field not named here cannot reach a descriptor.
//
// There is no curated set. The only filters are the ones the chat applies to
// a model id, so a model offered here is always one a request can name,
// and a text output, since a model that cannot answer in text
// cannot answer here. `tools` is a capability, never a filter: whether a run
// needs tools is the application's question.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A per-token price as a number, or `null`. The vendor quotes decimal
 * strings such as `"0.0000001"`; a value that is not numeric is no price
 * stated, never free, the direction in which being wrong costs money.
 */
function price(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(value)
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Per million tokens, both halves or nothing: a half-stated price would
 * render as a confident number that is half the cost of a turn, and
 * `isFreeModel` reads a stated zero as free.
 */
function pricing(value: unknown): ModelPricing | undefined {
  if (!isObject(value)) return undefined;
  const prompt = price(value.prompt);
  const completion = price(value.completion);
  if (prompt === null || completion === null) return undefined;
  const promptUsdPerMillion = prompt * 1_000_000;
  const completionUsdPerMillion = completion * 1_000_000;
  if (
    !Number.isFinite(promptUsdPerMillion) ||
    !Number.isFinite(completionUsdPerMillion)
  )
    return undefined;
  return { promptUsdPerMillion, completionUsdPerMillion };
}

/**
 * The model's own efforts, least first, in the words a request accepts.
 * The vendor lists them most first. Absent when it names none:
 * a model with no scale is sent no effort.
 */
function efforts(
  reasoning: unknown,
): Pick<ModelCapabilities, "efforts" | "defaultEffort"> {
  if (!isObject(reasoning) || !Array.isArray(reasoning.supported_efforts))
    return {};
  const listed = [...(reasoning.supported_efforts as unknown[])]
    .reverse()
    .filter((one): one is string =>
      (REASONING_EFFORTS as readonly unknown[]).includes(one),
    );
  if (listed.length === 0) return {};
  const named = reasoning.default_effort;
  return {
    efforts: listed,
    ...(typeof named === "string" && listed.includes(named)
      ? { defaultEffort: named }
      : {}),
  };
}

/** The vendor's catalogue as descriptors, in the vendor's order. */
export function projectCatalogue(
  body: unknown,
  providerId: string,
  kind: ProviderKind,
): ModelDescriptor[] {
  const rows = isObject(body) ? body.data : undefined;
  if (!Array.isArray(rows)) return [];
  const models: ModelDescriptor[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!isObject(row) || typeof row.id !== "string" || row.id === "") continue;
    const id = row.id;
    if (!MODEL_ID.test(id) || !forwardsModel(id) || seen.has(id)) continue;

    const architecture = isObject(row.architecture) ? row.architecture : {};
    const outputs = Array.isArray(architecture.output_modalities)
      ? (architecture.output_modalities as unknown[])
      : ["text"];
    if (!outputs.includes("text")) continue;

    const supported = Array.isArray(row.supported_parameters)
      ? (row.supported_parameters as unknown[])
      : [];
    const top = isObject(row.top_provider) ? row.top_provider : {};
    const ceiling = top.max_completion_tokens;

    seen.add(id);
    models.push({
      id,
      providerId,
      label: typeof row.name === "string" && row.name !== "" ? row.name : id,
      kind,
      capabilities: {
        tools: supported.includes("tools"),
        structuredOutput: supported.includes("structured_outputs"),
        reasoning: supported.includes("reasoning"),
        // A model that takes no temperature, stated as the exception: the
        // vendor refuses a request carrying one, and capabilities are falsy
        // by absence.
        ...(!supported.includes("temperature")
          ? { fixedTemperature: true }
          : {}),
        ...efforts(row.reasoning),
      },
      // Absent rather than guessed: a number nobody stated is one the
      // budget must not pack a request against.
      contextTokens: Number.isInteger(row.context_length)
        ? (row.context_length as number)
        : undefined,
      // No model claims a longer answer than a request may ask for, so the
      // budget never builds one the gate refuses.
      maxOutputTokens: Number.isInteger(ceiling)
        ? Math.min(ceiling as number, MAX_OUTPUT_TOKENS)
        : undefined,
      pricing: pricing(row.pricing),
    });
  }
  return models;
}
