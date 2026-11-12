// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isFreeModel } from "./types";
import type { ModelDescriptor } from "./types";

function model(pricing?: ModelDescriptor["pricing"]): ModelDescriptor {
  return {
    id: "a/model",
    providerId: "a-provider",
    label: "A Model",
    kind: "remote",
    capabilities: { tools: true, structuredOutput: true },
    pricing,
  };
}

describe("isFreeModel", () => {
  it("is free only when both axes are zero", () => {
    expect(
      isFreeModel(
        model({ promptUsdPerMillion: 0, completionUsdPerMillion: 0 }),
      ),
    ).toBe(true);
  });

  it("is not free when the answer costs money even though the prompt does not", () => {
    // A writer asking for prose is buying mostly output, so this is the
    // direction that would cost them the most to get wrong.
    expect(
      isFreeModel(
        model({ promptUsdPerMillion: 0, completionUsdPerMillion: 0.5 }),
      ),
    ).toBe(false);
  });

  it("is not free when the prompt costs money", () => {
    expect(
      isFreeModel(
        model({ promptUsdPerMillion: 0.1, completionUsdPerMillion: 0 }),
      ),
    ).toBe(false);
  });

  it("treats an unstated price as unknown rather than as free", () => {
    // "No price" is not "no charge": a badge saying Free on a model nobody
    // priced is a claim the app cannot support.
    expect(isFreeModel(model(undefined))).toBe(false);
  });

  it("does not read the id, whatever it is called", () => {
    // OpenRouter's `:free` suffix is sound in one direction only: a suffixed
    // model is free, but a free model may lack the suffix. And it is a string
    // the vendor owns.
    const suffixed = {
      ...model({ promptUsdPerMillion: 0.1, completionUsdPerMillion: 0.5 }),
      id: "a/model:free",
    };
    expect(isFreeModel(suffixed)).toBe(false);

    const unsuffixed = {
      ...model({ promptUsdPerMillion: 0, completionUsdPerMillion: 0 }),
      id: "openrouter/free-in-name-only",
    };
    expect(isFreeModel(unsuffixed)).toBe(true);
  });
});
