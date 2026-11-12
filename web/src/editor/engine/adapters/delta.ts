// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The delta timeline: an append-only tree of semantic steps with a moving
// head. Undo walks the head back through its parents and redo walks forward
// through the child chain. An edit after undo parks the displaced future as
// a sibling subtree rather than destroying it; Ctrl+Z never walks a parked
// subtree.
//
// The document model is persistent, so in memory every state is a reference
// to the model's own objects and undo is a reference move, even for a
// million-character paste. The deltas exist because the journal must survive
// reload, and 2000 full snapshots would drown a manuscript: they serialize
// the timeline to disk and replay it on open.
//
// A delta is a paragraph-granular span, `{ para, before, after }`: a
// contiguous block of paragraphs replaced by another, where an empty array
// encodes an insertion or a removal, so no op kind is needed. Paragraphs
// serialize as the model's own shape, lossless with no codec, because the
// journal is machine-written and never hand-edited. The diff at push time is
// a reference-equality prefix and suffix walk over the two docs, so scattered
// edits collapse into one span. Application is always in sequence
// (checkpoint, replay, walk), so paragraph indexes never shift under an
// apply.
//
// The shell decides where the journal is written (`history/<file>.json`).
// This store exports and imports an opaque per-file journal: the head, the
// node graph by parent pointers (children and parked subtrees are derived),
// each node's wall-clock stamp for the rail's datetime label (optional on
// import), and full-doc checkpoints every `HISTORY_CHECKPOINT_INTERVAL` steps
// so hydration replays at most that many deltas. A fork point is
// checkpointed too, because the new branch's nearest old checkpoint may sit
// in the parked subtree.
//
// A journal is untrusted input. One that fails any shape check is dropped
// whole and never applied in part. The graph is capped, evicting parked
// subtrees first and never a state on the head's path. Nothing parsed is
// spread into a prototype-bearing object. Every materialized state's cursor
// is bounds-checked, so a crafted journal never lands an invalid cursor in
// the live session; materialization throws instead.
//
// `SnapshotHistory` is the differential test's oracle: the same port and
// contract suite, and the delta walk equals the snapshot walk under canonical
// serialization.

import type { Cursor, Doc, Paragraph } from "../domain/model";
import { isValidDoc, paraTextLength } from "../domain/invariants";
import {
  HISTORY_CHECKPOINT_INTERVAL,
  HISTORY_MAX_BYTES,
  HISTORY_MAX_STEPS,
  type EditorState,
  type HistoryCause,
  type HistoryStore,
} from "../ports/history";

const CAUSES: readonly string[] = ["type", "backspace", "del", "op"];

interface ParaDelta {
  para: number;
  before: Paragraph[];
  after: Paragraph[];
}

interface Edge {
  cause: HistoryCause;
  label: string | null;
  deltas: ParaDelta[];
}

interface TimelineNode {
  id: number;
  parent: number | null;
  /** The mainline continuation. Parked subtrees are children too (derived
   * from parents), but only the mainline child is reachable by redo. */
  child: number | null;
  edge: Edge | null;
  cursor: Cursor;
  /** The wall-clock moment this state was recorded, in ms since epoch:
   * display metadata, never state. Null only on a hydrated node whose
   * journal carried no valid stamp, and the walk never breaks on a missing
   * one. */
  ts: number | null;
  /** The state reference. Null after hydration until lazily materialized. */
  state: EditorState | null;
  /** A full-doc snapshot for bounded replay; null except on checkpoints. */
  checkpoint: EditorState | null;
}

type RawRecord = Record<string, unknown>;

function isRecord(x: unknown): x is RawRecord {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isNodeIdKey(key: string): boolean {
  if (key === "") return false;
  for (const ch of key) if (ch < "0" || ch > "9") return false;
  return true;
}

function isInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x);
}

/** A paragraph checked as a one-paragraph doc, so the document checker's
 * empty-runs and page-break rules apply, without the empty-doc violation a
 * bare `[]`, a legal insertion span, would trip. */
function isValidParagraph(x: unknown): x is Paragraph {
  return isRecord(x) && isValidDoc([x as unknown as Paragraph]);
}

function isValidCursorShape(x: unknown): x is Cursor {
  return (
    isRecord(x) &&
    isInt(x.para) &&
    x.para >= 0 &&
    isInt(x.offset) &&
    x.offset >= 0
  );
}

function cursorInBounds(doc: Doc, cursor: Cursor): boolean {
  if (cursor.para < 0 || cursor.para >= doc.length) return false;
  const length = paraTextLength(doc[cursor.para]);
  return cursor.offset >= 0 && cursor.offset <= length;
}

/** Deep structural equality of two paragraphs. The journal's before-spans
 * are deserialized objects, so replay matches by value, never identity. */
function paragraphsEqual(a: Paragraph, b: Paragraph): boolean {
  if (a.blockType !== b.blockType || a.alignment !== b.alignment) return false;
  if (a.runs.length !== b.runs.length) return false;
  for (let i = 0; i < a.runs.length; i++) {
    const ra = a.runs[i];
    const rb = b.runs[i];
    if (ra.text !== rb.text) return false;
    if (
      ra.format.bold !== rb.format.bold ||
      ra.format.italic !== rb.format.italic ||
      ra.format.monospace !== rb.format.monospace
    )
      return false;
  }
  return true;
}

/** The diff between two persistent docs as one contiguous span. Reference
 * equality walks the common prefix and suffix; everything between is the
 * change, and the span lengths say whether it inserts, removes or replaces. */
function diffDocs(before: Doc, after: Doc): ParaDelta[] {
  if (before === after) return [];
  let lo = 0;
  while (lo < before.length && lo < after.length && before[lo] === after[lo])
    lo++;
  let hiB = before.length - 1;
  let hiA = after.length - 1;
  while (hiB >= lo && hiA >= lo && before[hiB] === after[hiA]) {
    hiB--;
    hiA--;
  }
  if (lo > hiB && lo > hiA) return [];
  return [
    {
      para: lo,
      before: before.slice(lo, hiB + 1),
      after: after.slice(lo, hiA + 1),
    },
  ];
}

/** Apply an edge's deltas forward. Returns null when a before-span does not
 * match the document it is applied to, which is how hydration detects a
 * corrupt journal. Never mutates: the doc model is persistent. */
function applyEdge(doc: Doc, edge: Edge): Doc | null {
  let next = doc;
  for (const d of edge.deltas) {
    if (d.para < 0 || d.para + d.before.length > next.length) return null;
    for (let k = 0; k < d.before.length; k++) {
      if (!paragraphsEqual(next[d.para + k], d.before[k])) return null;
    }
    next = [
      ...next.slice(0, d.para),
      ...d.after,
      ...next.slice(d.para + d.before.length),
    ];
  }
  return next;
}

/** The journal's on-disk shape for one file: head, checkpoints, and the
 * node graph by parent pointers. */
interface JournalShape {
  head: number;
  checkpoints: Record<string, { doc: readonly Paragraph[] }>;
  nodes: Record<
    string,
    {
      parent: number | null;
      edge: Edge | null;
      cursor: Cursor;
      ts: number | null;
    }
  >;
}

/** A node as the journal writes it. */
function nodeEntry(node: TimelineNode): JournalShape["nodes"][string] {
  return {
    parent: node.parent,
    edge: node.edge,
    cursor: node.cursor,
    ts: node.ts,
  };
}

/**
 * The length of the journal `serialize` would write, kept as nodes come and
 * go, each node measured once. `JSON.stringify` writes an object as
 * `"key":value` members joined by commas, so the journal's length is its
 * fixed frame plus every member's length plus the commas between them.
 */
class JournalSize {
  private readonly members = new Map<number, { node: number; cp: number }>();
  private nodeBytes = 0;
  private cpBytes = 0;
  private cpCount = 0;
  private readonly frame: number;

  constructor(headDigits: number) {
    this.frame = '{"head":,"checkpoints":{},"nodes":{}}'.length + headDigits;
  }

  add(node: TimelineNode): void {
    const key = JSON.stringify(String(node.id)).length + 1;
    const member = {
      node: key + JSON.stringify(nodeEntry(node)).length,
      cp:
        node.checkpoint === null
          ? 0
          : key + JSON.stringify({ doc: node.checkpoint.doc }).length,
    };
    this.members.set(node.id, member);
    this.nodeBytes += member.node;
    this.cpBytes += member.cp;
    if (member.cp > 0) this.cpCount++;
  }

  remove(node: TimelineNode): void {
    const member = this.members.get(node.id);
    if (member === undefined) return;
    this.members.delete(node.id);
    this.nodeBytes -= member.node;
    this.cpBytes -= member.cp;
    if (member.cp > 0) this.cpCount--;
  }

  /** The length with every measured node in. */
  get total(): number {
    return this.lengthOf(
      this.members.size,
      this.nodeBytes,
      this.cpCount,
      this.cpBytes,
    );
  }

  /** The length with `left` out. */
  without(left: readonly TimelineNode[]): number {
    let nodes = this.members.size;
    let nodeBytes = this.nodeBytes;
    let cps = this.cpCount;
    let cpBytes = this.cpBytes;
    for (const node of left) {
      const member = this.members.get(node.id);
      if (member === undefined) continue;
      nodes--;
      nodeBytes -= member.node;
      if (member.cp > 0) {
        cps--;
        cpBytes -= member.cp;
      }
    }
    return this.lengthOf(nodes, nodeBytes, cps, cpBytes);
  }

  private lengthOf(
    nodes: number,
    nodeBytes: number,
    cps: number,
    cpBytes: number,
  ): number {
    return (
      this.frame +
      nodeBytes +
      Math.max(0, nodes - 1) +
      cpBytes +
      Math.max(0, cps - 1)
    );
  }
}

export class DeltaTimeline implements HistoryStore {
  private nodes = new Map<number, TimelineNode>();
  private head: number | null = null;
  private nextId = 0;
  private stepsSinceCheckpoint = 0;
  constructor(private readonly now: () => number = Date.now) {}

  push(
    before: EditorState,
    after: EditorState,
    cause: HistoryCause,
    merge: boolean,
    label?: string,
  ): void {
    if (this.head === null) {
      this.nodes.set(0, {
        id: 0,
        parent: null,
        child: null,
        edge: null,
        cursor: before.cursor,
        ts: this.now(),
        state: before,
        checkpoint: before,
      });
      this.head = 0;
      this.nextId = 1;
      this.stepsSinceCheckpoint = 0;
    }
    const headNode = this.nodes.get(this.head) as TimelineNode;

    // A merge folds into the current node: `before` stays the burst start
    // (the parent), `after` advances, and the folded step undoes as one.
    // The root holds no edge to fold into, so a merge at the root becomes a
    // fresh node. A merge with a redo future also becomes a fresh node,
    // because folding would advance the head's state under the future's edge
    // and leave a redo walk whose edge does not apply. Any push, merged or
    // not, parks the displaced future and makes redo null.
    if (
      merge &&
      headNode.parent !== null &&
      headNode.edge !== null &&
      headNode.child === null
    ) {
      // The whole edge is recomputed against the parent's document, never
      // patched from the burst's last two states. A step in the burst that
      // joins two paragraphs shifts every later paragraph index, so a patched
      // edge would key a stale index, fail to replay against the parent, and
      // drop the whole journal on the next open.
      const parent = this.nodes.get(headNode.parent) as TimelineNode;
      const parentDoc = (parent.state ?? this.stateOf(parent.id)).doc;
      const delta = diffDocs(parentDoc, after.doc);
      if (delta.length === 0) {
        // A burst that nets to no change, such as a composition typed and
        // deleted back to nothing, leaves no step: an empty edge would get a
        // rail row and an undo that does nothing visible. The merge condition
        // guarantees this head has no child, so the node collapses into its
        // parent, whose document is already the current one.
        this.nodes.delete(headNode.id);
        // A dangling child would crash the export's terminal walk.
        parent.child = null;
        this.head = headNode.parent;
        this.stepsSinceCheckpoint = Math.max(0, this.stepsSinceCheckpoint - 1);
        return;
      }
      headNode.edge.deltas = delta;
      headNode.cursor = after.cursor;
      headNode.state = after;
      headNode.ts = this.now();
      // A fold into a checkpoint node refreshes the checkpoint. A stale
      // full-doc snapshot would hydrate a head behind the live state, and the
      // session's tail reconcile would then drop the whole journal on reload.
      if (headNode.checkpoint !== null) headNode.checkpoint = after;
      return;
    }

    // The push's `before` must be the store's current state, checked by the
    // document reference: cursor objects are minted per selection, but the
    // persistent doc object is stable, so a push from a stale doc is a
    // session bug. The parent's state is the `before` doc, which is why undo
    // returns the state pushed by identity.
    if (headNode.state === null || headNode.state.doc !== before.doc) {
      throw new Error("history push is not against the current state");
    }
    const delta = diffDocs(before.doc, after.doc);
    if (delta.length === 0) {
      throw new Error("history push with no change");
    }

    const id = this.nextId++;
    const node: TimelineNode = {
      id,
      parent: headNode.id,
      child: null,
      edge: { cause, label: label ?? null, deltas: delta },
      cursor: after.cursor,
      ts: this.now(),
      state: after,
      checkpoint: null,
    };

    // Park the displaced future. The old child keeps its parent pointer, so
    // it stays a child of the fork point that is not the mainline child. The
    // fork point is checkpointed so the new branch's replay stays bounded
    // while the old branch's checkpoints are off the head path.
    if (headNode.child !== null) {
      headNode.checkpoint = headNode.state;
      this.stepsSinceCheckpoint = 0;
    }
    headNode.child = id;
    this.nodes.set(id, node);
    this.head = id;

    this.stepsSinceCheckpoint++;
    if (this.stepsSinceCheckpoint >= HISTORY_CHECKPOINT_INTERVAL) {
      node.checkpoint = after;
      this.stepsSinceCheckpoint = 0;
    }
    this.truncate();
  }

  undo(): EditorState | null {
    if (!this.canUndo) return null;
    const node = this.nodes.get(this.head as number) as TimelineNode;
    this.head = node.parent;
    return this.stateOf(this.head as number);
  }

  redo(): EditorState | null {
    if (!this.canRedo) return null;
    const node = this.nodes.get(this.head as number) as TimelineNode;
    this.head = node.child;
    return this.stateOf(this.head as number);
  }

  nextUndoLabel(): string | null {
    if (!this.canUndo) return null;
    return (
      (this.nodes.get(this.head as number) as TimelineNode).edge?.label ?? null
    );
  }

  nextRedoLabel(): string | null {
    if (!this.canRedo) return null;
    const head = this.nodes.get(this.head as number) as TimelineNode;
    return (
      (this.nodes.get(head.child as number) as TimelineNode).edge?.label ?? null
    );
  }

  /** The node `depth` steps back from the head, or null when the depth is not
   * a walkable integer. Every look-back refuses rather than clamps, so a NaN
   * depth answers null, never the head. */
  private nodeAtDepth(depth: number): TimelineNode | null {
    if (!Number.isInteger(depth) || depth < 0) return null;
    if (this.head === null) return null;
    if (depth > this.undoDepth()) return null;
    let node: TimelineNode | null = this.nodes.get(this.head) as TimelineNode;
    for (let i = 0; i < depth; i++) {
      if (node === null) return null;
      node = (this.nodes.get(node.parent as number) as TimelineNode) ?? null;
    }
    return node;
  }

  peekBack(depth: number): EditorState | null {
    const node = this.nodeAtDepth(depth);
    if (node === null) return null;
    return this.stateOf(node.id);
  }

  peekTimestamp(depth: number): number | null {
    // A parent-chain walk with no state materialization, so a corrupt state
    // never crashes the label.
    return this.nodeAtDepth(depth)?.ts ?? null;
  }

  undoDepth(): number {
    if (this.head === null) return 0;
    let depth = 0;
    let cur = (this.nodes.get(this.head) as TimelineNode).parent;
    while (cur !== null) {
      depth++;
      cur = (this.nodes.get(cur) as TimelineNode).parent;
    }
    return depth;
  }

  redoDepth(): number {
    if (this.head === null) return 0;
    let depth = 0;
    let cur = (this.nodes.get(this.head) as TimelineNode).child;
    while (cur !== null) {
      depth++;
      cur = (this.nodes.get(cur) as TimelineNode).child;
    }
    return depth;
  }

  get hasParkedSiblings(): boolean {
    if (this.head === null) return false;
    const head = this.nodes.get(this.head) as TimelineNode;
    if (head.parent === null) return false;
    // The fork point's children are the mainline child and any parked
    // subtrees, so more than one child of the head's parent means the head
    // has a parked sibling.
    let children = 0;
    for (const node of this.nodes.values()) {
      if (node.parent === head.parent) children++;
    }
    return children > 1;
  }

  get canUndo(): boolean {
    if (this.head === null) return false;
    return (this.nodes.get(this.head) as TimelineNode).parent !== null;
  }

  get canRedo(): boolean {
    if (this.head === null) return false;
    return (this.nodes.get(this.head) as TimelineNode).child !== null;
  }

  clear(): void {
    this.nodes.clear();
    this.head = null;
    this.nextId = 0;
    this.stepsSinceCheckpoint = 0;
  }

  exportJournal(): string | null {
    if (this.nodes.size === 0 || this.head === null) return null;
    // The floor is checked before any eviction: if the head's state alone
    // cannot fit in a journal, no eviction can help, so the export returns
    // null with the in-memory timeline untouched.
    const terminal = this.nodes.get(this.head) as TimelineNode;
    const terminalDoc = (terminal.state ?? this.stateOf(terminal.id)).doc;
    const minimal = JSON.stringify({
      head: terminal.id,
      checkpoints: {
        [String(terminal.id)]: { doc: terminalDoc },
      },
      nodes: {
        [String(terminal.id)]: {
          parent: null,
          edge: terminal.edge,
          cursor: terminal.cursor,
          ts: terminal.ts,
        },
      },
    });
    if (minimal.length > HISTORY_MAX_BYTES) {
      // The checkpoint alone may fit when the terminal's own edge does not,
      // since one large edit (a big Replace All) can exceed the cap by
      // itself. The oversized edge is dropped and a bare checkpoint of the
      // current doc exported: the writer loses the undo of that one step,
      // never the manuscript.
      const bare = JSON.stringify({
        head: terminal.id,
        checkpoints: {
          [String(terminal.id)]: { doc: terminalDoc },
        },
        nodes: {
          [String(terminal.id)]: {
            parent: null,
            edge: null,
            cursor: terminal.cursor,
            ts: terminal.ts,
          },
        },
      });
      return bare.length > HISTORY_MAX_BYTES ? null : bare;
    }

    // The byte cap. Each node's share of the journal is measured once, and
    // the eviction keeps the running total, so the journal is serialized
    // once, after it fits. In order: parked subtrees are evicted; then the
    // redo future is left out of the journal but kept in memory, since a
    // reopened journal holds it only as a parked branch; then the oldest
    // undo steps are evicted, never the head. The writer loses depth only;
    // content is never invented or destroyed.
    const size = new JournalSize(String(this.head).length);
    for (const node of this.nodes.values()) size.add(node);
    while (size.total > HISTORY_MAX_BYTES) {
      const parked = this.dropOldestParked();
      if (parked !== null) {
        for (const node of parked) size.remove(node);
        continue;
      }
      const future = this.redoChain();
      const head = this.nodes.get(this.head as number) as TimelineNode;
      if (size.without(future) <= HISTORY_MAX_BYTES || head.parent === null) {
        return this.serialize(new Set(future.map((node) => node.id)));
      }
      const { removed, root } = this.dropRoot();
      for (const node of removed) size.remove(node);
      // The new root's entry changed: no parent, and a checkpoint.
      size.remove(root);
      size.add(root);
    }
    return this.serialize();
  }

  importJournal(json: string): EditorState | null {
    try {
      if (typeof json !== "string" || json.length > HISTORY_MAX_BYTES) {
        return null;
      }
      const raw: unknown = JSON.parse(json);
      if (!isRecord(raw)) return null;
      if (!isRecord(raw.nodes) || !isRecord(raw.checkpoints)) return null;
      if (typeof raw.head !== "number" || !isInt(raw.head)) return null;
      if (Object.keys(raw.nodes).length === 0) return null;
      if (Object.keys(raw.nodes).length > HISTORY_MAX_STEPS + 1) return null;

      // Explicit field reads; prototype-pollution keys fail the id grammar
      // and never become map keys.
      const map = new Map<number, TimelineNode>();
      for (const [key, rawNode] of Object.entries(raw.nodes)) {
        if (!isNodeIdKey(key)) return null;
        const id = Number(key);
        if (map.has(id)) return null;
        if (!isRecord(rawNode)) return null;
        if (!isValidCursorShape(rawNode.cursor)) return null;
        if (rawNode.parent !== null && !isInt(rawNode.parent)) return null;
        if (rawNode.parent !== null && !isNodeIdKey(String(rawNode.parent))) {
          return null;
        }
        const edge = this.parseEdge(rawNode.edge);
        if (rawNode.edge !== null && edge === null) return null;
        // A missing or malformed stamp (wrong type, negative, fractional)
        // becomes null rather than a rejection: a bad display hint must not
        // destroy the writer's timeline.
        const ts =
          isInt(rawNode.ts) && (rawNode.ts as number) >= 0
            ? (rawNode.ts as number)
            : null;
        map.set(id, {
          id,
          parent: rawNode.parent,
          child: null,
          edge,
          cursor: rawNode.cursor,
          ts,
          state: null,
          checkpoint: null,
        });
      }

      // Graph integrity: one root, every parent known, the head known, and
      // no cycle on the head path.
      let rootId: number | null = null;
      for (const node of map.values()) {
        if (node.parent === null) {
          if (rootId !== null) return null;
          rootId = node.id;
        } else if (!map.has(node.parent)) {
          return null;
        }
      }
      if (rootId === null) return null;
      if (!map.has(raw.head)) return null;
      let cur: number | null = raw.head;
      const visited = new Set<number>();
      while (cur !== null) {
        if (visited.has(cur)) return null;
        visited.add(cur);
        cur = (map.get(cur) as TimelineNode).parent;
      }

      // Checkpoints name known nodes and hold valid docs. An empty doc is
      // legal: the root state is whatever the first push carried, and the
      // model allows the empty array at the codec boundary.
      for (const [key, cp] of Object.entries(raw.checkpoints)) {
        if (!isNodeIdKey(key) || !map.has(Number(key))) return null;
        if (!isRecord(cp) || !Array.isArray(cp.doc)) return null;
        for (const para of cp.doc) {
          if (!isValidParagraph(para)) return null;
        }
        const node = map.get(Number(key)) as TimelineNode;
        node.checkpoint = {
          doc: cp.doc,
          cursor: node.cursor,
        };
      }

      // The nearest checkpoint ancestor of the head, and the nodes to replay
      // from it. A journal with no checkpoint on the head path is refused.
      const path: TimelineNode[] = [];
      cur = raw.head;
      let anchor: TimelineNode | null = null;
      while (cur !== null) {
        const node = map.get(cur) as TimelineNode;
        if (raw.checkpoints[String(node.id)]) {
          anchor = node;
          break;
        }
        path.push(node);
        cur = node.parent;
      }
      if (anchor === null) return null;
      // Replay parent to child, materializing every state on the path. Each
      // state's doc is its own array, sharing paragraphs with its neighbours
      // as the live model does.
      const anchorDoc = (
        raw.checkpoints[String(anchor.id)] as {
          doc: Paragraph[];
        }
      ).doc;
      // The anchor's cursor must land inside its own doc, as every replayed
      // node's must. The one exception is the store's own bootstrap shape, an
      // empty doc with the {0,0} cursor; a real journal's root is the parsed
      // document, which is never empty.
      const anchorCursorValid =
        anchorDoc.length === 0
          ? anchor.cursor.para === 0 && anchor.cursor.offset === 0
          : cursorInBounds(anchorDoc, anchor.cursor);
      if (!anchorCursorValid) return null;
      anchor.state = { doc: anchorDoc, cursor: anchor.cursor };
      let doc: Doc = anchorDoc;
      path.reverse();
      for (const node of path) {
        const edge = node.edge as Edge;
        const next = applyEdge(doc, edge);
        if (next === null) return null;
        doc = next;
        if (!isValidDoc(doc)) return null;
        if (!cursorInBounds(doc, node.cursor)) return null;
        node.state = { doc, cursor: node.cursor };
      }

      // Mainline child pointers are rebuilt along the head path only. Redo
      // never reaches inside a parked subtree, so its child pointers stay
      // null; the fork tick counts siblings and never walks them.
      let prev = map.get(raw.head) as TimelineNode;
      cur = prev.parent;
      while (cur !== null) {
        const node = map.get(cur) as TimelineNode;
        node.child = prev.id;
        prev = node;
        cur = node.parent;
      }

      const headNode = map.get(raw.head) as TimelineNode;
      if (headNode.state === null) return null;
      this.nodes = map;
      this.head = raw.head;
      // Ids from a foreign journal are not dense; the next created node must
      // clear the largest of them.
      let maxId = 0;
      for (const id of map.keys()) if (id > maxId) maxId = id;
      this.nextId = maxId + 1;
      this.stepsSinceCheckpoint = path.length;
      return headNode.state;
    } catch {
      return null;
    }
  }

  private parseEdge(raw: unknown): Edge | null {
    if (raw === null) return null;
    if (!isRecord(raw)) return null;
    if (typeof raw.cause !== "string" || !CAUSES.includes(raw.cause)) {
      return null;
    }
    if (raw.label !== null && typeof raw.label !== "string") return null;
    if (!Array.isArray(raw.deltas)) return null;
    let lastPara = -1;
    for (const d of raw.deltas) {
      if (!isRecord(d)) return null;
      if (!isInt(d.para) || d.para < 0 || d.para <= lastPara) return null;
      if (!Array.isArray(d.before) || !Array.isArray(d.after)) return null;
      for (const para of d.before) if (!isValidParagraph(para)) return null;
      for (const para of d.after) if (!isValidParagraph(para)) return null;
      lastPara = d.para;
    }
    return {
      cause: raw.cause as HistoryCause,
      label: raw.label as string | null,
      deltas: raw.deltas as ParaDelta[],
    };
  }

  /** The journal, leaving out the nodes in `exclude`. */
  private serialize(exclude?: ReadonlySet<number>): string {
    const nodes: JournalShape["nodes"] = {};
    const checkpoints: JournalShape["checkpoints"] = {};
    for (const node of this.nodes.values()) {
      if (exclude?.has(node.id)) continue;
      nodes[String(node.id)] = nodeEntry(node);
      if (node.checkpoint !== null) {
        checkpoints[String(node.id)] = { doc: node.checkpoint.doc };
      }
    }
    const journal: JournalShape = {
      head: this.head as number,
      checkpoints,
      nodes,
    };
    return JSON.stringify(journal);
  }

  /** A node's state, materialized lazily from the nearest checkpoint.
   * Throws on a state a corrupt journal cannot produce validly. */
  private stateOf(id: number): EditorState {
    const node = this.nodes.get(id) as TimelineNode;
    if (node.state !== null) return node.state;
    const path: TimelineNode[] = [];
    let cur = node;
    while (true) {
      if (cur.state !== null) break;
      if (cur.checkpoint !== null) {
        // A checkpoint node off the materialized head path: its state is the
        // checkpoint's own, and the replay starts here. Its cursor must land
        // inside its own doc, as at hydration, with the bootstrap shape
        // allowed.
        const cursorValid =
          cur.checkpoint.doc.length === 0
            ? cur.cursor.para === 0 && cur.cursor.offset === 0
            : cursorInBounds(cur.checkpoint.doc, cur.cursor);
        if (!cursorValid) {
          throw new Error("corrupt journal state");
        }
        cur.state = { doc: cur.checkpoint.doc, cursor: cur.checkpoint.cursor };
        break;
      }
      path.push(cur);
      const parent = this.nodes.get(cur.parent as number);
      if (parent === undefined) {
        // Every node the store builds has a checkpoint ancestor: the root is
        // checkpointed, a fork checkpoints its point, and truncation removes
        // whole subtrees. Only a hand-crafted journal reaches this.
        throw new Error("corrupt timeline: no state to walk to");
      }
      cur = parent;
    }
    let doc = cur.state.doc;
    path.reverse();
    for (const n of path) {
      const edge = n.edge as Edge;
      const next = applyEdge(doc, edge);
      if (
        next === null ||
        !isValidDoc(next) ||
        !cursorInBounds(next, n.cursor)
      ) {
        // A journal that passed hydration but fails here carries a crafted
        // cursor or delta on a node off the head path.
        throw new Error("corrupt journal state");
      }
      doc = next;
      n.state = { doc, cursor: n.cursor };
    }
    node.state = { doc, cursor: node.cursor };
    return node.state;
  }

  private dropOne(): void {
    if (this.dropOldestParked() === null) this.dropRoot();
  }

  /** The head's redo future, nearest first. */
  private redoChain(): TimelineNode[] {
    const chain: TimelineNode[] = [];
    let cur = (this.nodes.get(this.head as number) as TimelineNode).child;
    while (cur !== null) {
      const node = this.nodes.get(cur) as TimelineNode;
      chain.push(node);
      cur = node.child;
    }
    return chain;
  }

  /**
   * Evict the oldest parked subtree, never a state undo or redo can reach
   * from the head: evicting a redo step would leave the head's child pointer
   * dangling and crash the redo walk. Returns the evicted nodes, or null
   * when nothing is parked.
   */
  private dropOldestParked(): TimelineNode[] | null {
    const protectedSet = new Set<number>();
    let cur = this.head;
    while (cur !== null) {
      protectedSet.add(cur);
      cur = (this.nodes.get(cur) as TimelineNode).parent;
    }
    cur = (this.nodes.get(this.head as number) as TimelineNode).child;
    while (cur !== null) {
      protectedSet.add(cur);
      cur = (this.nodes.get(cur) as TimelineNode).child;
    }
    let oldestParked: number | null = null;
    for (const node of this.nodes.values()) {
      if (protectedSet.has(node.id)) continue;
      if (oldestParked !== null && node.id >= oldestParked) continue;
      oldestParked = node.id;
    }
    return oldestParked === null ? null : this.removeSubtree(oldestParked);
  }

  /**
   * On the mainline, drop the root and the parked subtrees hanging off it,
   * the oldest states of all. The mainline child becomes the new root,
   * checkpointed with its live state. Replay from it stays correct, because
   * the survivor's edge holds its own before-spans and nothing needs the
   * dropped ancestor's state again.
   *
   * The head is the session's current state, and the next push is checked
   * against it, so the root is dropped only while it is not the head.
   */
  private dropRoot(): { removed: TimelineNode[]; root: TimelineNode } {
    const root = this.findRoot();
    if (root.id === this.head) throw new Error("the head is never evicted");
    const next = this.nodes.get(root.child as number) as TimelineNode;
    next.parent = null;
    next.checkpoint = next.state ?? this.stateOf(next.id);
    this.stepsSinceCheckpoint = 0;
    return { removed: this.removeSubtree(root.id), root: next };
  }

  private findRoot(): TimelineNode {
    for (const node of this.nodes.values()) {
      if (node.parent === null) return node;
    }
    throw new Error("timeline has no root");
  }

  /** Remove a node and its descendants; returns the removed nodes. */
  private removeSubtree(id: number): TimelineNode[] {
    const removed: TimelineNode[] = [];
    const pending = [id];
    while (pending.length > 0) {
      const cur = pending.pop() as number;
      for (const node of this.nodes.values()) {
        if (node.parent === cur) pending.push(node.id);
      }
      const node = this.nodes.get(cur);
      if (node !== undefined) removed.push(node);
      this.nodes.delete(cur);
    }
    return removed;
  }

  private truncate(): void {
    // The cap counts states, root included; the walk's depth is one less,
    // which is the cap in undo steps.
    while (this.nodes.size > HISTORY_MAX_STEPS + 1) this.dropOne();
  }
}
