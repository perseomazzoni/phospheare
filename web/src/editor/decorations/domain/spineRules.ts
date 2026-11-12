// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { findParent, nodeOfFile } from "../../../project/structure";
import type { DocumentStats, DocumentStructure } from "../../../project/types";
import {
  describeSpine,
  formatCount,
  layoutSpineGoal,
  recencyOpacity,
  scaleFor,
  spineParts,
} from "../../../ui/spineLayout";

// ── The spine as rules ───────────────────────────────────────────────────────
//
// The project's shape drawn as a book's contents are set: each Part a column,
// its Sections ink rules at their true share of the Part, and the room the
// goal leaves a dotted leader running on to a page not yet set. It is the
// spine's own drawing (`layoutSpineGoal`), so the two agree on every width:
// the Parts share the goal as the spine shares it, a Part that outgrows its
// share borrowing from the rest.
//
// The ink pales with time since a Section was touched, as the spine's does
// (`recencyOpacity`). The last sitting's work is a rule under the Section:
// words written or words cut. A Part file's own text is drawn first, dimmer,
// as the spine draws it.

/** The ink a Part file's own text is drawn in, as the spine's dim slice. */
const OWN_INK = 0.45;

export interface SpineRule {
  nodeId: string;
  title: string;
  words: number;
  /** Its share of the Part's column, 0 to 1. */
  share: number;
  /** The ink's strength, 0 to 1. */
  ink: number;
  /** True when it has no words: drawn as an outline. */
  empty: boolean;
  /** The last sitting's work on it. */
  mark: "written" | "cut" | null;
}

export interface SpineRulePart {
  nodeId: string;
  /** Two figures, as the contents number it: 01, 02. */
  label: string;
  title: string;
  /** Its words, in the counts' voice. */
  count: string;
  /** Its share of the whole width, as a fraction of every Part's. */
  share: number;
  rules: SpineRule[];
  /** The goal's room left in it, 0 to 1 of its column. */
  room: number;
  /** True for the Part the writer is in. */
  current: boolean;
}

export interface SpineRules {
  parts: SpineRulePart[];
  /** What a screen reader is told, as the spine tells it. */
  description: string;
}

const markOf = (delta: number | null): SpineRule["mark"] =>
  delta === null || delta === 0 ? null : delta > 0 ? "written" : "cut";

/**
 * The rules for a book, `current` being the file the writer is in, whose Part
 * is marked.
 */
export function spineRules(
  structure: DocumentStructure,
  stats: DocumentStats,
  goal: number | null,
  current: string | null,
): SpineRules {
  const parts = spineParts(structure, stats);
  const layout = layoutSpineGoal(parts, scaleFor(8), goal);
  const recency = new Map<string, number>();
  for (const part of parts)
    for (const section of part.sections)
      recency.set(section.nodeId, section.recency);

  const whole = layout.parts.reduce((t, p) => t + p.width, 0);
  const here = current ? partOf(structure, current) : null;
  return {
    parts: layout.parts.map((part) => {
      // The rules and the room share the Part's column; the gaps between
      // the rules are the page's to set, so they are left out of it.
      const field =
        part.bars.reduce((t, bar) => t + bar.width, 0) + part.emptyWidth;
      return {
        nodeId: part.nodeId,
        label: part.label,
        title: part.title,
        count: formatCount(part.totalWords),
        share: whole > 0 ? part.width / whole : 0,
        rules: part.bars
          .filter((bar) => bar.width > 0)
          .map((bar) => ({
            nodeId: bar.nodeId,
            title: bar.title,
            words: bar.words,
            share: field > 0 ? bar.width / field : 0,
            ink:
              bar.kind === "own"
                ? OWN_INK
                : recencyOpacity(recency.get(bar.nodeId) ?? 1),
            empty: bar.empty,
            mark: markOf(bar.delta),
          })),
        room: field > 0 ? part.emptyWidth / field : 0,
        current: here !== null && part.nodeId === here,
      };
    }),
    description: describeSpine(layout),
  };
}

/** The top-level Part holding `fileName`'s node, or the node when it is one. */
function partOf(structure: DocumentStructure, fileName: string): string | null {
  let node: { id: string } | null = nodeOfFile(structure, fileName);
  let top: string | null = null;
  while (node) {
    top = node.id;
    node = findParent(structure, node.id);
  }
  return top;
}
