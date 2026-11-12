// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Align, Inline } from "./source";

// The draft: the book as the app will hold it. The plan, folded into a tree
// that obeys the Golden Rule: every list of children, the root's included, is
// all Parts or all Sections. Its text is already in the shape the engine keeps
// (paragraphs, two heading levels, page breaks; bold, italic, monospace), so
// the host serialises it with the engine's own codec and nothing is
// translated twice.

export type DraftBlockType = "paragraph" | "h1" | "h2" | "pagebreak";

export interface DraftRun {
  text: string;
  bold: boolean;
  italic: boolean;
  monospace: boolean;
}

export interface DraftParagraph {
  blockType: DraftBlockType;
  alignment: Align;
  runs: DraftRun[];
}

export interface DraftNode {
  kind: "part" | "section";
  title: string;
  /** The node's own text. A Part holds text of its own, before its children. */
  paragraphs: DraftParagraph[];
  /** Parts only; homogeneous. */
  children: DraftNode[];
}

/**
 * A comment's place in the final text: the node, an offset range in the node's
 * text (paragraphs joined by "\n"), and a W3C TextQuote, the quoted words
 * with 32 characters either side, which is what lets an anchor be found
 * again after the prose around it changes.
 */
export interface DraftCommentAnchor {
  /** The node's index in pre-order, the way the host numbers ids. */
  node: number;
  start: { paragraph: number; offset: number };
  end: { paragraph: number; offset: number };
  quote: { exact: string; prefix: string; suffix: string };
}

export interface DraftComment {
  anchor: DraftCommentAnchor | null;
  body: Inline[][];
  author?: string;
  date?: string;
  parentId?: string;
  sourceId: string;
  resolved?: boolean;
}

export interface Draft {
  roots: DraftNode[];
  comments: DraftComment[];
}

/**
 * Throws when any children list mixes Parts and Sections, or a Section has
 * children.
 */
export function assertHomogeneous(nodes: readonly DraftNode[]): void {
  const check = (list: readonly DraftNode[], where: string) => {
    if (list.length > 1 && list.some((n) => n.kind !== list[0].kind))
      throw new Error(`mixed children under ${where}`);
    for (const node of list) {
      if (node.kind === "section" && node.children.length)
        throw new Error(`section "${node.title}" holds children`);
      check(node.children, node.title);
    }
  };
  check(nodes, "the root");
}

/** Every node, parents before children: the order ids are given in. */
export function preorder(nodes: readonly DraftNode[]): DraftNode[] {
  const out: DraftNode[] = [];
  const visit = (list: readonly DraftNode[]) => {
    for (const node of list) {
      out.push(node);
      visit(node.children);
    }
  };
  visit(nodes);
  return out;
}
