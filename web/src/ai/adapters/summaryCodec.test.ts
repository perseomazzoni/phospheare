// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  parseSummary,
  serializeSummary,
  summaryBody,
  summaryState,
} from "./summaryCodec";
import { hashOf } from "../../text/hash";
import type { SummaryMetadata } from "../domain/types";

const body = "A storm arrives.";
const metadata: SummaryMetadata = {
  schemaVersion: 1,
  nodeId: "EL3",
  scope: "node",
  sources: [{ nodeId: "EL3", contentHash: "abc123" }],
  model: { providerId: "ollama", modelId: "qwen3:8b" },
  recipe: "node-summary",
  recipeRevision: "1",
  language: "en",
  generatedAt: "2026-09-16T12:00:00.000Z",
  bodyHash: "",
};

async function fixture(): Promise<SummaryMetadata> {
  return { ...metadata, bodyHash: await hashOf(body) };
}

describe("summary codec", () => {
  it("reads what a summary says, with any metadata block off", () => {
    expect(summaryBody(serializeSummary(metadata, "The body."))).toBe(
      "The body.",
    );
    // A block edited past parsing is still bookkeeping, never the story.
    expect(summaryBody("---\nschemaVersion: nine\n---\nWhat happens.")).toBe(
      "What happens.",
    );
    // A file with no block is all body.
    expect(summaryBody("Only words.")).toBe("Only words.");
  });

  it("round-trips AI-owned metadata and body", async () => {
    const stored = await fixture();
    expect(parseSummary(serializeSummary(stored, body))).toEqual({
      metadata: stored,
      body,
    });
  });

  it("derives freshness from source hashes and the body hash, with no model call", async () => {
    const raw = serializeSummary(await fixture(), body);
    expect(await summaryState(raw, new Map([["EL3", "abc123"]]))).toBe(
      "current",
    );
    expect(await summaryState(raw, new Map([["EL3", "changed"]]))).toBe(
      "outdated",
    );
    // A body edited outside the app fails its own hash before anything else.
    const edited = serializeSummary(await fixture(), `${body} Edited.`);
    expect(await summaryState(edited, new Map([["EL3", "abc123"]]))).toBe(
      "unverified",
    );
    expect(await summaryState("ordinary prose", new Map())).toBe("unverified");
    expect(
      await summaryState(
        raw,
        new Map([
          ["EL3", "abc123"],
          ["EL4", "x"],
        ]),
      ),
    ).toBe("current");
  });

  it("rejects malformed, old-shape, or incomplete generated metadata", async () => {
    expect(parseSummary("---\nschemaVersion: 2\n---\nBody")).toBeNull();
    expect(parseSummary("---\n[invalid\n---\nBody")).toBeNull();
    // A summary without `bodyHash` is unreadable rather than trusted.
    expect(
      parseSummary(
        "---\nschemaVersion: 1\nnodeId: EL3\nsourceRevision: abc123\n---\nBody",
      ),
    ).toBeNull();
    expect(
      parseSummary(
        serializeSummary({ ...metadata, bodyHash: "" }, body).replace(
          /bodyHash: ""/,
          "bodyHash: 7",
        ),
      ),
    ).toBeNull();
  });
});
