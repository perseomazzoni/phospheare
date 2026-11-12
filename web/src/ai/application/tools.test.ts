// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { SourceDescriptor, ToolCall } from "../domain/types";
import type { ProjectSources } from "../ports";
import { budgetFor } from "./budgets";
import {
  callSignature,
  executeTool,
  manuscriptTextsOf,
  receiptOf,
  searchCandidates,
  toFindings,
  toolsFor,
  webQueryOf,
  WEB_SEARCH_TOOL,
  type ToolContext,
} from "./tools";
import { WEB_SEARCH_REFUSALS } from "./webResults";
import { autonomousSkills } from "../domain/skills";
import type { CommentProposal, ProposalOutcome } from "../domain/comments";

// The budget is derived from the model that will answer, so a spec that wants
// a tight one names a small window rather than picking a preset off a table.
const budgetOf = (contextTokens: number) =>
  budgetFor({
    id: "test",
    providerId: "ollama",
    label: "test",
    kind: "device" as const,
    capabilities: { tools: true, structuredOutput: true },
    contextTokens,
  });

const SOURCES: SourceDescriptor[] = [
  {
    id: "node:S1",
    kind: "manuscript",
    title: "Opening",
    path: "document/s1.md",
    nodeId: "S1",
    nodeKind: "section",
    order: 0,
    authority: "manuscript",
  },
  {
    id: "reference:world.md",
    kind: "reference",
    title: "World",
    path: "reference/world.md",
    authority: "reference",
  },
];

const TEXT = "The gate stands at the edge of the world, and the gate is blue.";

// The way out a bad range is handed with its diagnosis: a range is explained,
// never reinterpreted.
const RANGE_HINT =
  "Omit start and end to read from the beginning. For a range, pass both, with end greater than start.";

class FakeSources implements ProjectSources {
  async list() {
    return SOURCES;
  }
  async read(sourceId: string, range?: { start: number; end: number }) {
    if (sourceId === "node:missing") throw new Error("source-not-found");
    return {
      text: range ? TEXT.slice(range.start, range.end) : TEXT,
      revision: "r1",
      origin: "project-file" as const,
    };
  }
  async allowedReaderSources() {
    return new Set(["node:S1"]);
  }
}

function context(over: Partial<ToolContext> = {}): ToolContext {
  return {
    sources: new FakeSources(),
    // Resolved once per run by the caller and handed down, so the tools never
    // list for themselves — the adapter's listing re-reads every summary.
    catalog: SOURCES,
    allowed: new Set(["node:S1", "reference:world.md"]),
    used: [],
    budget: budgetOf(131_072),
    ...over,
  };
}

const call = (name: string, args: unknown): ToolCall => ({
  id: "c1",
  name,
  arguments: args,
});

describe("tool dispatcher", () => {
  it("lists and greps only authorized sources", async () => {
    const ctx = context({ allowed: new Set(["node:S1"]) });
    const listed = (await executeTool(call("list_sources", {}), ctx)) as {
      sources: Array<{ sourceId: string }>;
    };
    expect(listed.sources.map((one) => one.sourceId)).toEqual(["node:S1"]);

    const found = (await executeTool(
      call("grep", { terms: ["gate"], limit: 5 }),
      ctx,
    )) as { matches: Array<{ sourceId: string }>; total: number };
    // Both of the Section's "gate"s, and nothing from the World document
    // the run may not read, though its text holds the word too.
    expect(found.total).toBe(2);
    expect(found.matches.map((one) => one.sourceId)).toEqual([
      "node:S1",
      "node:S1",
    ]);
  });

  it("rejects unknown tools, extra fields, bad types and malformed arguments", async () => {
    const ctx = context();
    expect(await executeTool(call("unknown", {}), ctx)).toEqual({
      error: "unknown-tool",
    });
    expect(await executeTool(call("list_sources", null), ctx)).toEqual({
      error: "invalid-arguments",
    });
    expect(
      await executeTool(call("grep", { terms: ["x"], extra: 1 }), ctx),
    ).toMatchObject({ error: "invalid-arguments" });
    expect(
      await executeTool(call("grep", { terms: ["x".repeat(121)] }), ctx),
    ).toMatchObject({ error: "invalid-arguments" });
    expect(
      await executeTool(call("read_source", { sourceId: 7 }), ctx),
    ).toMatchObject({ error: "invalid-arguments" });
  });

  // `key in properties` walks the prototype, so a check written with it lets
  // `constructor`, `toString` and `__proto__` past `additionalProperties:
  // false` as if the schema declared them.
  it("refuses a key the schema inherits rather than declares", async () => {
    const ctx = context();
    for (const key of ["constructor", "toString", "hasOwnProperty"])
      expect(
        await executeTool(call("grep", { terms: ["x"], [key]: 1 }), ctx),
      ).toMatchObject({ error: "invalid-arguments" });
    // A key named `__proto__` in a literal sets the prototype; one parsed off
    // the wire is an own key, which is what a model's arguments are.
    expect(
      await executeTool(
        call("grep", JSON.parse('{"terms":["x"],"__proto__":{}}')),
        ctx,
      ),
    ).toMatchObject({ error: "invalid-arguments" });
  });

  // A Section paged in several windows is recorded as the union it read, and
  // a one-character probe is not recorded as a source read.
  describe("what a run records as read", () => {
    const LONG = "a".repeat(1_000);
    class LongSources extends FakeSources {
      override async read() {
        return { text: LONG, revision: "r1", origin: "project-file" as const };
      }
    }
    const read = (ctx: ToolContext, start: number, end: number) =>
      executeTool(
        call("read_source", { sourceId: "node:S1", start, end }),
        ctx,
      );

    it("keeps the union of the windows read, and calls it whole once it is", async () => {
      const ctx = context({ sources: new LongSources() });
      await read(ctx, 0, 400);
      expect(ctx.used).toEqual([
        expect.objectContaining({ coverage: "excerpt", characters: 400 }),
      ]);
      // An overlap counts once.
      await read(ctx, 300, 600);
      expect(ctx.used[0]).toMatchObject({
        coverage: "excerpt",
        characters: 600,
      });
      await read(ctx, 600, 1_000);
      expect(ctx.used).toHaveLength(1);
      expect(ctx.used[0]).toMatchObject({
        coverage: "full-text",
        characters: 1_000,
      });
    });

    it("leaves no receipt for a probe, and never rewrites an attached source's", async () => {
      const ctx = context({ sources: new LongSources() });
      await read(ctx, 0, 1);
      expect(ctx.used).toEqual([]);
      const attached = context({
        sources: new LongSources(),
        used: [
          {
            ...SOURCES[0],
            reason: "default",
            coverage: "full-text",
            characters: 1_000,
          },
        ],
      });
      await read(attached, 0, 400);
      expect(attached.used).toHaveLength(1);
      expect(attached.used[0]).toMatchObject({
        reason: "default",
        coverage: "full-text",
      });
    });

    it("records a whole text read through a range as whole", async () => {
      const ctx = context();
      await executeTool(
        call("read_source", {
          sourceId: "node:S1",
          start: 0,
          end: TEXT.length,
        }),
        ctx,
      );
      expect(ctx.used[0]).toMatchObject({ coverage: "full-text" });
    });
  });

  it("reads bounded ranges with a next cursor and never clamps an invalid range", async () => {
    const ctx = context();
    const whole = (await executeTool(
      call("read_source", { sourceId: "node:S1" }),
      ctx,
    )) as { content: string; nextStart?: number; revision: string };
    expect(whole.content).toBe(TEXT);
    expect(whole.revision).toBe("r1");
    expect(whole.nextStart).toBeUndefined();
    expect(ctx.used[0]).toMatchObject({
      id: "node:S1",
      reason: "tool",
      coverage: "full-text",
    });

    const slice = (await executeTool(
      call("read_source", { sourceId: "node:S1", start: 4, end: 8 }),
      ctx,
    )) as { content: string; nextStart?: number };
    expect(slice.content).toBe("gate");
    expect(slice.nextStart).toBe(8);

    expect(
      await executeTool(
        call("read_source", { sourceId: "node:S1", start: 8 }),
        ctx,
      ),
    ).toEqual({ error: "invalid-range", hint: RANGE_HINT });
    expect(
      await executeTool(
        call("read_source", { sourceId: "node:S1", start: 8, end: 8 }),
        ctx,
      ),
    ).toEqual({ error: "invalid-range", hint: RANGE_HINT });
    expect(
      await executeTool(
        call("read_source", {
          sourceId: "node:S1",
          start: 0,
          end: 50_000,
        }),
        ctx,
      ),
    ).toEqual({
      error: "range-too-large",
      maxRange: ctx.budget.readWindow,
      hint: expect.stringContaining("at most maxRange characters"),
    });
    expect(
      await executeTool(call("read_source", { sourceId: "node:missing" }), {
        ...ctx,
        allowed: new Set([...ctx.allowed, "node:missing"]),
      }),
    ).toEqual({
      error: "source-not-found",
      hint: "Use a sourceId exactly as list_sources returns it, such as node:S1.",
      candidates: [],
    });
    // A source outside the allowed set answers as an id that names nothing,
    // never "not authorized", which a model reads as a wall.
    expect(
      await executeTool(
        call("read_source", { sourceId: "reference:world.md" }),
        { ...ctx, allowed: new Set() },
      ),
    ).toEqual({
      error: "source-not-found",
      hint: "Use a sourceId exactly as list_sources returns it, such as node:S1.",
      candidates: [],
    });
  });

  it("tells a read sent start 0, end 0 to leave the range out", async () => {
    // What a small model sends to mean "the whole part". It is refused,
    // because a range is never reinterpreted, but with the way out.
    expect(
      await executeTool(
        call("read_source", { sourceId: "node:S1", start: 0, end: 0 }),
        context(),
      ),
    ).toMatchObject({ error: "invalid-arguments", hint: RANGE_HINT });
    // Another tool's bad arguments get no read-range advice.
    expect(
      await executeTool(call("grep", { terms: 7 }), context()),
    ).not.toHaveProperty("hint");
  });

  it("points a mistyped id at what it meant, from the allowed set only", async () => {
    // A bare node id with a title beside it, as a small model sends it.
    const ctx = context();
    const answer = (await executeTool(
      call("read_source", { sourceId: "S1, nothing" }),
      ctx,
    )) as { error: string; candidates: string[] };
    expect(answer.error).toBe("source-not-found");
    expect(answer.candidates).toEqual(["node:S1"]);
    // Nothing outside the allowed set is ever suggested, so a past-horizon
    // source and a missing one answer identically.
    const walled = await executeTool(call("read_source", { sourceId: "S1" }), {
      ...ctx,
      allowed: new Set(),
    });
    const nowhere = await executeTool(
      call("read_source", { sourceId: "nothing-at-all" }),
      { ...ctx, allowed: new Set() },
    );
    expect(walled).toEqual(nowhere);
  });

  it("inspects the authorized structure in reading order", async () => {
    const result = (await executeTool(
      call("inspect_structure", {}),
      context(),
    )) as { nodes: Array<{ sourceId: string; nodeKind?: string }> };
    expect(result.nodes).toEqual([
      expect.objectContaining({ sourceId: "node:S1", nodeKind: "section" }),
    ]);
  });

  // The totals tell Parts from Sections and give the exact word count, so a
  // model neither counts every node as a Section nor guesses the words.
  it("counts the structure's Parts, Sections and words for the model", async () => {
    const book: SourceDescriptor[] = [
      {
        ...SOURCES[0],
        id: "node:P1",
        nodeId: "P1",
        nodeKind: "part",
        order: 0,
        words: 0,
      },
      { ...SOURCES[0], id: "node:S1", order: 1, words: 1_200 },
      { ...SOURCES[0], id: "node:S2", nodeId: "S2", order: 2, words: 800 },
    ];
    const allowed = new Set(book.map((one) => one.id));
    const counted = (await executeTool(
      call("inspect_structure", {}),
      context({ catalog: book, allowed }),
    )) as { totals: unknown };
    expect(counted.totals).toEqual({ parts: 1, sections: 2, words: 2_000 });
    // One node without a count: no total, rather than a wrong one.
    const partial = (await executeTool(
      call("inspect_structure", {}),
      context({
        catalog: book.map((one) =>
          one.id === "node:S2" ? { ...one, words: undefined } : one,
        ),
        allowed,
      }),
    )) as { totals: unknown };
    expect(partial.totals).toEqual({ parts: 1, sections: 2 });
  });

  it("states the run's read window in read_source, so no range is a guess", () => {
    const read = toolsFor({ findings: false, web: false }, 40_000).find(
      (tool) => tool.name === "read_source",
    );
    expect(read?.description).toContain("at most 40000 characters");
    expect(read?.description).toContain("Omit start and end to read it whole");
    expect(read?.description).toContain("in the same step");
  });

  it("asks for findings in the writer's language, never English because the instruction is", () => {
    // The app's instruction is in English, so without this request a typed
    // `/canon` on an Italian book returns its findings in English.
    const submit = toolsFor({ findings: true, web: false }, 40_000).find(
      (tool) => tool.name === "submit_findings",
    );
    expect(submit?.description).toContain("in the writer's language");
    expect(submit?.description).toContain("the project's language");
  });

  it("hands a manuscript read its pre-pass candidates, and a reference none", async () => {
    // A Section read through this tool gets the pre-pass too. The run
    // decides where it applies; the tool puts what it returns beside the
    // text, framed as candidates.
    const group = {
      obsession: "E.filter",
      notices: "filter verbs",
      found: 1,
      quotes: ["She saw it."],
    };
    const asked: string[] = [];
    const ctx = context({
      signals: (sourceId) => {
        asked.push(sourceId);
        return [group];
      },
    });
    const prose = (await executeTool(
      call("read_source", { sourceId: "node:S1" }),
      ctx,
    )) as { signals?: { note: string; candidates: unknown[] } };
    expect(prose.signals?.candidates).toEqual([group]);
    expect(prose.signals?.note).toContain("None is a finding");
    const note = (await executeTool(
      call("read_source", { sourceId: "reference:world.md" }),
      ctx,
    )) as Record<string, unknown>;
    expect(note).not.toHaveProperty("signals");
    expect(asked).toEqual(["node:S1"]);
    // Nothing found, or no pre-pass in this room: no field at all.
    const none = (await executeTool(
      call("read_source", { sourceId: "node:S1" }),
      context({ signals: () => [] }),
    )) as Record<string, unknown>;
    expect(none).not.toHaveProperty("signals");
    const off = (await executeTool(
      call("read_source", { sourceId: "node:S1" }),
      context(),
    )) as Record<string, unknown>;
    expect(off).not.toHaveProperty("signals");
  });

  it("offers the chat's skills with when to use them, and hands a call to the run", async () => {
    const skills = autonomousSkills("editorial");
    const tool = toolsFor({ findings: false, web: false, skills }).find(
      (one) => one.name === "use_skill",
    );
    expect(tool?.description).toContain("you must pick up the matching skill");
    expect(tool?.description).toContain("/continuity — ");
    expect(
      (tool?.inputSchema.properties as { skill: { enum: string[] } }).skill
        .enum,
    ).toEqual(skills.map((one) => one.command));
    // No skills, no tool.
    expect(
      toolsFor({ findings: false, web: false, skills: [] }).map(
        (one) => one.name,
      ),
    ).not.toContain("use_skill");
    // The run decides; the tool only asks it, and says so where it can't.
    const asked: string[] = [];
    const ctx = context({
      useSkill: async (word) => {
        asked.push(word);
        return { skill: `/${word}`, method: "Check it." };
      },
    });
    expect(
      await executeTool(call("use_skill", { skill: "continuity" }), ctx),
    ).toEqual({ skill: "/continuity", method: "Check it." });
    expect(asked).toEqual(["continuity"]);
    expect(await executeTool(call("use_skill", {}), ctx)).toEqual({
      error: "invalid-arguments",
    });
    expect(
      await executeTool(call("use_skill", { skill: "continuity" }), context()),
    ).toEqual({ error: "not-available" });
  });

  it("says when a search or a second index call is not needed", () => {
    // The descriptions keep a model from grepping for a section it can read
    // by title, and from fetching the structure both ways in one step.
    const tools = toolsFor({ findings: false, web: false });
    const named = (name: string) =>
      tools.find((tool) => tool.name === name)?.description;
    expect(named("grep")).toContain("A source you know by title needs no grep");
    expect(named("inspect_structure")).toContain("you do not need the other");
  });

  it("submits findings only from authorized sources", async () => {
    const accepted: unknown[] = [];
    const ctx = context({
      submitFindings: (raw) => {
        accepted.push(...raw);
        return { accepted: raw.length, rejected: [] };
      },
    });
    const outcome = (await executeTool(
      call("submit_findings", {
        findings: [
          {
            title: "Ok",
            explanation: "Cited.",
            severity: "minor",
            evidence: [{ sourceId: "node:S1", quote: "the gate" }],
          },
          {
            title: "Out of scope",
            explanation: "Cites a source this run cannot read.",
            severity: "major",
            evidence: [{ sourceId: "node:elsewhere", quote: "x" }],
          },
          {
            title: "No evidence",
            explanation: "Unsupported.",
            severity: "major",
            evidence: [],
          },
        ],
      }),
      ctx,
    )) as { accepted: number; rejected: Array<{ reason: string }> };
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected.map((one) => one.reason)).toEqual([
      "source-not-found",
      "missing-evidence",
    ]);
    expect(accepted).toHaveLength(1);
    expect(
      await executeTool(
        call("submit_findings", {
          findings: [
            {
              title: "T",
              explanation: "E",
              severity: "minor",
              evidence: [{ sourceId: "node:S1", quote: "q" }],
            },
          ],
        }),
        context(),
      ),
    ).toEqual({ error: "not-available" });
  });

  // The editor moves only when the writer asks. No tool lets the
  // model select text in the prose, and a model that calls one gets
  // `unknown-tool`.
  it("offers the model no tool that moves the editor", async () => {
    expect(
      toolsFor({ findings: true, web: true }).map((tool) => tool.name),
    ).toEqual([
      "list_sources",
      "grep",
      "read_source",
      "inspect_structure",
      "submit_findings",
      "web_search",
    ]);
    expect(
      await executeTool(
        call("select_evidence", { sourceId: "node:S1", quote: "the gate" }),
        context(),
      ),
    ).toEqual({ error: "unknown-tool" });
  });

  it("shapes raw findings defensively and drops shapeless entries", () => {
    let counter = 0;
    const findings = toFindings(
      [
        {
          title: "T".repeat(400),
          explanation: "E".repeat(5_000),
          severity: "weird" as never,
          uncertainty: "U".repeat(2_000),
          evidence: [
            { sourceId: "node:S1", quote: "q".repeat(3_000) },
            { sourceId: 7 as never, quote: "x" },
            { sourceId: "node:S1", quote: "" },
          ],
        },
        {
          title: 7 as never,
          explanation: "E",
          severity: "minor",
          evidence: [],
        },
        {
          title: "Ok",
          explanation: "Fine",
          severity: "major",
          evidence: [{ sourceId: "node:S1", quote: "the gate" }],
        },
      ],
      () => `id-${(counter += 1)}`,
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      severity: "observation",
      title: "T".repeat(300),
      uncertainty: "U".repeat(1_000),
    });
    expect(findings[0]?.evidence).toEqual([
      {
        sourceId: "node:S1",
        quote: "q".repeat(2_000),
        prefix: undefined,
        suffix: undefined,
      },
    ]);
    expect(findings[1]).toMatchObject({
      id: "id-2",
      severity: "major",
      status: "open",
    });
  });
});

// ── The web search tool ──────────────────────────────────────────────────────
//
// The model proposes a search through the tool; the pause, not the tool,
// sends it, and the tool hands back what the pause settled.

describe("web_search in the tool table", () => {
  const search = (query: unknown, id = "w1"): ToolCall => ({
    id,
    name: "web_search",
    arguments: { query },
  });

  it("is offered only where the run says so", () => {
    const names = (offer: { findings: boolean; web: boolean }) =>
      toolsFor(offer).map((tool) => tool.name);
    expect(names({ findings: false, web: false })).not.toContain("web_search");
    expect(names({ findings: false, web: false })).not.toContain(
      "submit_findings",
    );
    expect(names({ findings: false, web: true })).toContain("web_search");
    expect(names({ findings: true, web: false })).toContain("submit_findings");
  });

  it("names no engine and asks for the project's language", () => {
    expect(WEB_SEARCH_TOOL.description).not.toMatch(/openrouter|wikipedia/i);
    expect(WEB_SEARCH_TOOL.description).toContain("in the project's language");
  });

  // The description's last sentence is how a model learns the `(web:3)`
  // form the renderer draws as one marker. Literal, because no other row
  // would notice it drift.
  it("ends by asking for a citation in parentheses after its claim", () => {
    expect(
      WEB_SEARCH_TOOL.description.endsWith(
        " Cite a result by its id in parentheses after the claim it supports, such as (web:3).",
      ),
    ).toBe(true);
  });

  it("is not-available wherever nothing prepared it", async () => {
    expect(await executeTool(search("Roman aqueducts"), context())).toEqual({
      error: "not-available",
      hint: WEB_SEARCH_REFUSALS["not-available"],
    });
  });

  it("hands back exactly what the pause settled for that call", async () => {
    const call = search("Roman aqueducts");
    const settled = { status: "searched" };
    const ctx = context({
      preparedSearch: (asked) => (asked === call ? settled : undefined),
    });
    expect(await executeTool(call, ctx)).toBe(settled);
    // The same arguments on another call object are another call.
    expect(await executeTool(search("Roman aqueducts"), ctx)).toMatchObject({
      error: "not-available",
    });
  });

  it("refuses what is not one usable query, before anything is prepared", async () => {
    const ctx = context({ preparedSearch: () => ({ status: "searched" }) });
    for (const args of [
      { query: "a" },
      { query: " ​ " },
      { query: 7 },
      { query: "x".repeat(121) },
      { query: "rome", engine: "google" },
      {},
    ])
      expect(
        await executeTool(
          { id: "w1", name: "web_search", arguments: args },
          ctx,
        ),
        JSON.stringify(args),
      ).toEqual({
        error: "invalid-arguments",
        hint: WEB_SEARCH_REFUSALS["invalid-arguments"],
      });
    expect(webQueryOf(search(" Porta\tPia "))).toBe("Porta Pia");
    expect(webQueryOf({ id: "r", name: "read_source", arguments: {} })).toBe(
      null,
    );
  });

  it("holds one sameness rule: the query as it would be sent, case aside", () => {
    expect(callSignature(search("Rome"))).toBe(
      callSignature(search(" rome​ ")),
    );
    expect(callSignature(search("Rome"))).not.toBe(
      callSignature(search("Roma")),
    );
    // Every other tool's signature is its name and its arguments.
    expect(
      callSignature({ id: "r", name: "read_source", arguments: { a: 1 } }),
    ).toBe('read_source:{"a":1}');
  });

  it("judges the step's searches without writing the run's seen set", () => {
    const first = search("Rome", "a");
    const again = search("ROME", "b");
    const earlier = search("Carthage", "c");
    const broken = search("x", "d");
    const seen = new Set([callSignature(search("carthage"))]);
    const before = [...seen];
    const { rows, repeats } = searchCandidates(
      [first, again, earlier, broken],
      seen,
    );
    expect(rows).toEqual([
      { call: first, query: "Rome", signature: callSignature(first) },
    ]);
    expect([...repeats]).toEqual([again, earlier]);
    expect([...seen]).toEqual(before);
  });

  it("leaves a bare receipt for a search, ok only when it searched", () => {
    const call = search("Rome");
    expect(receiptOf(call, { status: "searched", results: [] })).toEqual({
      callId: "w1",
      name: "web_search",
      status: "ok",
    });
    for (const value of [
      { status: "declined", note: "n" },
      { status: "failed", code: "timeout" },
      { error: "search-limit", hint: "h" },
    ])
      expect(receiptOf(call, value)).toEqual({
        callId: "w1",
        name: "web_search",
        status: "error",
      });
  });

  it("keeps every other tool's receipt with its address and replay half", () => {
    const read = {
      id: "r1",
      name: "read_source",
      arguments: { sourceId: "node:S1" },
    };
    expect(receiptOf(read, { sourceId: "node:S1", content: "text" })).toEqual({
      callId: "r1",
      name: "read_source",
      status: "ok",
      sourceId: "node:S1",
      arguments: { sourceId: "node:S1" },
      result: JSON.stringify({ sourceId: "node:S1", content: "text" }),
    });
    expect(receiptOf(read, { error: "source-not-found" }).status).toBe("error");
  });

  it("finds the writer's words in a read and a grep, and nowhere else", () => {
    expect(
      manuscriptTextsOf(
        { id: "r", name: "read_source", arguments: {} },
        { content: "The gate is blue." },
      ),
    ).toEqual(["The gate is blue."]);
    expect(
      manuscriptTextsOf(
        { id: "s", name: "grep", arguments: {} },
        {
          matches: [
            { excerpt: "one" },
            { excerpt: 2 },
            null,
            { excerpt: "two" },
          ],
        },
      ),
    ).toEqual(["one", "two"]);
    expect(
      manuscriptTextsOf(
        { id: "l", name: "list_sources", arguments: {} },
        { sources: [{ title: "Opening" }] },
      ),
    ).toEqual([]);
    expect(
      manuscriptTextsOf(search("Rome"), { results: [{ excerpt: "web" }] }),
    ).toEqual([]);
  });
});

// A string's bounds are code points, as JSON Schema counts them and as the
// domain's query bounds are written.
describe("string bounds in code points", () => {
  it("takes a query of astral characters up to its code-point cap", async () => {
    const query = "\u{1F600}".repeat(100);
    expect(
      await executeTool(
        { id: "w", name: "web_search", arguments: { query } },
        context({ preparedSearch: () => ({ status: "searched" }) }),
      ),
    ).toEqual({ status: "searched" });
    expect(
      webQueryOf({ id: "w", name: "web_search", arguments: { query } }),
    ).toBe(query);
  });
});

// ── Discovery in a large book ────────────────────────────────────────────────

describe("paged discovery", () => {
  const book: SourceDescriptor[] = Array.from({ length: 600 }, (_, n) => ({
    id: `node:${n}`,
    kind: "manuscript" as const,
    title: `Section ${n}`,
    path: `${n}.md`,
    nodeId: `${n}`,
    authority: "manuscript" as const,
    nodeKind: n % 100 === 0 ? ("part" as const) : ("section" as const),
    order: n,
    // Each Section sits in the Part opened last: 1..99 in Part 0, and so on.
    ...(n % 100 === 0 ? {} : { partId: `${n - (n % 100)}` }),
  }));
  const ctx = () =>
    context({ catalog: book, allowed: new Set(book.map((one) => one.id)) });

  it("lists every allowed source across pages, each once, with the total", async () => {
    const seen: string[] = [];
    let start: number | undefined = 0;
    while (start !== undefined) {
      const pageOut = (await executeTool(
        call("list_sources", { start }),
        ctx(),
      )) as {
        sources: Array<{ sourceId: string }>;
        total: number;
        nextStart?: number;
      };
      expect(pageOut.total).toBe(600);
      expect(pageOut.sources.length).toBeLessThanOrEqual(200);
      seen.push(...pageOut.sources.map((one) => one.sourceId));
      start = pageOut.nextStart;
    }
    expect(seen).toHaveLength(600);
    expect(new Set(seen).size).toBe(600);
    expect(seen[seen.length - 1]).toBe("node:599");
  });

  it("pages the structure the same way, and the last page names no next", async () => {
    const first = (await executeTool(call("inspect_structure", {}), ctx())) as {
      nodes: unknown[];
      total: number;
      nextStart?: number;
    };
    expect(first.nodes).toHaveLength(500);
    expect(first.total).toBe(600);
    expect(first.nextStart).toBe(500);
    const second = (await executeTool(
      call("inspect_structure", { start: 500 }),
      ctx(),
    )) as { nodes: Array<{ sourceId: string }>; nextStart?: number };
    expect(second.nodes).toHaveLength(100);
    expect(second.nodes[second.nodes.length - 1]?.sourceId).toBe("node:599");
    expect(second.nextStart).toBeUndefined();
  });

  it("narrows the structure to one Part and what sits inside it", async () => {
    const part = (await executeTool(
      call("inspect_structure", { sourceId: "node:200" }),
      ctx(),
    )) as {
      nodes: Array<{ sourceId: string }>;
      total: number;
      totals: { parts: number; sections: number };
    };
    expect(part.total).toBe(100);
    expect(part.nodes[0]?.sourceId).toBe("node:200");
    expect(part.nodes[part.nodes.length - 1]?.sourceId).toBe("node:299");
    expect(part.totals).toEqual({ parts: 1, sections: 99 });
  });

  it("answers a Part past the horizon as not found, like any source", async () => {
    const allowed = new Set(book.map((one) => one.id));
    allowed.delete("node:200");
    const out = (await executeTool(
      call("inspect_structure", { sourceId: "node:200" }),
      context({ catalog: book, allowed }),
    )) as { error?: string };
    expect(out.error).toBe("source-not-found");
    // A Section's id is not a Part, and says so the same way.
    const section = (await executeTool(
      call("inspect_structure", { sourceId: "node:201" }),
      ctx(),
    )) as { error?: string };
    expect(section.error).toBe("source-not-found");
  });

  it("clamps a start past the end to an empty page", async () => {
    const out = (await executeTool(
      call("list_sources", { start: 5_000 }),
      ctx(),
    )) as { sources: unknown[]; total: number; nextStart?: number };
    expect(out.sources).toEqual([]);
    expect(out.total).toBe(600);
    expect(out.nextStart).toBeUndefined();
  });
});

describe("leave_comments", () => {
  const S2: SourceDescriptor = {
    id: "node:S2",
    kind: "manuscript",
    title: "Later",
    path: "document/s2.md",
    nodeId: "S2",
    nodeKind: "section",
    order: 1,
    authority: "manuscript",
  };

  function margin(answer: (body: string) => ProposalOutcome = () => "placed") {
    const asked: [string, CommentProposal[]][] = [];
    return {
      asked,
      leaveComments: async (nodeId: string, proposals: CommentProposal[]) => {
        asked.push([nodeId, proposals]);
        return proposals.map((one) => answer(one.body));
      },
    };
  }

  it("is offered only where there is a margin, and states the margin's cap", () => {
    const without = toolsFor({ findings: false, web: false });
    expect(without.some((tool) => tool.name === "leave_comments")).toBe(false);
    const offered = toolsFor({ findings: false, web: false, comments: 8 });
    const tool = offered.find((one) => one.name === "leave_comments");
    expect(tool?.description).toContain("At most 8 of your comments");
  });

  it("leaves each chapter's notes in its margin and answers each one", async () => {
    const { asked, leaveComments } = margin((body) =>
      body === "Again." ? "dismissed" : "placed",
    );
    const result = await executeTool(
      call("leave_comments", {
        comments: [
          {
            sourceId: "node:S1",
            quote: "the gate is blue",
            prefix: "and ",
            body: "Why blue?",
            weight: "minor",
          },
          { sourceId: "node:S1", body: "Again.", weight: "observation" },
        ],
      }),
      context({ leaveComments }),
    );
    expect(asked).toEqual([
      [
        "S1",
        [
          {
            quote: { text: "the gate is blue", prefix: "and " },
            body: "Why blue?",
            weight: "minor",
          },
          { quote: null, body: "Again.", weight: "observation" },
        ],
      ],
    ]);
    expect(result).toMatchObject({
      placed: 1,
      results: ["placed", "dismissed"],
    });
  });

  it("leaves nothing outside what the run may read: a reader's horizon, a reference, an unknown id", async () => {
    const { asked, leaveComments } = margin();
    const result = await executeTool(
      call("leave_comments", {
        comments: [
          { sourceId: "node:S2", body: "Past the horizon.", weight: "minor" },
          {
            sourceId: "reference:world.md",
            body: "On a reference.",
            weight: "minor",
          },
          { sourceId: "node:nope", body: "Nowhere.", weight: "minor" },
        ],
      }),
      // `S2` is in the catalogue but not in this run's allowed set.
      context({ leaveComments, catalog: [...SOURCES, S2] }),
    );
    expect(asked).toEqual([]);
    expect(result).toMatchObject({
      placed: 0,
      results: ["not-a-chapter", "not-a-chapter", "not-a-chapter"],
    });
  });

  it("says a margin that could not be written failed, and is not there without a sink", async () => {
    const failing = async () => {
      throw new Error("damaged");
    };
    const one = {
      comments: [{ sourceId: "node:S1", body: "x", weight: "minor" }],
    };
    expect(
      await executeTool(
        call("leave_comments", one),
        context({ leaveComments: failing }),
      ),
    ).toMatchObject({ placed: 0, results: ["failed"] });
    expect(await executeTool(call("leave_comments", one), context())).toEqual({
      error: "not-available",
    });
    expect(
      await executeTool(
        call("leave_comments", { comments: [{ sourceId: "node:S1" }] }),
        context({ leaveComments: margin().leaveComments }),
      ),
    ).toMatchObject({ error: "invalid-arguments" });
    expect(
      await executeTool(
        { id: "c", name: "leave_comments", arguments: "notes" },
        context({ leaveComments: margin().leaveComments }),
      ),
    ).toEqual({ error: "invalid-arguments" });
  });

  it("carries a quote's words after it, and reads an unanswered note as not placed", async () => {
    const asked: CommentProposal[][] = [];
    const result = await executeTool(
      call("leave_comments", {
        comments: [
          {
            sourceId: "node:S1",
            quote: "blue",
            suffix: " door",
            body: "Why?",
            weight: "minor",
          },
          { sourceId: "node:S1", body: "And?", weight: "minor" },
        ],
      }),
      context({
        // A margin that answers fewer notes than it was given.
        leaveComments: async (_nodeId, proposals) => {
          asked.push(proposals);
          return ["placed"];
        },
      }),
    );
    expect(asked[0][0].quote).toEqual({ text: "blue", suffix: " door" });
    expect(result).toMatchObject({
      placed: 1,
      results: ["placed", "unplaceable"],
    });
  });
});
