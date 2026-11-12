// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { parseSnapshotName, snapshotFileName, toSlug } from "./naming";
import {
  allFileNames,
  childrenOf,
  findNode,
  findParent,
  isDescendant,
  walk,
} from "./structure";
import type { DocNode, DocumentStructure, NodeKind, Snapshot } from "./types";
import { escapeRegExp } from "../text/regExp";

// ── Structural operations ────────────────────────────────────────────────────
//
// Pure: a structure in, a new structure out, nothing shared with the original
// along the path that changed.
//
// The rule lives in `canDrop` and `canAdd`. Every affordance in the panel asks
// one of them before it renders, so the interface cannot express a violation.
//
// Nodes are identified by their stable id (`EL1`); files appear in these
// signatures only where a snapshot op names one. The file moves an op implies
// belong to the shell's commit funnel, which owns files-first-yaml-second and
// rollback, and each op returns the fact the file step needs (a `fileMoves`
// pair, a `copyFrom`, a dropped file) so the shell never re-derives it.

/** Rebuild the tree with `fn` applied to one container's children. */
function updateChildren(
  structure: DocumentStructure,
  containerId: string | null,
  fn: (children: DocNode[]) => DocNode[],
): DocumentStructure {
  if (containerId === null)
    return { ...structure, children: fn(structure.children) };

  const rewrite = (nodes: DocNode[]): DocNode[] =>
    nodes.map((node) => {
      if (node.kind !== "part") return node;
      if (node.id === containerId)
        return { ...node, children: fn(node.children) };
      return { ...node, children: rewrite(node.children) };
    });

  return { ...structure, children: rewrite(structure.children) };
}

/**
 * Rebuild the tree with `fn` applied to the one node named `id`. Every
 * node-edit operation shares this walk, so a rename and a snapshot op cannot
 * drift apart in how they replace a node.
 */
function updateNode(
  structure: DocumentStructure,
  id: string,
  fn: (node: DocNode) => DocNode,
): DocumentStructure {
  return { ...structure, children: rewrite(structure.children, id, fn) };
}

function rewrite(
  nodes: DocNode[],
  id: string,
  fn: (node: DocNode) => DocNode,
): DocNode[] {
  return nodes.map((node) => {
    const replaced = node.id === id ? fn(node) : node;
    return replaced.kind === "part"
      ? { ...replaced, children: rewrite(replaced.children, id, fn) }
      : replaced;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── The Golden Rule ──────────────────────────────────────────────────────────

/**
 * May `kind` be added to this container? True when the container is the root or
 * a Part, and it is either empty or already holds that kind.
 */
export function canAdd(
  structure: DocumentStructure,
  containerId: string | null,
  kind: NodeKind,
): boolean {
  if (containerId !== null) {
    const container = findNode(structure, containerId);
    if (!container || container.kind !== "part") return false;
  }
  const children = childrenOf(structure, containerId);
  return children.length === 0 || children[0].kind === kind;
}

/**
 * May the dragged node land in this container? One node is a group of one;
 * the rule lives in `canDropAll`.
 */
export function canDrop(
  structure: DocumentStructure,
  draggedId: string,
  containerId: string | null,
): boolean {
  return canDropAll(structure, [draggedId], containerId);
}

/**
 * May a whole selection land in this container, as one block?
 *
 * The rule of `canAdd`, plus the two things only a move can get wrong, held
 * for every node at once:
 * - the group is one kind, because it lands in one container and the Golden
 *   Rule forbids a container of mixed kinds;
 * - the container is none of the moving nodes and sits inside none of them;
 * - its contents are judged with every moving node taken out, so moving a
 *   Section within its own Part stays legal, and lifting all of a Part's
 *   Sections leaves it empty, which takes either kind.
 *
 * The ids go through `normalizeSelection` first, so a Part ticked together
 * with something inside it is judged as the Part alone, which is what moves.
 */
export function canDropAll(
  structure: DocumentStructure,
  draggedIds: readonly string[],
  containerId: string | null,
): boolean {
  const ids = normalizeSelection(structure, draggedIds);
  if (ids.length === 0) return false;
  const kinds = new Set(ids.map((id) => findNode(structure, id)?.kind));
  if (kinds.size !== 1) return false;
  const [kind] = kinds;

  if (containerId !== null) {
    if (ids.includes(containerId)) return false;
    const container = findNode(structure, containerId);
    if (!container || container.kind !== "part") return false;
    if (ids.some((id) => isDescendant(structure, id, containerId)))
      return false;
  }

  const moving = new Set(ids);
  const siblings = childrenOf(structure, containerId).filter(
    (c) => !moving.has(c.id),
  );
  return siblings.length === 0 || siblings[0].kind === kind;
}

/**
 * A selection as a move must read it: live ids only, in document order, with
 * every id that sits inside another selected node dropped.
 *
 * Document order, not ticking order, because the block lands as the book had
 * it: ticking chapter 7 before chapter 2 must not swap them. A Part carries
 * its whole subtree, so something inside a ticked Part already moves with it;
 * naming it twice would pull it out of its Part and land it beside it.
 */
export function normalizeSelection(
  structure: DocumentStructure,
  ids: readonly string[],
): string[] {
  const wanted = new Set(ids);
  const picked: string[] = [];
  const visit = (nodes: DocNode[]): void => {
    for (const node of nodes) {
      if (wanted.has(node.id)) {
        // Taken whole: nothing under it is looked at, so a covered id never
        // reaches the list.
        picked.push(node.id);
        continue;
      }
      if (node.kind === "part") visit(node.children);
    }
  };
  visit(structure.children);
  return picked;
}

/**
 * May a node that is not in the structure land in this container? The bin's
 * restore drops a removed subtree back into the document, so the node is
 * handed in whole rather than looked up by id. The rule of `canDrop`, minus
 * the two checks only a move inside the tree can trip: a node outside the tree
 * cannot be its own container or sit inside its own subtree.
 */
export function canDropNode(
  structure: DocumentStructure,
  dragged: DocNode,
  containerId: string | null,
): boolean {
  if (containerId !== null) {
    const container = findNode(structure, containerId);
    if (!container || container.kind !== "part") return false;
  }

  const siblings = childrenOf(structure, containerId);
  return siblings.length === 0 || siblings[0].kind === dragged.kind;
}

/**
 * May a removed subtree be restored into this container? `canDropNode` first,
 * then the two things only a restore can get wrong:
 * - The incoming ids must not collide with live ones, or the nodes would be
 *   indistinguishable. Ids are never reused (the counter scans the removed
 *   list too), so this guards against hand-edited yaml.
 * - The incoming file names must not collide with live ones. The restored
 *   files move back into `document/`, where a clash would overwrite a real
 *   file and leave the yaml with two entries for one name, which the
 *   validator refuses on the next open. File names carry the node's id, so
 *   only a hand-edited record can clash here.
 */
export function canRestore(
  structure: DocumentStructure,
  dragged: DocNode,
  containerId: string | null,
): boolean {
  if (!canDropNode(structure, dragged, containerId)) return false;

  // The live ids only: `allIds` also covers the removed list, which holds the
  // node being restored, and a restore must not trip over itself.
  const liveIds = new Set<string>();
  walk(structure.children, (node) => liveIds.add(node.id));
  const incomingIds: string[] = [dragged.id];
  if (dragged.kind === "part") {
    walk(dragged.children, (node) => incomingIds.push(node.id));
  }
  if (incomingIds.some((id) => liveIds.has(id))) return false;

  const live = new Set(allFileNames(structure).map((n) => n.toLowerCase()));
  const incoming = [dragged.adopted, ...dragged.snapshots.map((s) => s.file)];
  if (dragged.kind === "part") {
    walk(dragged.children, (node) => {
      incoming.push(node.adopted);
      for (const snap of node.snapshots) incoming.push(snap.file);
    });
  }
  return incoming.every((name) => !live.has(name.toLowerCase()));
}

// ── Operations ───────────────────────────────────────────────────────────────

/** SHA-256 hex of the canonical empty file, where every fresh snapshot starts. */
export const EMPTY_CONTENT_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * A new Part or Section. A node is born with one snapshot, its adopted
 * `.00` file, empty, so the validator's invariants hold from the first open.
 */
export function newNode(
  kind: NodeKind,
  id: string,
  title: string,
  file: string,
  created: string,
): DocNode {
  const snapshots: Snapshot[] = [
    { file, title: `${title} 1`, created, contentHash: EMPTY_CONTENT_HASH },
  ];
  return kind === "part"
    ? { kind: "part", id, title, adopted: file, snapshots, children: [] }
    : { kind: "section", id, title, adopted: file, snapshots };
}

export function insertNode(
  structure: DocumentStructure,
  node: DocNode,
  containerId: string | null,
  index: number,
): DocumentStructure {
  return insertNodes(structure, [node], containerId, index);
}

/** `insertNode` for a block: the nodes land side by side, in given order. */
function insertNodes(
  structure: DocumentStructure,
  nodes: DocNode[],
  containerId: string | null,
  index: number,
): DocumentStructure {
  return updateChildren(structure, containerId, (children) => {
    const at = clamp(index, 0, children.length);
    return [...children.slice(0, at), ...nodes, ...children.slice(at)];
  });
}

export function removeNode(
  structure: DocumentStructure,
  id: string,
): DocumentStructure {
  const parent = findParent(structure, id);
  return updateChildren(structure, parent ? parent.id : null, (children) =>
    children.filter((c) => c.id !== id),
  );
}

/**
 * Take a node and its whole subtree out of the document and into the
 * `removed` list, the bin. The subtree is kept verbatim (children, their
 * order, ids, snapshots, summary bindings), so `restoreFromRemoved` puts the
 * node back as it was. The caller moves every snapshot file of the subtree;
 * this only rewrites the structure.
 */
export function removeToRemoved(
  structure: DocumentStructure,
  id: string,
): { structure: DocumentStructure; removed: DocNode | null } {
  const parent = findParent(structure, id);
  const containerId = parent ? parent.id : null;
  const node = childrenOf(structure, containerId).find((c) => c.id === id);
  if (!node) return { structure, removed: null };

  const next = removeNode(structure, id);
  return {
    structure: { ...next, removed: [...(next.removed ?? []), node] },
    removed: node,
  };
}

/**
 * Put a removed subtree back into the document, and drop it from the `removed`
 * list. The node keeps whatever structure it was removed with.
 */
export function restoreFromRemoved(
  structure: DocumentStructure,
  id: string,
  containerId: string | null,
  index: number,
): DocumentStructure {
  const node = (structure.removed ?? []).find((n) => n.id === id);
  if (!node) return structure;
  const withNode = insertNode(structure, node, containerId, index);
  return {
    ...withNode,
    removed: (withNode.removed ?? []).filter((n) => n.id !== id),
  };
}

/**
 * `index` is a position in the target container's children as they stand
 * now, which is what the drop indicator was computed against. A group of
 * one: `moveNodes` carries the adjustment.
 */
export function moveNode(
  structure: DocumentStructure,
  id: string,
  containerId: string | null,
  index: number,
): DocumentStructure {
  return moveNodes(structure, [id], containerId, index);
}

/**
 * Move a selection as one block: every node, each Part with its subtree,
 * lifts out of wherever it sits and lands side by side at `index`, in
 * document order (`normalizeSelection`).
 *
 * `index` keeps `moveNode`'s convention, moving nodes included. Each moving
 * node in the target container before `index` vacates a place ahead of it, so
 * the target shifts up by that many, here and not at each call site.
 *
 * A landing `canDropAll` refuses returns the structure it was given. The
 * nodes leave their container before they land, so a container that cannot
 * take them would drop the whole subtree.
 */
export function moveNodes(
  structure: DocumentStructure,
  ids: readonly string[],
  containerId: string | null,
  index: number,
): DocumentStructure {
  const moving = normalizeSelection(structure, ids);
  if (moving.length === 0) return structure;
  if (!canDropAll(structure, moving, containerId)) return structure;

  const nodes = moving.map((id) => findNode(structure, id) as DocNode);
  const set = new Set(moving);
  const vacated = childrenOf(structure, containerId)
    .slice(0, Math.max(index, 0))
    .filter((c) => set.has(c.id)).length;

  let next = structure;
  for (const id of moving) next = removeNode(next, id);
  return insertNodes(next, nodes, containerId, index - vacated);
}

/**
 * True when landing the selection at `index` inside `containerId` would leave
 * the document as it is; the drag then skips the write, and Move… leaves the
 * position out.
 *
 * That holds only when every moving node already sits in that container in
 * one unbroken run, and `index` falls within the run or at either edge. A run
 * with a gap is never a no-op, because landing it closes the gap. For a
 * single node this is its own index and the one after it.
 */
export function isMoveNoOp(
  structure: DocumentStructure,
  ids: readonly string[],
  containerId: string | null,
  index: number,
): boolean {
  const moving = normalizeSelection(structure, ids);
  if (moving.length === 0) return false;
  const siblings = childrenOf(structure, containerId);
  const at = moving.map((id) => siblings.findIndex((c) => c.id === id));
  if (at.some((i) => i < 0)) return false;
  const first = at[0];
  if (at.some((i, k) => i !== first + k)) return false;
  return index >= first && index <= first + at.length;
}

export interface RenameNodeOutcome {
  structure: DocumentStructure;
  /**
   * The file moves a rename implies: one `[from, to]` pair per snapshot file,
   * in the order the shell renames them. The shell uses these pairs for the
   * file renames and the journal re-key, and never re-derives the mapping.
   */
  fileMoves: Array<[string, string]>;
}

/**
 * Rename a node's display name. The id never changes, so every id-keyed
 * reference (journal, stats, expanded, lastOpened, chat, summary) survives.
 * Every snapshot file moves: the slug re-derives from the new title while the
 * id and the `.xy` counters stay. The slug is a label for the writer's file
 * manager; the id in the name keeps two nodes from being renamed onto
 * each other's files.
 *
 * Two snapshots that share a counter under different stems, as a restored
 * snapshot can, would re-stem onto one name, ignoring case, and the second
 * move would overwrite the first. A snapshot whose name is already taken in
 * the rename takes the next counter past every one the node and its binned
 * snapshots hold, as `addSnapshot` counts. A file that keeps its name keeps
 * its claim. The caller refuses a derived target name that already exists on
 * disk, before any file moves.
 */
export function renameNode(
  structure: DocumentStructure,
  id: string,
  newTitle: string,
  binned: readonly Snapshot[] = [],
): RenameNodeOutcome {
  const slug = toSlug(newTitle);
  const fileMoves: Array<[string, string]> = [];
  const moved = new Map<string, string>();
  const next = updateNode(structure, id, (node) => {
    // The naming module's own parser: `parseSnapshotName` accepts the empty
    // slug of a "???" title, which a parser requiring a dot body would
    // reject, leaving the file un-stemmed beside a new title and the project
    // unopenable. A name of another kind is a defect the validator refuses.
    const targets = node.snapshots.map((snap) => {
      const parsed = parseSnapshotName(snap.file);
      return parsed && parsed.kind === node.kind
        ? snapshotFileName(node.kind, slug, node.id, parsed.xy)
        : snap.file;
    });
    const claimed = new Set(
      node.snapshots
        .filter((snap, i) => targets[i] === snap.file)
        .map((snap) => snap.file.toLowerCase()),
    );
    let free =
      [...node.snapshots, ...binned].reduce((m, s) => {
        const parsed = parseSnapshotName(s.file);
        return parsed && parsed.xy > m ? parsed.xy : m;
      }, -1) + 1;
    const snapshots = node.snapshots.map((snap, i) => {
      let to = targets[i];
      if (to === snap.file) return snap;
      if (claimed.has(to.toLowerCase()))
        to = snapshotFileName(node.kind, slug, node.id, free++);
      claimed.add(to.toLowerCase());
      fileMoves.push([snap.file, to]);
      moved.set(snap.file, to);
      return { ...snap, file: to };
    });
    return {
      ...node,
      title: newTitle.trim(),
      snapshots,
      // The adopted pointer follows the file the rename moved, or it would
      // name a file that is not there.
      adopted: moved.get(node.adopted) ?? node.adopted,
    };
  });
  return { structure: next, fileMoves };
}

/**
 * The default title for a new snapshot: the node's display name followed by
 * the smallest positive integer no sibling title already uses ("The Storm 1",
 * "The Storm 2"), unique even after titles are renamed.
 */
export function defaultSnapshotTitle(node: DocNode): string {
  const used = new Set<number>();
  for (const snap of node.snapshots) {
    const match = snap.title.match(
      new RegExp(`^${escapeRegExp(node.title)} (\\d+)$`),
    );
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `${node.title} ${n}`;
}

/**
 * `title`, or the first of "title (2)", "title (3)" … that none of the node's
 * snapshots holds, ignoring case. The reconcile refuses to open a project
 * whose node lists one title twice.
 */
function uniqueSnapshotTitle(
  title: string,
  snapshots: readonly Snapshot[],
): string {
  const taken = new Set(snapshots.map((snap) => snap.title.toLowerCase()));
  if (!taken.has(title.toLowerCase())) return title;
  let n = 2;
  while (taken.has(`${title} (${n})`.toLowerCase())) n += 1;
  return `${title} (${n})`;
}

export interface AddSnapshotOutcome {
  structure: DocumentStructure;
  /** The new snapshot, whose file is the copy's target. */
  snapshot: Snapshot;
  /** The file the copy is made from: always the adopted snapshot's. */
  copyFrom: string;
}

/**
 * Add a snapshot of the node's current adopted file. The new counter is
 * max+1 over the node's live snapshots and `binned`, its snapshots in the
 * recycle bin. Gaps are never filled, so no file name is re-created while a
 * deleted snapshot's file waits in `recyclebin/` under it, where binning the
 * successor would overwrite it.
 *
 * `title` is the name the writer typed: creation and naming are one commit.
 * An empty or absent title falls back to the node's default ("The Storm 3"),
 * the name the field's placeholder showed. A title the node already holds
 * gains a number (`uniqueSnapshotTitle`).
 */
export function addSnapshot(
  structure: DocumentStructure,
  id: string,
  created: string,
  title?: string,
  contentHash?: string,
  binned: readonly Snapshot[] = [],
): AddSnapshotOutcome | null {
  const next = updateNode(structure, id, (node) => {
    const max = [...node.snapshots, ...binned].reduce((m, s) => {
      const parsed = parseSnapshotName(s.file);
      return parsed && parsed.xy > m ? parsed.xy : m;
    }, -1);
    const file = snapshotFileName(
      node.kind,
      toSlug(node.title),
      node.id,
      max + 1,
    );
    const snapshot: Snapshot = {
      file,
      title: uniqueSnapshotTitle(
        title?.trim() || defaultSnapshotTitle(node),
        node.snapshots,
      ),
      created,
      ...(contentHash ? { contentHash } : {}),
    };
    return { ...node, snapshots: [...node.snapshots, snapshot] };
  });
  // Read back from the new structure, not captured in the rewrite's closure:
  // the new snapshot is the node's last entry. A new snapshot never changes
  // the adopted file, which is `copyFrom`.
  const node = findNode(next, id);
  if (!node) return null;
  const snapshot = node.snapshots[node.snapshots.length - 1];
  return { structure: next, snapshot, copyFrom: node.adopted };
}

export interface AdoptSnapshotOutcome {
  structure: DocumentStructure;
  /** The file adopted before the swap; the journal does not move. */
  from: string;
}

/**
 * Adopt a snapshot: a yaml pointer swap and nothing else. No file is touched,
 * because the adopted file is already on disk and listed. No undo toast arms,
 * because adopting back is the undo.
 */
export function adoptSnapshot(
  structure: DocumentStructure,
  id: string,
  file: string,
): AdoptSnapshotOutcome | null {
  let from: string | null = null;
  const next = updateNode(structure, id, (node) => {
    if (!node.snapshots.some((s) => s.file === file) || node.adopted === file)
      return node;
    from = node.adopted;
    return { ...node, adopted: file };
  });
  return from !== null ? { structure: next, from } : null;
}

export interface RenameSnapshotOutcome {
  structure: DocumentStructure;
  renamed: boolean;
}

/** Re-title one snapshot. Titles are display only; the file never moves. */
export function renameSnapshotTitle(
  structure: DocumentStructure,
  id: string,
  file: string,
  title: string,
): RenameSnapshotOutcome {
  let renamed = false;
  const next = updateNode(structure, id, (node) => {
    const snap = node.snapshots.find((s) => s.file === file);
    if (!snap || snap.title === title) return node;
    // Unique among the node's snapshots, ignoring case, so the table can tell
    // every row apart.
    if (
      node.snapshots.some(
        (s) => s.file !== file && s.title.toLowerCase() === title.toLowerCase(),
      )
    )
      return node;
    renamed = true;
    return {
      ...node,
      snapshots: node.snapshots.map((s) =>
        s.file === file ? { ...s, title } : s,
      ),
    };
  });
  return { structure: next, renamed };
}

export interface DeleteSnapshotOutcome {
  structure: DocumentStructure;
  /** Whether the snapshot existed to be deleted. */
  removed: boolean;
}

/**
 * Drop a snapshot's entry; the caller deletes the `.md`. Refused when the
 * snapshot is adopted (the live text) or is the last one (a node always has
 * one). The caller checks both too; this does not rely on it.
 */
export function deleteSnapshot(
  structure: DocumentStructure,
  id: string,
  file: string,
): DeleteSnapshotOutcome {
  let removed = false;
  const next = updateNode(structure, id, (node) => {
    if (node.adopted === file || node.snapshots.length <= 1) return node;
    if (!node.snapshots.some((s) => s.file === file)) return node;
    removed = true;
    return {
      ...node,
      snapshots: node.snapshots.filter((s) => s.file !== file),
    };
  });
  return { structure: next, removed };
}

/**
 * Put a binned snapshot's record back on its node.
 *
 * Appended, not inserted at its old index: the panel sorts the rows it draws,
 * and a stored position would be a second opinion on that order. A record
 * whose file is already listed is a no-op, so two racing restores cannot
 * double the row although each probes the file first. A title the node took
 * while the record sat in the bin gains a number (`uniqueSnapshotTitle`).
 */
export function restoreSnapshot(
  structure: DocumentStructure,
  id: string,
  record: Snapshot,
): DocumentStructure {
  return updateNode(structure, id, (node) =>
    node.snapshots.some((one) => one.file === record.file)
      ? node
      : {
          ...node,
          snapshots: [
            ...node.snapshots,
            {
              ...record,
              title: uniqueSnapshotTitle(record.title, node.snapshots),
            },
          ],
        },
  );
}

/**
 * Every snapshot file a node's subtree holds, each once: what a removal
 * relocates. A name listed twice makes the second move fail on a file the
 * first already moved.
 */
export function nodeSubtreeFileNames(node: DocNode): string[] {
  const names = new Set<string>();
  walk([node], (one) => {
    names.add(one.adopted);
    for (const snap of one.snapshots) names.add(snap.file);
  });
  return [...names];
}

/** The files a removal of `id` has to relocate. */
export function subtreeFileNames(
  structure: DocumentStructure,
  id: string,
): string[] {
  const node = findNode(structure, id);
  return node ? nodeSubtreeFileNames(node) : [];
}
