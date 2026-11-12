// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import type { SourceDescriptor } from "../domain/types";
import type { ProjectSources } from "../ports";
import {
  OUTDATED,
  chunkRows,
  renderRows,
  sectionRows,
  shownIds,
  type MappedRow,
} from "./sectionMap";

const node = (
  nodeId: string,
  order: number,
  nodeKind: "part" | "section" = "section",
): SourceDescriptor => ({
  id: `node:${nodeId}`,
  kind: "manuscript",
  title: nodeId,
  path: `document/${nodeId}.md`,
  nodeId,
  nodeKind,
  order,
  authority: "manuscript",
});

const summary = (
  nodeId: string,
  freshness: "current" | "outdated" = "current",
): SourceDescriptor => ({
  id: `reference:summary--${nodeId}.md`,
  kind: "summary",
  title: nodeId,
  path: `reference/summary--${nodeId}.md`,
  summarises: nodeId,
  authority: "derived",
  freshness,
});

describe("the Sections seen through their summaries", () => {
  it("lists Sections only, in book order, each with its summary if any", () => {
    const catalog = [
      node("B", 2),
      node("P", 0, "part"),
      node("A", 1),
      summary("A"),
      summary("P"),
    ];
    const everything = new Set(catalog.map((one) => one.id));
    const rows = sectionRows(catalog, everything);
    expect(
      rows.map((row) => [row.node.nodeId, row.summary?.id ?? null]),
    ).toEqual([
      ["A", "reference:summary--A.md"],
      ["B", null],
    ]);
    // A Section outside the chat's reach is not in scope at all.
    expect(
      sectionRows(catalog, new Set(["node:B"])).map((row) => row.node.id),
    ).toEqual(["node:B"]);
  });

  it("renders one flattened header per row, the summary clipped", async () => {
    const sources = {
      read: async () => ({
        text: "  Aldo leaves the harbour at dawn.  ",
        revision: "r",
        origin: "project-file" as const,
      }),
    } as unknown as ProjectSources;
    const rows: MappedRow[] = [
      {
        node: { ...node("A", 0), title: "The\nHarbour" },
        summary: summary("A", "outdated"),
      },
    ];
    const [row] = await renderRows(
      sources,
      rows,
      10,
      new AbortController().signal,
    );
    // Cut at a word, and marked: a half word read as the Section's last
    // event is worse than an honest "…".
    expect(row).toEqual({
      id: "node:A",
      text: `ROW node:A | The Harbour ${OUTDATED}\nAldo…`,
    });
  });

  it("cuts a long summary at a sentence end when there is one", async () => {
    const sources = {
      read: async () => ({
        text: "Aldo leaves the harbour. Marta stays behind and waits.",
        revision: "r",
        origin: "project-file" as const,
      }),
    } as unknown as ProjectSources;
    const [row] = await renderRows(
      sources,
      [{ node: node("A", 0), summary: summary("A") }],
      40,
      new AbortController().signal,
    );
    expect(row?.text).toBe("ROW node:A | A\nAldo leaves the harbour.…");
  });

  it("cuts rows into steps that fit, never an empty one", () => {
    const rows = ["a".repeat(10), "b".repeat(10), "c".repeat(10)].map(
      (text, index) => ({ id: `node:${index}`, text }),
    );
    expect(chunkRows(rows, 25).map((part) => part.length)).toEqual([2, 1]);
    // A row bigger than the room still goes, alone.
    expect(chunkRows(rows, 5).map((part) => part.length)).toEqual([1, 1, 1]);
  });

  it("accepts only the ids a step was shown, in either spelling", () => {
    const shown = shownIds([{ id: "node:S1", text: "" }]);
    expect(shown("node:S1")).toBe("node:S1");
    expect(shown(" S1 ")).toBe("node:S1");
    expect(shown("S2")).toBeNull();
    expect(shown(7)).toBeNull();
  });
});
