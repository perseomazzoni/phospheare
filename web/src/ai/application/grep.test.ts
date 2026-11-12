// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { SourceDescriptor, SourceText } from "../domain/types";
import type { ProjectSources } from "../ports";
import { budgetFor } from "./budgets";
import { GREP_LIMIT_MAX, grepIn, grepScope, type GrepResult } from "./grep";
import {
  executeTool,
  manuscriptTextsOf,
  receiptOf,
  type ToolContext,
} from "./tools";

const source = (
  id: string,
  kind: SourceDescriptor["kind"],
  title: string,
  order?: number,
): SourceDescriptor => ({
  id,
  kind,
  title,
  path: id,
  authority: kind === "manuscript" ? "manuscript" : "reference",
  ...(order === undefined ? {} : { order }),
});

const CATALOG = [
  source("reference:sheet", "reference", "Mara Wren"),
  source("node:B", "manuscript", "The storm", 1),
  source("node:A", "manuscript", "The gate", 0),
  source("reference:summary--A", "summary", "Summary of the gate"),
];

const TEXTS: Record<string, string> = {
  "reference:sheet": "- Names: Mara\n- Eyes: grey",
  "node:A": "Mara opened the gate. Màra laughed; «MARA!» they called.",
  "node:B": "The storm came. Maragold was a word nobody knew. Mara slept.",
  "reference:summary--A": "Mara opens the gate.",
};

const capture = (id: string): SourceText => ({
  text: TEXTS[id] ?? "",
  revision: `r-${id}`,
  origin: "project-file",
});

describe("grep", () => {
  it("reads the allowed sources in reading order, manuscript first, summaries only by id", () => {
    const all = new Set(CATALOG.map((one) => one.id));
    expect(grepScope(CATALOG, all).map((one) => one.id)).toEqual([
      "node:A",
      "node:B",
      "reference:sheet",
    ]);
    expect(
      grepScope(CATALOG, all, ["reference:summary--A"]).map((one) => one.id),
    ).toEqual(["reference:summary--A"]);
    // An id outside the allowed set is not read, asked for or not.
    expect(grepScope(CATALOG, new Set(["node:A"]), ["node:B"])).toEqual([]);
  });

  it("finds every match, folded, whole words when asked, with offsets into the text", () => {
    const texts = grepScope(CATALOG, new Set(CATALOG.map((one) => one.id))).map(
      (one) => ({ source: one, capture: capture(one.id) }),
    );
    const words = grepIn(texts, { terms: ["mara"], wholeWord: true });
    expect(words.total).toBe(5);
    expect(words.perSource).toEqual({
      "node:A": 3,
      "node:B": 1,
      "reference:sheet": 1,
    });
    for (const match of words.matches)
      expect(
        TEXTS[match.sourceId].slice(match.start, match.end).toLowerCase(),
      ).toMatch(/^m[aà]ra$/u);
    // Without `wholeWord`, "Maragold" is a match too.
    expect(grepIn(texts, { terms: ["mara"] }).total).toBe(6);
    // A title holding the term is named, for a Section asked for by name.
    expect(grepIn(texts, { terms: ["storm"] }).titles).toEqual([
      { sourceId: "node:B", title: "The storm" },
    ]);
  });

  it("bounds what it returns and says so", () => {
    const long = { ...source("node:L", "manuscript", "Long", 0) };
    const text = Array.from({ length: 100 }, (_, at) => `Leo ${at}.`).join(" ");
    const texts = [{ source: long, capture: { ...capture("x"), text } }];
    const capped = grepIn(texts, { terms: ["leo"], limit: 5, context: 0 });
    expect(capped.matches).toHaveLength(5);
    expect(capped).toMatchObject({ total: 100, truncated: true });
    expect(capped.matches[0].excerpt).toBe("Leo…");
    expect(grepIn(texts, { terms: ["leo"], limit: 999 }).matches).toHaveLength(
      GREP_LIMIT_MAX,
    );
  });
});

describe("the grep tool", () => {
  class CountingSources implements ProjectSources {
    reads: string[] = [];
    async list() {
      return CATALOG;
    }
    async read(id: string) {
      this.reads.push(id);
      if (id === "node:B") throw new Error("unreadable");
      return capture(id);
    }
    async allowedReaderSources() {
      return new Set<string>();
    }
  }

  const contextOf = (sources: ProjectSources): ToolContext => ({
    sources,
    catalog: CATALOG,
    allowed: new Set(CATALOG.map((one) => one.id)),
    used: [],
    budget: budgetFor({
      id: "test",
      providerId: "ollama",
      label: "test",
      kind: "device" as const,
      capabilities: { tools: true, structuredOutput: true },
      contextTokens: 131_072,
    }),
  });

  it("reads each source once per run, leaves an unreadable one out, and refuses blank terms", async () => {
    const sources = new CountingSources();
    const context = contextOf(sources);
    const call = (args: unknown) => ({
      id: "g",
      name: "grep",
      arguments: args,
    });
    const found = (await executeTool(
      call({ terms: ["gate"] }),
      context,
    )) as GrepResult;
    expect(found.perSource).toEqual({ "node:A": 1 });
    // The read around the hit is served from the same capture.
    await executeTool(
      { id: "r", name: "read_source", arguments: { sourceId: "node:A" } },
      context,
    );
    await executeTool(call({ terms: ["storm"] }), context);
    expect(sources.reads.filter((id) => id === "node:A")).toHaveLength(1);
    // A failed read is tried again, not remembered.
    expect(sources.reads.filter((id) => id === "node:B")).toHaveLength(2);
    expect(await executeTool(call({ terms: [" "] }), context)).toEqual({
      error: "invalid-arguments",
    });
    // A grep's excerpts are the writer's words the model was shown, and its
    // receipt names every source they came from, for the reader check.
    expect(manuscriptTextsOf(call({}), found)).toEqual(
      found.matches.map((match) => match.excerpt),
    );
    expect(receiptOf(call({ terms: ["gate"] }), found).sourceIds).toEqual([
      "node:A",
    ]);
  });
});
