// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it, vi } from "vitest";
import { DeltaTimeline } from "./delta";
import { SnapshotHistory } from "./snapshot";
import {
  HISTORY_CHECKPOINT_INTERVAL,
  HISTORY_MAX_BYTES,
  HISTORY_MAX_STEPS,
  type EditorState,
  type HistoryStore,
} from "../ports/history";
import type { Cursor, Doc, Paragraph } from "../domain/model";
import { Session, type SessionEvents } from "../application/session";
import { commonmarkCodec } from "./commonmark";
import { regexSearch } from "./regex";
import { Emitter } from "./emitter";
import { browserClipboardCodec } from "./browserHtml";

// Pins the delta timeline's own contract: tiers 2 and 3 of the equality
// ladder, and what the snapshot adapter has no counterpart for: retention of
// parked siblings, the journal round-trip, checkpoint replay, truncation, and
// hydration validation (a journal that fails any shape check contributes zero
// states). The differential rows at the bottom run both adapters through
// identical scripts and compare the walks under canonical serialization.
// Tier 1, reference identity, is in `history.contract.test.ts`, which runs
// against both adapters.

const PLAIN = { bold: false, italic: false, monospace: false };
const para = (text = ""): Paragraph => ({
  runs: text ? [{ text, format: PLAIN }] : [],
  alignment: "left",
  blockType: "paragraph",
});

const st = (doc: Doc, cursor: Cursor): EditorState => ({ doc, cursor });

const sessionWith = (history: HistoryStore) =>
  new Session({
    codec: commonmarkCodec,
    history,
    search: regexSearch,
    events: new Emitter<SessionEvents>(),
    clipboard: browserClipboardCodec,
  });

/** The first node that carries an edge; the root never does. */
function firstEdgeNode(journal: string) {
  const raw = JSON.parse(journal) as {
    nodes: Record<string, { edge: unknown }>;
  };
  const entry = Object.entries(raw.nodes).find(([, n]) => n.edge !== null);
  if (!entry) throw new Error("no edge node in journal");
  return entry[1] as {
    edge: {
      deltas: { para: number; before: Paragraph[]; after: Paragraph[] }[];
    };
  };
}

describe("delta computation", () => {
  it("a typed insertion produces a formatting-exact delta", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const bold: Paragraph = {
      runs: [
        {
          text: "storm",
          format: { bold: true, italic: true, monospace: true },
        },
      ],
      alignment: "center",
      blockType: "h1",
    };
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st([bold], { para: 0, offset: 5 }),
      "type",
      false,
    );
    const edge = firstEdgeNode(timeline.exportJournal() as string).edge;
    // An insertion is an empty before-span; the after-span carries the runs,
    // the format triple, the alignment and the block type verbatim.
    expect(edge.deltas[0].before).toEqual([]);
    expect(edge.deltas[0].after).toEqual([bold]);
  });

  it("a replacement round-trips formatting exactly — apply∘inverse ≡ identity", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [para("Hi")];
    const s1: Doc = [
      {
        runs: [
          { text: "Hi", format: PLAIN },
          {
            text: " there",
            format: { bold: true, italic: false, monospace: false },
          },
        ],
        alignment: "left",
        blockType: "paragraph",
      },
    ];
    timeline.push(
      st(s0, { para: 0, offset: 2 }),
      st(s1, { para: 0, offset: 8 }),
      "type",
      false,
    );
    const edge = firstEdgeNode(timeline.exportJournal() as string).edge;
    // The before-span is the paragraph it replaced, so the round trip is
    // exact on content and formatting, and the inverse (the undo replay)
    // restores that paragraph.
    expect(edge.deltas[0].before).toEqual([para("Hi")]);
    expect(edge.deltas[0].after[0].runs[1].format.bold).toBe(true);
    expect(edge.deltas[0].after[0].runs[1].text).toBe(" there");
  });

  it("a merge fold is cumulative — before stays burst start, after advances", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("a")];
    const s2: Doc = [para("ab")];
    const s3: Doc = [para("abc")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.push(
      st(s1, { para: 0, offset: 1 }),
      st(s2, { para: 0, offset: 2 }),
      "type",
      true,
    );
    timeline.push(
      st(s2, { para: 0, offset: 2 }),
      st(s3, { para: 0, offset: 3 }),
      "type",
      true,
    );

    // One undo restores the burst start; the folded step is one step.
    expect(timeline.undo()?.doc).toBe(s0);
    expect(timeline.canUndo).toBe(false);

    const edge = firstEdgeNode(timeline.exportJournal() as string).edge;
    expect(edge.deltas.length).toBe(1);
    expect(edge.deltas[0].before).toEqual([]);
    expect(edge.deltas[0].after).toEqual([para("abc")]);
  });

  it("a non-merge push with no change is an adapter assertion", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [para("a")];
    expect(() =>
      timeline.push(
        st(s0, { para: 0, offset: 1 }),
        st(s0, { para: 0, offset: 1 }),
        "type",
        false,
      ),
    ).toThrow(/no change/);
  });

  it("— a fold that nets to no change collapses back into its parent", () => {
    // A burst that nets to zero (type "x", then delete it) leaves no step,
    // because an undo that visibly does nothing reads as an unreliable undo.
    // The fold recomputes the edge from the burst start, finds the empty
    // diff, and collapses the node into its parent.
    const timeline = new DeltaTimeline();
    const s0: Doc = [para("hello")];
    const s1: Doc = [para("hellox")];
    timeline.push(
      st(s0, { para: 0, offset: 5 }),
      st(s1, { para: 0, offset: 6 }),
      "type",
      false,
    );
    timeline.push(
      st(s1, { para: 0, offset: 6 }),
      st(s0, { para: 0, offset: 5 }),
      "type",
      true,
    );

    // No step to undo, and no empty-edged node survives in the journal.
    expect(timeline.canUndo).toBe(false);
    const raw = JSON.parse(timeline.exportJournal() as string) as {
      nodes: Record<string, { edge: unknown }>;
    };
    expect(Object.keys(raw.nodes)).toHaveLength(1);
    expect(Object.values(raw.nodes)[0].edge).toBeNull();
  });
});

describe("retention — the parked future", () => {
  it("push after undo parks the displaced future as a sibling, never destroyed", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("The storm")];
    const s2: Doc = [para("The sun")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 10 }),
      "type",
      false,
    );
    timeline.undo();
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s2, { para: 0, offset: 8 }),
      "type",
      false,
    );

    expect(timeline.hasParkedSiblings).toBe(true);
    // Redo never walks into the parked future; a parked sibling is not
    // walkable.
    expect(timeline.canRedo).toBe(false);
    expect(timeline.redo()).toBeNull();
  });

  it("undo after parking walks back through the fork point", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("The storm")];
    const s2: Doc = [para("The sun")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 10 }),
      "type",
      false,
    );
    timeline.undo();
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s2, { para: 0, offset: 8 }),
      "type",
      false,
    );

    expect(timeline.undo()?.doc).toBe(s0);
    expect(timeline.undo()).toBeNull();
    expect(timeline.canRedo).toBe(true);
    expect(timeline.redo()?.doc).toBe(s2);
  });

  it("second-order parking strands the first fork one level deeper", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("a")];
    const s2: Doc = [para("b")];
    const s3: Doc = [para("c")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.undo();
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s2, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.undo();
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s3, { para: 0, offset: 1 }),
      "type",
      false,
    );

    expect(timeline.hasParkedSiblings).toBe(true);
    // The first fork's subtree is parked inside the second's: two levels of
    // parked future behind one tick, because the tick counts fork points, not
    // steps.
    expect(timeline.undo()?.doc).toBe(s0);
    expect(timeline.canUndo).toBe(false);
  });

  it("no parked siblings when the walk never forked", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("a")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    expect(timeline.hasParkedSiblings).toBe(false);
    timeline.undo();
    expect(timeline.hasParkedSiblings).toBe(false);
  });

  it("labels survive the walk — the next step's label answers the tooltip", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [para("cat cat")];
    const s1: Doc = [para("dog dog")];
    const s2: Doc = [para("dog dog!")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 7 }),
      "op",
      false,
      "Replace all",
    );
    timeline.push(
      st(s1, { para: 0, offset: 7 }),
      st(s2, { para: 0, offset: 8 }),
      "type",
      false,
    );

    expect(timeline.nextUndoLabel()).toBeNull(); // typing carries no label
    timeline.undo();
    expect(timeline.nextUndoLabel()).toBe("Replace all");
    expect(timeline.nextRedoLabel()).toBeNull();
    timeline.undo();
    expect(timeline.nextUndoLabel()).toBeNull();
    expect(timeline.nextRedoLabel()).toBe("Replace all");
    timeline.redo();
    expect(timeline.nextRedoLabel()).toBeNull();
  });
});

describe("journal round-trip", () => {
  it("export of an empty timeline is null", () => {
    expect(new DeltaTimeline().exportJournal()).toBeNull();
  });

  it("a round trip preserves the timeline, the labels, the head, and parked siblings", () => {
    const writer = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("storm")];
    const s2: Doc = [para("sun")];
    writer.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 5 }),
      "op",
      false,
      "Replace all",
    );
    writer.undo();
    writer.push(
      st(s0, { para: 0, offset: 0 }),
      st(s2, { para: 0, offset: 3 }),
      "type",
      false,
    );
    const journal = writer.exportJournal();
    expect(journal).not.toBeNull();

    const reader = new DeltaTimeline();
    const head = reader.importJournal(journal as string);
    expect(head?.doc).toEqual([para("sun")]);
    expect(reader.hasParkedSiblings).toBe(true);
    expect(reader.nextUndoLabel()).toBeNull();

    // The walk is value-identical to the writer's.
    expect(reader.undo()?.doc).toEqual(s0);
    expect(reader.redo()?.doc).toEqual([para("sun")]);
  });

  it("import rejects a journal that fails any shape check — zero states, never partial", () => {
    const reader = () => new DeltaTimeline();

    expect(reader().importJournal("not json")).toBeNull();
    expect(reader().importJournal("42")).toBeNull();
    expect(reader().importJournal("[]")).toBeNull();
    expect(reader().importJournal('{"head":1}')).toBeNull();
    expect(reader().importJournal('{"head":"1"}')).toBeNull();
    expect(reader().importJournal('{"head":0,"nodes":{}}')).toBeNull();
    // Self-parent cycle.
    expect(
      reader().importJournal(
        '{"head":0,"nodes":{"0":{"parent":0,"edge":null,"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // Negative cursor paragraph.
    expect(
      reader().importJournal(
        '{"head":0,"nodes":{"0":{"parent":null,"edge":null,"cursor":{"para":-1,"offset":0}}}}',
      ),
    ).toBeNull();
    // Unknown cause on an edge.
    expect(
      reader().importJournal(
        '{"head":1,"nodes":{"0":{"parent":null,"edge":null,"cursor":{"para":0,"offset":0}},"1":{"parent":0,"edge":{"cause":"bogus","label":null,"deltas":[]},"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // Unknown parent.
    expect(
      reader().importJournal(
        '{"head":1,"nodes":{"0":{"parent":null,"edge":null,"cursor":{"para":0,"offset":0}},"1":{"parent":9,"edge":null,"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // Empty checkpoint doc.
    expect(
      reader().importJournal(
        '{"head":0,"checkpoints":{"0":{"doc":"nope"}},"nodes":{"0":{"parent":null,"edge":null,"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // Checkpoint on an unknown node.
    expect(
      reader().importJournal(
        '{"head":0,"checkpoints":{"1":{"doc":[{"runs":[],"alignment":"left","blockType":"paragraph"}]}},"nodes":{"0":{"parent":null,"edge":null,"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // A delta that reaches beyond the doc — the replay fails.
    expect(
      reader().importJournal(
        '{"head":1,"nodes":{"0":{"parent":null,"edge":null,"cursor":{"para":0,"offset":0}},"1":{"parent":0,"edge":{"cause":"type","label":null,"deltas":[{"para":5,"before":[],"after":[]}]},"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // Prototype-pollution key.
    expect(
      reader().importJournal(
        '{"head":0,"nodes":{"__proto__":{"parent":null,"edge":null,"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // No checkpoint anywhere — the head path cannot replay.
    expect(
      reader().importJournal(
        '{"head":0,"nodes":{"0":{"parent":null,"edge":null,"cursor":{"para":0,"offset":0}}}}',
      ),
    ).toBeNull();
    // Oversized, rejected before parse.
    expect(
      reader().importJournal("x".repeat(HISTORY_MAX_BYTES + 1)),
    ).toBeNull();
  });

  it("— a checkpoint-anchor head with an out-of-bounds cursor never hydrates", () => {
    // Cursor bounds are checked against each materialized state, the
    // checkpoint anchor included: an offset beyond the checkpoint paragraph
    // refuses the whole journal, as a replayed path node does.
    const journal = JSON.stringify({
      head: 0,
      checkpoints: {
        "0": {
          doc: [
            {
              runs: [
                {
                  text: "hi",
                  format: { bold: false, italic: false, monospace: false },
                },
              ],
              alignment: "left",
              blockType: "paragraph",
            },
          ],
        },
      },
      nodes: {
        "0": { parent: null, edge: null, cursor: { para: 0, offset: 50 } },
      },
    });
    expect(new DeltaTimeline().importJournal(journal)).toBeNull();
  });

  it("import rejects an internally inconsistent journal — a before-span that does not match", () => {
    const writer = new DeltaTimeline();
    const s0: Doc = [para("ab")];
    const s1: Doc = [para("cd")];
    writer.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 2 }),
      "op",
      false,
    );
    const raw = JSON.parse(writer.exportJournal() as string) as {
      nodes: Record<
        string,
        {
          edge: { deltas: { before: { runs: { text: string }[] }[] }[] } | null;
        }
      >;
    };
    // A before-span that does not match the doc the replay starts from makes
    // the replay refuse; this is the journal's corruption check.
    const first = Object.values(raw.nodes).find((n) => n.edge !== null);
    if (!first || !first.edge) throw new Error("no edge node");
    first.edge.deltas[0].before[0].runs[0].text = "zz";
    expect(new DeltaTimeline().importJournal(JSON.stringify(raw))).toBeNull();
  });

  it("rejects prototype keys on the nodes record", () => {
    const writer = new DeltaTimeline();
    writer.push(
      st([], { para: 0, offset: 0 }),
      st([para("a")], { para: 0, offset: 1 }),
      "type",
      false,
    );
    const raw = JSON.parse(writer.exportJournal() as string) as {
      nodes: Record<string, unknown>;
    };
    raw.nodes["constructor"] = {
      parent: null,
      edge: null,
      cursor: { para: 0, offset: 0 },
    };
    expect(new DeltaTimeline().importJournal(JSON.stringify(raw))).toBeNull();
  });
});

describe("checkpoint replay and truncation", () => {
  it("hydrates a 500-step timeline from checkpoints", () => {
    const writer = sessionWith(new DeltaTimeline());
    for (let i = 0; i < 250; i++) {
      writer.type("x");
      writer.enter();
    }
    const journal = writer.exportJournal();
    expect(journal).not.toBeNull();
    const raw = JSON.parse(journal as string) as {
      checkpoints: Record<string, unknown>;
    };
    // Root + the interval checkpoints at 200 and 400.
    expect(Object.keys(raw.checkpoints).length).toBe(3);

    const reader = sessionWith(new DeltaTimeline());
    reader.open(writer.commonmark, { journal: journal ?? undefined });
    expect(reader.commonmark).toBe(writer.commonmark);
    // The full walk survives the reload.
    let steps = 0;
    while (reader.canUndo) {
      reader.undo();
      steps++;
    }
    expect(steps).toBe(500);
  });

  it("drops oldest parked subtrees first, never a state reachable from the head", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    // Fork at the root, then a long mainline — the parked subtree is oldest.
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st([para("parked")], { para: 0, offset: 6 }),
      "type",
      false,
    );
    timeline.undo();
    let cur: Doc = s0;
    for (let i = 0; i < HISTORY_MAX_STEPS + 5; i++) {
      const next: Doc = [para(`${i}`)];
      timeline.push(
        st(cur, { para: 0, offset: 0 }),
        st(next, { para: 0, offset: 1 }),
        "type",
        false,
      );
      cur = next;
    }
    // The mainline outgrew the cap; the parked subtree is gone, the walk
    // from the head is intact and bounded.
    expect(timeline.hasParkedSiblings).toBe(false);
    let steps = 0;
    while (timeline.undo()) steps++;
    expect(steps).toBe(HISTORY_MAX_STEPS);
  });

  it("truncation never orphans a descendant — the journal still hydrates", () => {
    const timeline = new DeltaTimeline();
    let cur: Doc = [];
    for (let i = 0; i < HISTORY_MAX_STEPS + 10; i++) {
      const next: Doc = [para(`p${i}`)];
      timeline.push(
        st(cur, { para: 0, offset: 0 }),
        st(next, { para: 0, offset: 1 }),
        "type",
        false,
      );
      cur = next;
    }
    const journal = timeline.exportJournal();
    expect(journal).not.toBeNull();
    const reader = new DeltaTimeline();
    const head = reader.importJournal(journal as string);
    expect(head?.doc).toEqual([para(`p${HISTORY_MAX_STEPS + 9}`)]);
    let steps = 0;
    while (reader.undo()) steps++;
    expect(steps).toBe(HISTORY_MAX_STEPS);
  });

  it("the fork point is checkpointed so a new branch's replay stays bounded", () => {
    const timeline = new DeltaTimeline();
    let cur: Doc = [];
    for (let i = 0; i < HISTORY_CHECKPOINT_INTERVAL + 5; i++) {
      const next: Doc = [para(`a${i}`)];
      timeline.push(
        st(cur, { para: 0, offset: 0 }),
        st(next, { para: 0, offset: 1 }),
        "type",
        false,
      );
      cur = next;
    }
    // Walk back past the interval checkpoint at step 200 and fork there.
    let forkBefore: EditorState | null = null;
    for (let i = 0; i < 150; i++) forkBefore = timeline.undo();
    const fork: Doc = [para("fork")];
    timeline.push(
      st(forkBefore?.doc ?? [], forkBefore?.cursor ?? { para: 0, offset: 0 }),
      st(fork, { para: 0, offset: 4 }),
      "type",
      false,
    );
    const journal = timeline.exportJournal() as string;
    const raw = JSON.parse(journal) as { checkpoints: Record<string, unknown> };
    // Root + interval checkpoint + the fork point.
    expect(Object.keys(raw.checkpoints).length).toBe(3);
    // The new branch hydrates to the fork state.
    expect(new DeltaTimeline().importJournal(journal)?.doc).toEqual([
      para("fork"),
    ]);
  });

  it("a 100k-character paste is one step, and undo is a reference swap", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("x".repeat(100_000))];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 100_000 }),
      "op",
      false,
    );
    const entry = timeline.undo();
    expect(entry?.doc).toBe(s0);
    expect(entry?.cursor).toEqual({ para: 0, offset: 0 });
    expect(timeline.redo()?.doc).toBe(s1);
  });

  it("— the byte backstop never evicts a redo-reachable step; redo() stays live", () => {
    // About 200 KB per step over 30 steps exceeds the 5 MB byte cap, so the
    // export's backstop evicts. With the head mid-walk, the redo chain is
    // reachable by `redo()` and is never the eviction's first target.
    const big = "x".repeat(100_000);
    const timeline = new DeltaTimeline();
    let cur: Doc = [];
    for (let i = 0; i < 30; i++) {
      const next: Doc = [para(`${i}:` + big)];
      timeline.push(
        st(cur, { para: 0, offset: 0 }),
        st(next, { para: 0, offset: 1 }),
        "type",
        false,
      );
      cur = next;
    }
    for (let i = 0; i < 20; i++) timeline.undo();
    const json = timeline.exportJournal();
    expect(json).not.toBeNull();
    expect((json as string).length).toBeLessThanOrEqual(HISTORY_MAX_BYTES);
    // The head's child pointer stays live after the eviction, so the redo
    // walk never reaches a node the backstop deleted.
    expect(timeline.canRedo).toBe(true);
    expect(timeline.redo()).not.toBeNull();
  });

  it("— a byte-cap floor hit exports null without touching the in-memory timeline", () => {
    // The head's state alone exceeds the cap, so no eviction can produce a
    // journal: export returns null and in-memory undo keeps working.
    const huge = "x".repeat(HISTORY_MAX_BYTES + 1024);
    const timeline = new DeltaTimeline();
    timeline.push(
      st([], { para: 0, offset: 0 }),
      st([para(huge)], { para: 0, offset: 1 }),
      "type",
      false,
    );
    expect(timeline.canUndo).toBe(true);
    expect(timeline.undoDepth()).toBe(1);
    expect(timeline.exportJournal()).toBeNull();
    // Nothing was evicted: the walk is intact in both directions.
    expect(timeline.canUndo).toBe(true);
    expect(timeline.undoDepth()).toBe(1);
    const undone = timeline.undo();
    expect(undone?.doc).toEqual([]);
    expect(timeline.redo()?.doc).toEqual([para(huge)]);
  });

  it("— the byte-cap floor measures the terminal shape including the head's own edge", () => {
    // The head's edge is on the protected chain and never evicted, so the
    // terminal journal is the head node with its edge. When that exceeds the
    // cap but the checkpoint alone fits, export writes a bare checkpoint and
    // drops the oversized edge: losing one step's undo beats a null with no
    // signal. The in-memory timeline is untouched; only
    // the journal written to disk changes.
    const edge = "y".repeat(Math.floor(HISTORY_MAX_BYTES * 0.4));
    const s1: Doc = [para(edge)];
    const s2: Doc = [para(edge + "z")];
    const timeline = new DeltaTimeline();
    timeline.push(
      st([], { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.push(
      st(s1, { para: 0, offset: 1 }),
      st(s2, { para: 0, offset: 1 }),
      "type",
      false,
    );
    // The head's checkpoint doc (~2MB) fits alone; the head's whole-doc edge
    // (~4MB) pushes the terminal shape over the cap.
    expect(timeline.undoDepth()).toBe(2);
    const journal = timeline.exportJournal();
    expect(journal).not.toBeNull();
    // The export leaves the in-memory timeline untouched (two undo steps
    // live). The journal on disk degrades to a bare checkpoint of the current
    // doc, losing the walk back and never the content.
    expect(timeline.undoDepth()).toBe(2);
    expect(timeline.canUndo).toBe(true);
    const rehydrated = new DeltaTimeline();
    const head = rehydrated.importJournal(journal as string);
    expect(head?.doc).toEqual(s2);
    expect(rehydrated.canUndo).toBe(false);
  });

  it("— with the head on the root, an over-cap redo future is left out of the journal, never the head", () => {
    // The head is the session's state and is never evicted. The redo future
    // alone is over the cap, so the journal holds the head without it; the
    // in-memory redo stays live.
    const huge = "x".repeat(HISTORY_MAX_BYTES + 1024);
    const timeline = new DeltaTimeline();
    timeline.push(
      st([para("tiny")], { para: 0, offset: 0 }),
      st([para(huge)], { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.undo(); // head on the root
    expect(timeline.canUndo).toBe(false);
    expect(timeline.canRedo).toBe(true);
    expect(timeline.redoDepth()).toBe(1);
    const journal = timeline.exportJournal();
    expect(journal).not.toBeNull();
    expect((journal as string).length).toBeLessThanOrEqual(HISTORY_MAX_BYTES);
    expect(new DeltaTimeline().importJournal(journal as string)?.doc).toEqual([
      para("tiny"),
    ]);
    // The in-memory walk is untouched.
    expect(timeline.canRedo).toBe(true);
    expect(timeline.redoDepth()).toBe(1);
    expect(timeline.undoDepth()).toBe(0);
    expect(timeline.redo()?.doc).toEqual([para(huge)]);
  });

  it("— with the head mid-walk, an over-cap redo future is left out of the journal before any undo step", () => {
    // The redo future comes back from a journal only as a parked branch, so
    // it is left out before the walk back loses depth: the journal keeps the
    // root and the head, and the in-memory timeline is untouched.
    const huge = "x".repeat(HISTORY_MAX_BYTES + 1024);
    const s0: Doc = [];
    const s1: Doc = [para("tiny")];
    const s2: Doc = [para(huge)];
    const timeline = new DeltaTimeline();
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.push(
      st(s1, { para: 0, offset: 1 }),
      st(s2, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.undo(); // head mid-walk: canUndo true, redo future live
    expect(timeline.canUndo).toBe(true);
    expect(timeline.canRedo).toBe(true);
    expect(timeline.redoDepth()).toBe(1);
    const journal = timeline.exportJournal();
    expect(journal).not.toBeNull();
    const reopened = new DeltaTimeline();
    expect(reopened.importJournal(journal as string)?.doc).toEqual(s1);
    expect(reopened.undoDepth()).toBe(1);
    // The in-memory walk is untouched.
    expect(timeline.canUndo).toBe(true);
    expect(timeline.canRedo).toBe(true);
    expect(timeline.undoDepth()).toBe(1);
    expect(timeline.redoDepth()).toBe(1);
    expect(timeline.redo()?.doc).toEqual(s2);
  });

  describe("the byte cap never moves the head", () => {
    // Four docs of 2000 paragraphs, about 2 MB each; every step rewrites the
    // first half, so each edge is about 2 MB. The whole timeline is over the
    // cap, and the head sits mid-walk with two steps of redo future.
    const docs = (): Doc[] => {
      const line = (tag: string, i: number) =>
        para(`${tag}${i} ` + "x".repeat(1000));
      const d0: Doc = Array.from({ length: 2000 }, (_, i) => line("a", i));
      const step = (doc: Doc, tag: string): Doc =>
        doc.map((p, i) => (i < 1000 ? line(tag, i) : p));
      const d1 = step(d0, "b");
      const d2 = step(d1, "c");
      return [d0, d1, d2, step(d2, "d")];
    };
    const at = { para: 0, offset: 0 };
    const midWalk = () => {
      const [d0, d1, d2, d3] = docs();
      const timeline = new DeltaTimeline();
      timeline.push(st(d0, at), st(d1, at), "op", false);
      timeline.push(st(d1, at), st(d2, at), "op", false);
      timeline.push(st(d2, at), st(d3, at), "op", false);
      timeline.undo();
      timeline.undo();
      return { timeline, d1 };
    };

    it("keeps the head on the session's state, so the next edit lands", () => {
      const { timeline, d1 } = midWalk();
      const journal = timeline.exportJournal();
      expect((journal as string).length).toBeLessThanOrEqual(HISTORY_MAX_BYTES);
      expect(timeline.peekBack(0)?.doc).toBe(d1);
      expect(timeline.canRedo).toBe(true);
      expect(() =>
        timeline.push(st(d1, at), st([para("next")], at), "type", false),
      ).not.toThrow();
      expect(new DeltaTimeline().importJournal(journal as string)?.doc).toEqual(
        d1,
      );
    });

    it("never serializes a journal over the cap to find one that fits", () => {
      const { timeline } = midWalk();
      const stringify = vi.spyOn(JSON, "stringify");
      try {
        timeline.exportJournal();
        const overCap = stringify.mock.results.filter(
          (r) =>
            typeof r.value === "string" && r.value.length > HISTORY_MAX_BYTES,
        );
        expect(overCap).toHaveLength(0);
      } finally {
        stringify.mockRestore();
      }
    });
  });

  it("after hydration the redo future is parked, not walked — the v1 limit, pinned", () => {
    // `importJournal` rebuilds child pointers only along head to root, so a
    // mid-walk save reopens at the walked position with the redo future
    // demoted to parked children, which are not walkable. A journal shape
    // that lifts this v1 limit flips this row.
    const writer = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("a")];
    const s2: Doc = [para("ab")];
    writer.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    writer.push(
      st(s1, { para: 0, offset: 1 }),
      st(s2, { para: 0, offset: 2 }),
      "type",
      false,
    );
    writer.undo(); // head mid-walk: one redo step ahead
    expect(writer.redoDepth()).toBe(1);
    const json = writer.exportJournal() as string;
    const reader = new DeltaTimeline();
    reader.importJournal(json);
    expect(reader.undoDepth()).toBe(1);
    expect(reader.redoDepth()).toBe(0);
    expect(reader.redo()).toBeNull();
  });

  it("— a burst folded into a checkpoint node re-exports the current head, not the stale checkpoint doc", () => {
    const timeline = new DeltaTimeline();
    let cur: Doc = [];
    for (let i = 0; i < HISTORY_CHECKPOINT_INTERVAL; i++) {
      const next: Doc = [para("a".repeat(i + 1))];
      timeline.push(
        st(cur, { para: 0, offset: i }),
        st(next, { para: 0, offset: i + 1 }),
        "type",
        false,
      );
      cur = next;
    }
    // Ten more keystrokes folded into the checkpoint node at step 200.
    for (let i = 0; i < 10; i++) {
      const next: Doc = [para("a".repeat(HISTORY_CHECKPOINT_INTERVAL + i + 1))];
      timeline.push(
        st(cur, { para: 0, offset: HISTORY_CHECKPOINT_INTERVAL + i }),
        st(next, { para: 0, offset: HISTORY_CHECKPOINT_INTERVAL + i + 1 }),
        "type",
        true,
      );
      cur = next;
    }
    const json = timeline.exportJournal();
    expect(json).not.toBeNull();
    const head = new DeltaTimeline().importJournal(json as string);
    // The hydrated head is the current state, folded burst included; a stale
    // head makes the session's tail reconcile drop the whole journal on
    // reload.
    expect(head).not.toBeNull();
    const text = (head?.doc[0].runs[0] as { text: string }).text;
    expect(text.length).toBe(HISTORY_CHECKPOINT_INTERVAL + 10);
  });

  it("— a merged push parks the displaced future like any push (redo stays null)", () => {
    const timeline = new DeltaTimeline();
    const s0: Doc = [];
    const s1: Doc = [para("a")];
    const s2: Doc = [para("ab")];
    const s3: Doc = [para("abc")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.push(
      st(s1, { para: 0, offset: 1 }),
      st(s2, { para: 0, offset: 2 }),
      "type",
      false,
    );
    timeline.undo(); // head back to s1 — a live redo chain of one
    expect(timeline.canRedo).toBe(true);
    timeline.push(
      st(s1, { para: 0, offset: 1 }),
      st(s3, { para: 0, offset: 3 }),
      "type",
      true,
    );
    // Any push, merged or not, makes `redo()` null; the displaced future is
    // parked, never walked.
    expect(timeline.canRedo).toBe(false);
    expect(timeline.redo()).toBeNull();
  });
});

describe("node timestamps — the journal's per-step clock", () => {
  it("export writes a finite ts per node, root included", () => {
    const timeline = new DeltaTimeline(() => 1000);
    const s0: Doc = [];
    const s1: Doc = [para("a")];
    const s2: Doc = [para("ab")];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: 1 }),
      "type",
      false,
    );
    timeline.push(
      st(s1, { para: 0, offset: 1 }),
      st(s2, { para: 0, offset: 2 }),
      "type",
      false,
    );
    const raw = JSON.parse(timeline.exportJournal() as string) as {
      nodes: Record<string, { ts: unknown }>;
    };
    for (const n of Object.values(raw.nodes)) expect(n.ts).toBe(1000);
  });

  it("round-trips the stamps — import restores the writer's clock", () => {
    let t = 0;
    const writer = new DeltaTimeline(() => (t += 1000));
    writer.push(
      st([], { para: 0, offset: 0 }),
      st([para("a")], { para: 0, offset: 1 }),
      "type",
      false,
    );
    const journal = writer.exportJournal() as string;
    const reader = new DeltaTimeline();
    const head = reader.importJournal(journal);
    expect(head).not.toBeNull();
    // The root's stamp is the timeline's birth; the step's is its own later.
    expect(reader.peekTimestamp(1)).toBe(1000);
    expect(reader.peekTimestamp(0)).toBe(2000);
  });

  it("a pre-timestamp journal imports cleanly — the walk lives, the stamps are null", () => {
    const writer = new DeltaTimeline();
    writer.push(
      st([], { para: 0, offset: 0 }),
      st([para("a")], { para: 0, offset: 1 }),
      "type",
      false,
    );
    const raw = JSON.parse(writer.exportJournal() as string) as {
      nodes: Record<string, { ts?: unknown }>;
    };
    for (const n of Object.values(raw.nodes)) delete n.ts;
    const reader = new DeltaTimeline();
    const head = reader.importJournal(JSON.stringify(raw));
    expect(head).not.toBeNull();
    expect(reader.peekTimestamp(0)).toBeNull();
    expect(reader.peekTimestamp(1)).toBeNull();
    // The walk itself is untouched; undo returns the same state.
    expect(reader.undo()?.doc).toEqual([]);
  });

  it("a malformed stamp degrades to null — never a rejection of the whole journal", () => {
    const writer = new DeltaTimeline();
    writer.push(
      st([], { para: 0, offset: 0 }),
      st([para("a")], { para: 0, offset: 1 }),
      "type",
      false,
    );
    const raw = JSON.parse(writer.exportJournal() as string) as {
      nodes: Record<string, { ts?: unknown }>;
    };
    // One node's stamp is the wrong type, the other's is negative.
    const entries = Object.values(raw.nodes);
    entries[0].ts = "yesterday";
    entries[1].ts = -5;
    const reader = new DeltaTimeline();
    expect(reader.importJournal(JSON.stringify(raw))).not.toBeNull();
    expect(reader.peekTimestamp(0)).toBeNull();
    expect(reader.peekTimestamp(1)).toBeNull();
  });

  it("a merged fold advances the node's stamp — the step's time is when it became current", () => {
    let t = 0;
    const timeline = new DeltaTimeline(() => (t += 1000));
    timeline.push(
      st([], { para: 0, offset: 0 }),
      st([para("a")], { para: 0, offset: 1 }),
      "type",
      false,
    );
    // Fold: the burst node advances past the burst start's parent.
    timeline.push(
      st([para("a")], { para: 0, offset: 1 }),
      st([para("ab")], { para: 0, offset: 2 }),
      "type",
      true,
    );
    const raw = JSON.parse(timeline.exportJournal() as string) as {
      nodes: Record<string, { ts: number }>;
    };
    expect(raw.nodes["1"].ts).toBeGreaterThan(raw.nodes["0"].ts);
    expect(timeline.peekTimestamp(0)).toBe(3000);
  });
});

// ── The differential oracle ──────────────────────────────────────────────────
//
// Both adapters implement the same port. The shared contract suite pins the
// semantics; these rows pin that the walks match under canonical
// serialization. Equality is by `commonmark`, never by reference, because
// the two adapters return different object graphs. Every doc-changing step
// is captured through the session's events bus, the seam the UI uses.

function scriptWalk(script: (s: Session) => void): {
  snapshot: string[];
  delta: string[];
} {
  const run = (mk: () => HistoryStore) => {
    const s = sessionWith(mk());
    const out = [s.commonmark];
    s.subscribe((reason) => {
      if (reason === "doc") out.push(s.commonmark);
    });
    script(s);
    return out;
  };
  return {
    snapshot: run(() => new SnapshotHistory()),
    delta: run(() => new DeltaTimeline()),
  };
}

describe("differential oracle — both adapters walk identically", () => {
  it("a typing burst", () => {
    const { snapshot, delta } = scriptWalk((s) => {
      s.type("The storm");
      s.undo();
      s.redo();
    });
    expect(delta).toEqual(snapshot);
  });

  it("undo-then-type parks the future the same way", () => {
    const { snapshot, delta } = scriptWalk((s) => {
      s.type("The storm");
      s.undo();
      s.type("The sun");
      s.undo();
      s.redo();
    });
    expect(delta).toEqual(snapshot);
  });

  it("delete bursts and paragraph joins", () => {
    const { snapshot, delta } = scriptWalk((s) => {
      s.open("one\n\ntwo\n\nthree");
      s.updateSelection({
        anchor: { para: 2, offset: 5 },
        focus: { para: 2, offset: 5 },
      });
      s.backspace();
      s.backspace();
      s.backspace();
      s.undo();
      s.undo();
    });
    expect(delta).toEqual(snapshot);
  });

  it("a mixed script of ops, formats, and a replace-all", () => {
    const { snapshot, delta } = scriptWalk((s) => {
      s.open("cat cat");
      s.updateSelection({
        anchor: { para: 0, offset: 0 },
        focus: { para: 0, offset: 3 },
      });
      s.toggleBold();
      s.updateSelection({
        anchor: { para: 0, offset: 0 },
        focus: { para: 0, offset: 0 },
      });
      s.replaceAll("cat", "dog", { caseSensitive: false, wholeWord: false });
      s.undo();
      s.undo();
      s.redo();
    });
    expect(delta).toEqual(snapshot);
  });

  it("the preview walk renders the same merged doc on both adapters", () => {
    // The rail's preview rides `peekBack`: the merged view is the tip against
    // the peeked state, so both adapters paint the same walk. The merged
    // doc's text is always the union of both sides, so the walk is captured
    // through the decorations, where the depth shows.
    const run = (mk: () => HistoryStore) => {
      const s = sessionWith(mk());
      s.open("one");
      s.type(" two");
      s.enter();
      s.type(" three");
      s.enterHistoryDiff();
      const out = [JSON.stringify(s.diffDecorations)];
      s.walkHistory(-1);
      out.push(JSON.stringify(s.diffDecorations));
      s.walkHistory(-1);
      out.push(JSON.stringify(s.diffDecorations));
      s.walkHistory(1);
      out.push(JSON.stringify(s.diffDecorations));
      return out;
    };
    const snapshot = run(() => new SnapshotHistory());
    const delta = run(() => new DeltaTimeline());
    expect(delta).toEqual(snapshot);
  });
});

// ── Fold replay and edge size ────────────────────────────────────────────────

describe("audit findings", () => {
  it("— a merge fold across a paragraph join computes an edge that cannot replay against the parent", () => {
    // A backspace deletes in place ("cc" to "c"), then a second backspace in
    // the same merge burst (per the session's `shouldMerge`) joins that
    // paragraph into the previous one ("bb" + "c" to "bbc", three paragraphs
    // to two). Untouched paragraphs share one object reference across states,
    // as every real edit does, and `diffDocs` walks by reference; a fresh
    // `para(...)` per doc would defeat that walk and hide the defect.
    const timeline = new DeltaTimeline();
    const pAa = para("aa");
    const pBb = para("bb");
    const pCc = para("cc");
    const pC = para("c");
    const pBbc = para("bbc");
    const s0: Doc = [pAa, pBb, pCc];
    const s1: Doc = [pAa, pBb, pC];
    const s2: Doc = [pAa, pBbc];

    timeline.push(
      st(s0, { para: 2, offset: 1 }),
      st(s1, { para: 2, offset: 0 }),
      "backspace",
      false,
    );
    timeline.push(
      st(s1, { para: 2, offset: 0 }),
      st(s2, { para: 1, offset: 2 }),
      "backspace",
      true,
    );

    const journal = timeline.exportJournal();
    expect(journal).not.toBeNull();

    // The fold recomputes the whole edge against the parent (`s0`), never
    // patching it from the burst's last two states. A patched edge keys a
    // paragraph index the join made stale, fails `paragraphsEqual` on replay,
    // and `applyEdge` returns null, so the whole journal drops on the next
    // open.
    const rehydrated = new DeltaTimeline();
    const head = rehydrated.importJournal(journal as string);
    expect(head).not.toBeNull();
    expect(head?.doc).toEqual(s2);
  });

  it("— a single edge exceeding the byte cap disables journal persistence entirely, with no signal", () => {
    const timeline = new DeltaTimeline();
    // Sized so the checkpoint alone (one copy of `big`) fits under the cap
    // but the edge, which carries the content again on its `after` side,
    // does not. That split separates a doc too big to persist (still null)
    // from one large edit's edge (degrades).
    const big = "x".repeat(Math.floor(HISTORY_MAX_BYTES * 0.6));
    const s0: Doc = [para("")];
    const s1: Doc = [para(big)];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: big.length }),
      "type",
      false,
    );

    // An edge larger than `HISTORY_MAX_BYTES` degrades the export, as the
    // ordinary eviction path degrades by dropping older steps. A null here
    // would stop the file's history persisting on every later save, with
    // nothing telling the writer.
    const journal = timeline.exportJournal();
    expect(journal).not.toBeNull();
    // The degraded export holds the writer's content: a bare checkpoint with
    // the oversized edge dropped, never an invented or truncated document.
    const rehydrated = new DeltaTimeline();
    const head = rehydrated.importJournal(journal as string);
    expect(head?.doc).toEqual(s1);
  });

  it("— a document too large to fit even as a bare checkpoint still returns null", () => {
    const timeline = new DeltaTimeline();
    const huge = "x".repeat(HISTORY_MAX_BYTES + 1000);
    const s0: Doc = [para("")];
    const s1: Doc = [para(huge)];
    timeline.push(
      st(s0, { para: 0, offset: 0 }),
      st(s1, { para: 0, offset: huge.length }),
      "type",
      false,
    );
    expect(timeline.exportJournal()).toBeNull();
  });
});
