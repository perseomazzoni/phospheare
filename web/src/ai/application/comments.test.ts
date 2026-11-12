// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import type { CommentProposal, ProposalOutcome } from "../domain/comments";
import type { ContextUse, Finding, SourceDescriptor } from "../domain/types";
import type { Comments } from "../ports";
import type { RunBudget } from "./budgets";
import { commentsBlock, divertFindings, keepForLater } from "./comments";

const use = (over: Partial<ContextUse>): ContextUse =>
  ({
    id: "node:EL2",
    kind: "manuscript",
    title: "The Storm",
    path: "",
    nodeId: "EL2",
    reason: "default",
    coverage: "full",
    characters: 100,
    ...over,
  }) as ContextUse;

const budget = { totalCharacters: 100_000 } as RunBudget;
const names = () => null;

function port(): Comments & { threadsOf: ReturnType<typeof vi.fn> } {
  return {
    reply: async () => undefined,
    propose: async () => [],
    cap: 8,
    threadsOf: vi.fn(async (ids: readonly string[]) =>
      ids.map((nodeId) => ({
        nodeId,
        threads: [
          {
            id: "t",
            state: "open" as const,
            passage: "the storm",
            entries: [{ by: { kind: "writer" as const }, body: "Why?" }],
          },
        ],
      })),
    ),
  };
}

describe("commentsBlock", () => {
  it("reads the margins of the attached chapters, once each", async () => {
    const comments = port();
    const block = await commentsBlock(
      comments,
      "editorial",
      [use({}), use({}), use({ id: "reference:world.md", kind: "reference" })],
      "wren",
      names,
      budget,
    );
    expect(comments.threadsOf).toHaveBeenCalledWith(["EL2"]);
    expect(block).toContain('"source":"node:EL2"');
  });

  it("reads nothing in a reader's chat: a first reader never sees the margin", async () => {
    for (const kind of ["alpha-reader", "beta-reader"] as const) {
      const comments = port();
      expect(
        await commentsBlock(comments, kind, [use({})], "wren", names, budget),
      ).toBe("");
      expect(comments.threadsOf).not.toHaveBeenCalled();
    }
  });

  it("costs the turn its comments, never the turn, when the margin cannot be read", async () => {
    const broken: Comments = {
      reply: async () => undefined,
      propose: async () => [],
      cap: 8,
      threadsOf: async () => {
        throw new Error("offline");
      },
    };
    expect(
      await commentsBlock(broken, "general", [use({})], "wren", names, budget),
    ).toBe("");
  });

  it("says nothing with no port, or no chapter attached", async () => {
    expect(
      await commentsBlock(undefined, "general", [use({})], "w", names, budget),
    ).toBe("");
    const comments = port();
    expect(
      await commentsBlock(
        comments,
        "general",
        [use({ kind: "reference", nodeId: undefined })],
        "w",
        names,
        budget,
      ),
    ).toBe("");
    expect(comments.threadsOf).not.toHaveBeenCalled();
  });
});

describe("divertFindings", () => {
  const CATALOG = [
    { id: "node:EL2", kind: "manuscript", nodeId: "EL2", title: "Two" },
    { id: "node:EL3", kind: "manuscript", nodeId: "EL3", title: "Three" },
    { id: "reference:world.md", kind: "reference", title: "World" },
  ] as SourceDescriptor[];

  const finding = (
    id: string,
    sources: string[],
    over: Partial<Finding> = {},
  ): Finding => ({
    id,
    severity: "minor",
    title: `Title ${id}`,
    explanation: `Why ${id}.`,
    evidence: sources.map((sourceId, n) => ({
      sourceId,
      quote: `quote ${id}.${n}`,
      prefix: "before ",
    })),
    status: "open",
    ...over,
  });

  function proposing(answer: (body: string) => ProposalOutcome) {
    const asked: [string, CommentProposal[]][] = [];
    const port: Comments = {
      cap: 8,
      threadsOf: async () => [],
      reply: async () => undefined,
      propose: async (nodeId, _persona, proposals) => {
        asked.push([nodeId, [...proposals]]);
        return proposals.map((one) => answer(one.body));
      },
    };
    return { port, asked };
  }

  it("moves a finding about one chapter's words into its margin, as a note of its own", async () => {
    const { port, asked } = proposing(() => "placed");
    const one = finding("a", ["node:EL2", "node:EL2"], { severity: "major" });
    const out = await divertFindings(port, [one], CATALOG, "wren");
    expect(out).toEqual({
      findings: [],
      commented: [{ nodeId: "EL2", count: 1 }],
    });
    expect(asked).toEqual([
      [
        "EL2",
        [
          {
            quote: { text: "quote a.0", prefix: "before " },
            body: "Title a\n\nWhy a.\n\n“quote a.1”",
            weight: "major",
          },
        ],
      ],
    ]);
  });

  it("keeps in the chat what has no one place: several chapters, a reference, nothing verified", async () => {
    const { port, asked } = proposing(() => "placed");
    const kept = [
      finding("wide", ["node:EL2", "node:EL3"]),
      finding("ref", ["reference:world.md"]),
      finding("doubt", ["node:EL2"], { unverified: "all" }),
      finding("bare", []),
    ];
    const out = await divertFindings(port, kept, CATALOG, "wren");
    expect(out.findings).toEqual(kept);
    expect(out.commented).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("lets the margin decide: answered before is gone, no room or no passage stays", async () => {
    const outcomes: Record<string, ProposalOutcome> = {
      "Title d": "dismissed",
      "Title s": "settled",
      "Title u": "duplicate",
      "Title c": "cap",
      "Title x": "unplaceable",
      "Title p": "placed",
    };
    const { port } = proposing(
      (body) => outcomes[body.split("\n")[0]] ?? "placed",
    );
    const all = ["d", "s", "u", "c", "x", "p"].map((id) =>
      finding(id, ["node:EL2"]),
    );
    const out = await divertFindings(port, all, CATALOG, "wren");
    expect(out.findings.map((one) => one.id)).toEqual(["c", "x"]);
    expect(out.commented).toEqual([{ nodeId: "EL2", count: 1 }]);
  });

  it("keeps every finding when the margin cannot be written, or there is none", async () => {
    const broken: Comments = {
      cap: 8,
      threadsOf: async () => [],
      reply: async () => undefined,
      propose: async () => {
        throw new Error("damaged");
      },
    };
    const list = [finding("a", ["node:EL2"])];
    expect(await divertFindings(broken, list, CATALOG, "wren")).toEqual({
      findings: list,
      commented: [],
    });
    expect(await divertFindings(undefined, list, CATALOG, "wren")).toEqual({
      findings: list,
      commented: [],
    });
  });
});

describe("keepForLater", () => {
  const note = (body: string, quote?: string): CommentProposal => ({
    quote: quote ? { text: quote } : null,
    body,
    weight: quote ? "minor" : "observation",
  });

  it("asks nothing for no notes, and counts nothing when the margin fails", async () => {
    const asked = vi.fn(async () => [] as ProposalOutcome[]);
    const quiet: Comments = {
      cap: 8,
      threadsOf: async () => [],
      reply: async () => undefined,
      propose: asked,
    };
    expect(await keepForLater(quiet, "EL2", "wren", [])).toBe(0);
    expect(asked).not.toHaveBeenCalled();
    const broken: Comments = {
      ...quiet,
      propose: async () => {
        throw new Error("damaged");
      },
    };
    expect(await keepForLater(broken, "EL2", "wren", [note("a")])).toBe(0);
  });

  it("asks again only for a misquote, as a note on the Section", async () => {
    const asked: CommentProposal[][] = [];
    const port: Comments = {
      cap: 8,
      threadsOf: async () => [],
      reply: async () => undefined,
      propose: async (_node, _persona, proposals) => {
        asked.push([...proposals]);
        // A note on the Section, or a quote found, is placed; a refusal
        // for any other reason is the margin's last word.
        return proposals.map((one) =>
          one.body === "full"
            ? "cap"
            : one.quote?.text === "gone"
              ? "unplaceable"
              : "placed",
        );
      },
    };
    const placed = await keepForLater(port, "EL2", "wren", [
      note("kept", "here"),
      note("moved", "gone"),
      note("full"),
    ]);
    expect(placed).toBe(2);
    expect(asked[1]).toEqual([
      { quote: null, body: "moved\n\n“gone”", weight: "minor" },
    ]);
  });
});
