// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  declaredSources,
  readRoles,
  markUnsummarisable,
  namedSources,
  offerableRows,
  pinnedSources,
  searchableSummary,
  summarisedNodes,
  summariesToWrite,
  summaryBlockLifted,
  toSummarise,
  unsummarised,
  visibleSources,
} from "./sourceView";
import type { ChatRecord, SourceDescriptor } from "./types";

const sources: SourceDescriptor[] = [
  {
    id: "node:S1",
    nodeId: "S1",
    kind: "manuscript",
    title: "Opening",
    path: "/document/opening.md",
    order: 0,
    authority: "manuscript",
  },
  {
    id: "node:S2",
    nodeId: "S2",
    kind: "manuscript",
    title: "Future",
    path: "/document/future.md",
    order: 9,
    authority: "manuscript",
  },
  {
    id: "reference:world.md",
    kind: "reference",
    title: "World",
    path: "/reference/world.md",
    authority: "reference",
  },
];

function chat(
  kind: ChatRecord["kind"],
  preferences: Partial<ChatRecord["preferences"]> = {},
): ChatRecord {
  return {
    schemaVersion: 1,
    id: "chat-1",
    title: "A chat",
    kind,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
    preferences: {
      personaId: "persona-fixture",
      model: { providerId: "ollama", modelId: "llama" },
      pinnedSourceIds: [],
      ...preferences,
    },
    turns: [],
  };
}

const ids = (list: readonly SourceDescriptor[]) => list.map((one) => one.id);

describe("visibleSources", () => {
  it("shows a general chat everything", () => {
    expect(ids(visibleSources(chat("general"), sources))).toEqual([
      "node:S1",
      "node:S2",
      "reference:world.md",
    ]);
  });

  it("shows a reader the manuscript up to its horizon and nothing else", () => {
    const reader = chat("alpha-reader", {
      readerScope: { kind: "through", nodeId: "S1" },
    });
    expect(ids(visibleSources(reader, sources))).toEqual(["node:S1"]);
  });

  it("leaves a reader's horizon open for the whole book and for no scope yet", () => {
    for (const readerScope of [{ kind: "whole" as const }, undefined])
      expect(
        ids(visibleSources(chat("beta-reader", { readerScope }), sources)),
      ).toEqual(["node:S1", "node:S2"]);
  });

  it("shows a reader no manuscript when its horizon's node is gone, as the run allows none", () => {
    const reader = chat("alpha-reader", {
      readerScope: { kind: "through", nodeId: "GONE" },
    });
    expect(ids(visibleSources(reader, sources))).toEqual([]);
  });
});

describe("pinnedSources", () => {
  it("keeps the order the writer pinned in", () => {
    const general = chat("general", {
      pinnedSourceIds: ["reference:world.md", "node:S1"],
    });
    expect(ids(pinnedSources(general, sources))).toEqual([
      "reference:world.md",
      "node:S1",
    ]);
  });

  it("draws no chip for a pin that is attached to nothing", () => {
    // Gone from the catalogue, or past a horizon narrowed after the pin: the
    // run will not send either, so neither may be drawn as attached.
    const reader = chat("alpha-reader", {
      readerScope: { kind: "through", nodeId: "S1" },
      pinnedSourceIds: ["node:S1", "node:S2", "node:deleted"],
    });
    expect(ids(pinnedSources(reader, sources))).toEqual(["node:S1"]);
  });
});

// One rule for "a search can see this Section", read by the search,
// by the button that counts what is missing, and by the run behind it.
describe("summarisedNodes", () => {
  const summary = (
    id: string,
    over: Partial<SourceDescriptor> = {},
  ): SourceDescriptor => ({
    id: `reference:summary--${id}.md`,
    kind: "summary",
    title: id,
    path: `/reference/summary--${id}.md`,
    summarises: id,
    authority: "derived",
    freshness: "current",
    ...over,
  });

  it("counts a present summary, an outdated one included, and nothing else", () => {
    const catalog = [
      summary("S1"),
      summary("S2", { freshness: "outdated" }),
      summary("S3", { freshness: "missing" }),
      summary("S4", { summarises: undefined }),
      { ...summary("S5"), kind: "reference" as const },
    ];
    expect([...summarisedNodes(catalog)]).toEqual(["S1", "S2"]);
  });

  it("counts only what the scope allows", () => {
    const catalog = [summary("S1"), summary("S2")];
    expect([
      ...summarisedNodes(catalog, new Set(["reference:summary--S2.md"])),
    ]).toEqual(["S2"]);
    expect(searchableSummary(summary("S1"), new Set())).toBe(false);
  });
});

// What a click would summarise, read by the run and counted by the button,
// so the two cannot disagree.
describe("unsummarised", () => {
  const section = (nodeId: string): SourceDescriptor => ({
    id: `node:${nodeId}`,
    nodeId,
    kind: "manuscript",
    nodeKind: "section",
    title: nodeId,
    path: `/document/${nodeId}.md`,
    authority: "manuscript",
  });
  const summaryOf = (nodeId: string): SourceDescriptor => ({
    id: `reference:summary--${nodeId}.md`,
    kind: "summary",
    title: nodeId,
    path: `/reference/summary--${nodeId}.md`,
    summarises: nodeId,
    authority: "derived",
    freshness: "current",
  });
  const catalog = [
    section("S1"),
    section("S2"),
    summaryOf("S2"),
    section("S3"),
  ];

  it("keeps live Sections without a summary, in catalogue order", () => {
    const ids = unsummarised(catalog, [
      "node:S3",
      "node:S2",
      "node:gone",
      "reference:summary--S2.md",
      "node:S1",
    ]).map((one) => one.id);
    expect(ids).toEqual(["node:S1", "node:S3"]);
  });

  it("keeps nothing the scope does not allow", () => {
    expect(
      unsummarised(catalog, ["node:S1", "node:S3"], new Set(["node:S3"])).map(
        (one) => one.id,
      ),
    ).toEqual(["node:S3"]);
  });
  // The list a "Summarise n Sections" click writes: only `unmapped` rows,
  // within the reach when the run has one, judged against the boundary that
  // holds the summaries.
  it("gives the nodes a click summarises, from the unmapped rows only", () => {
    const every = new Set(catalog.map((one) => one.id));
    const coverage = {
      intended: 3,
      inspected: 0,
      complete: false,
      skipped: [
        { sourceId: "node:S1", reason: "unmapped" as const },
        { sourceId: "node:S2", reason: "unmapped" as const },
        { sourceId: "node:S3", reason: "too-large" as const },
      ],
    };
    // `S2`'s summary is in the boundary, so it is not written again; `S3` was
    // too large, which a summary cannot fix.
    expect(toSummarise(coverage, catalog, every)).toEqual(["S1"]);
    expect(toSummarise(coverage, catalog, every, new Set(["node:S3"]))).toEqual(
      [],
    );
    expect(toSummarise(undefined, catalog, every)).toEqual([]);
  });

  // A Section the model could not summarise is left out of the click until
  // the chat asks another model; the count and the run read one rule.
  it("leaves an unsummarisable row out until the block lifts", () => {
    const every = new Set(catalog.map((one) => one.id));
    const coverage = {
      intended: 2,
      inspected: 0,
      complete: false,
      skipped: [
        { sourceId: "node:S1", reason: "unsummarisable" as const },
        { sourceId: "node:S3", reason: "unmapped" as const },
      ],
    };
    expect(toSummarise(coverage, catalog, every)).toEqual(["S3"]);
    expect(toSummarise(coverage, catalog, every, undefined, true)).toEqual([
      "S1",
      "S3",
    ]);
    expect(offerableRows(coverage.skipped, false)).toEqual(["node:S3"]);
    expect(offerableRows(coverage.skipped, true)).toEqual([
      "node:S1",
      "node:S3",
    ]);
  });

  it("marks only this run's failed Sections, and only rows that were unmapped", () => {
    const coverage = {
      intended: 3,
      inspected: 0,
      complete: false,
      skipped: [
        { sourceId: "node:S1", reason: "unmapped" as const },
        { sourceId: "node:S2", reason: "too-large" as const },
        { sourceId: "node:S3", reason: "unmapped" as const },
      ],
    };
    expect(markUnsummarisable(coverage, new Set(["S1", "S2"])).skipped).toEqual(
      [
        { sourceId: "node:S1", reason: "unsummarisable" },
        { sourceId: "node:S2", reason: "too-large" },
        { sourceId: "node:S3", reason: "unmapped" },
      ],
    );
    expect(markUnsummarisable(coverage, undefined)).toBe(coverage);
    expect(markUnsummarisable(coverage, new Set())).toBe(coverage);
  });

  it("lifts the block only for another model on both sides", () => {
    const qwen = { providerId: "ollama", modelId: "qwen3:8b" };
    const llama = { providerId: "ollama", modelId: "llama3" };
    expect(summaryBlockLifted(qwen, llama)).toBe(true);
    expect(summaryBlockLifted(qwen, { ...qwen, modelRevision: "b" })).toBe(
      false,
    );
    // A missing model keeps it: a file that leaves the field out cannot
    // lift the block, and no click runs without a model anyway.
    expect(summaryBlockLifted(undefined, llama)).toBe(false);
    expect(summaryBlockLifted(qwen, null)).toBe(false);
  });
});

// The one matcher of a `reads` entry against the catalogue: the run
// attaches what it finds and the map lists its titles; a command that names
// a reference asks it which names there are.
describe("readRoles", () => {
  const sheet: SourceDescriptor = {
    id: "reference:character--mira.md",
    kind: "reference",
    title: "Mira",
    path: "/reference/character--mira.md",
    group: "characters",
    authority: "reference",
  };

  it("shows what every entry that reaches a document asks for, and all of it when one asks for all", () => {
    expect(
      readRoles(sheet, [
        { group: "characters", roles: ["rule"] },
        { group: "notes" },
        { group: "characters", roles: ["fact"] },
      ]),
    ).toEqual(new Set(["rule", "fact"]));
    expect(
      readRoles(sheet, [
        { group: "characters", roles: ["rule"] },
        { group: "characters" },
      ]),
    ).toBeNull();
    // Nothing narrows a document no entry reaches.
    expect(readRoles(sheet, [{ group: "notes", roles: ["rule"] }])).toBeNull();
  });
});

describe("declaredSources", () => {
  const doc = (
    id: string,
    kind: SourceDescriptor["kind"],
    group: string,
    sectionId?: string,
  ): SourceDescriptor => ({
    id,
    kind,
    title: id,
    path: `/reference/${id}`,
    group,
    ...(sectionId ? { sectionId } : {}),
    authority: kind === "summary" ? "derived" : "reference",
  });
  const brief = doc(
    "reference:guidebook--editing-brief.md",
    "reference",
    "guidebook",
    "editing-brief",
  );
  const style = doc(
    "reference:guidebook--prose-style.md",
    "reference",
    "guidebook",
    "prose-style",
  );
  const mira = doc("reference:character--mira.md", "reference", "characters");
  const idea = doc("reference:notes--idea.md", "note", "notes");
  const summary = doc("reference:summary--S1.md", "summary", "summaries");
  const catalog = [style, mira, brief, idea, summary];
  const all = new Set(catalog.map((one) => one.id));

  it("finds what each entry names, in declared order, each once", () => {
    expect(
      declaredSources(catalog, all, [
        { group: "guidebook", sectionId: "editing-brief" },
        { group: "notes" },
        { group: "guidebook" },
      ]),
    ).toEqual([brief, idea, style]);
  });

  it("finds nothing outside the allowed set, and never a summary or prose", () => {
    expect(
      declaredSources(catalog, new Set([style.id]), [
        { group: "guidebook" },
        { group: "characters" },
      ]),
    ).toEqual([style]);
    // By kind, not only by group: a summary or a manuscript node that claims
    // a declared group is still never attached as a reference.
    const planted = [
      { ...summary, group: "characters" },
      { ...sources[0], group: "characters" },
    ];
    expect(
      declaredSources(planted, new Set(planted.map((one) => one.id)), [
        { group: "characters" },
      ]),
    ).toEqual([]);
  });

  // A named reference is honoured only while every id is one the review may
  // still name, by the same matcher, and is refused whole, never narrowed to
  // what is left.
  it("resolves a named set only while every id is still one it reads", () => {
    const reads = [{ group: "characters" }, { group: "notes" }] as const;
    expect(namedSources(catalog, all, reads, [idea.id, mira.id])).toEqual([
      idea,
      mira,
    ]);
    expect(namedSources(catalog, all, reads, [mira.id, mira.id])).toEqual([
      mira,
    ]);
    for (const ids of [
      [],
      [mira.id, "reference:character--gone.md"],
      // Declared by nothing the task reads.
      [style.id],
      // Never nameable, whatever it claims.
      [summary.id],
    ])
      expect(namedSources(catalog, all, reads, ids), ids.join()).toBeNull();
    expect(
      namedSources(catalog, new Set([idea.id]), reads, [mira.id]),
    ).toBeNull();
  });
});

describe("summariesToWrite", () => {
  const section = (nodeId: string): SourceDescriptor => ({
    id: `node:${nodeId}`,
    nodeId,
    kind: "manuscript",
    nodeKind: "section",
    title: nodeId,
    path: `/document/${nodeId}.md`,
    authority: "manuscript",
  });
  const summaryOf = (
    nodeId: string,
    freshness: SourceDescriptor["freshness"],
  ): SourceDescriptor => ({
    id: `reference:summary--${nodeId}.md`,
    kind: "summary",
    title: nodeId,
    path: `/reference/summary--${nodeId}.md`,
    summarises: nodeId,
    authority: "derived",
    freshness,
  });
  const catalog = [
    section("S1"),
    section("S2"),
    section("S3"),
    section("S4"),
    section("S5"),
    summaryOf("S2", "current"),
    summaryOf("S3", "outdated"),
    summaryOf("S4", "unverified"),
    summaryOf("S5", "missing"),
  ];
  const every = ["node:S1", "node:S2", "node:S3", "node:S4", "node:S5"];

  it("writes the missing and the out of date, and uses what cannot be checked", () => {
    // A Part told from an outdated reading of a Section is a false story; a
    // summary that cannot be checked is used as a search uses it.
    expect(summariesToWrite(catalog, every)).toEqual(["S1", "S3", "S5"]);
  });

  it("keeps the order given, and names nothing outside it", () => {
    expect(summariesToWrite(catalog, ["node:S5", "node:S1"])).toEqual([
      "S5",
      "S1",
    ]);
    expect(summariesToWrite(catalog, ["node:gone"])).toEqual([]);
  });

  it("never writes over a summary the writer barred", () => {
    const barred = catalog.map((one) =>
      one.id === "node:S1" || one.id === "node:S3"
        ? { ...one, summaryBarred: true as const }
        : one,
    );
    expect(summariesToWrite(barred, every)).toEqual(["S5"]);
  });

  it("counts a summary the chat may not read as one to write", () => {
    const allowed = new Set(every);
    expect(summariesToWrite(catalog, every, allowed)).toEqual(
      every.map((id) => id.slice("node:".length)),
    );
  });
});
