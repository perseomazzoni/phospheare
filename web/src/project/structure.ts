// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  parse as parseYaml,
  stringify as stringifyYaml,
  YAMLParseError,
} from "yaml";
import { ID_RE, nextId } from "./naming";
import { PRODUCT } from "../product";
import {
  STRUCTURE_VERSION,
  type ChildKind,
  type DocNode,
  type DocumentStructure,
  type NodeKind,
  type PartNode,
  type Snapshot,
  type StructureError,
} from "./types";

// ── The structure file ───────────────────────────────────────────────────────
//
// `document-structure.yaml` is the one authority on hierarchy and order.
// `document-properties.json` is read forgivingly, because losing a UI
// preference costs nothing; this file is validated strictly. A document whose
// shape cannot be read is refused, because guessing at it would silently
// reorder somebody's novel.
//
// Every failure is a `StructureError` carrying an i18n code rather than a
// sentence, so the panel says it in the writer's language.
//
// The live list is the manuscript, and a problem there refuses the open with
// a precise error. The removed list is the recycle bin, and a problem there
// warns rather than refuses, because a broken bin is a wrong annotation, not
// an unreadable document.

/**
 * The comment block at the top of every structure file. The writer reads it
 * in their own folder, so it names the product by its public name.
 * The parser ignores YAML comments, so a file written under an earlier name
 * still opens.
 */
export const STRUCTURE_HEADER = `# ${PRODUCT.name} — document structure
# The order of this list is the order of the finished document.
# ${PRODUCT.name} rewrites this file when the structure changes; comments below are not preserved.
`;

export type ParseResult =
  | {
      ok: true;
      structure: DocumentStructure;
      /**
       * Problems that did not stop the open: broken removed entries only.
       * Everything else in this file describes what the document is, and an
       * ambiguity there refuses.
       */
      warnings: StructureError[];
    }
  | { ok: false; errors: StructureError[] };

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * The open pipeline's structural checks: the file parses, has the expected
 * shape, and obeys the Golden Rule. `validateAgainstDisk` checks agreement
 * with the folder separately, because it needs a directory listing.
 *
 * Stops at the first structural problem: a writer repairing a hand-edited
 * file fixes one thing, reloads, and sees the next.
 */
export function parseStructure(raw: string | null): ParseResult {
  if (raw === null)
    return { ok: false, errors: [{ code: "missingStructure" }] };

  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    // A writer who broke the indentation is told the line.
    const line =
      err instanceof YAMLParseError ? err.linePos?.[0]?.line : undefined;
    // The parser's message runs on with a caret diagram and trails off in a
    // colon; with the line number printed, its first sentence is enough.
    const detail =
      err instanceof Error
        ? err.message.split("\n")[0].replace(/[:\s]+$/, "")
        : "";
    return {
      ok: false,
      errors: [{ code: "yamlParse", values: { detail }, line }],
    };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: [{ code: "notAMap" }] };
  }

  // A file from a newer build is refused, never opened: an entry shape this
  // reader does not know would be dropped on the next write.
  const version = (data as Record<string, unknown>).version;
  if (typeof version === "number" && version > STRUCTURE_VERSION)
    return {
      ok: false,
      errors: [
        {
          code: "yamlNewer",
          values: { version, supported: STRUCTURE_VERSION },
        },
      ],
    };

  const root = (data as Record<string, unknown>).document;
  if (!Array.isArray(root))
    return { ok: false, errors: [{ code: "noDocumentList" }] };

  const errors: StructureError[] = [];
  const warnings: StructureError[] = [];
  const seenIds = new Set<string>();

  /**
   * One node entry. With `strict`, the live list refuses on any problem;
   * without, the removed list drops the entry with a warning. Both build the
   * same shape, because a bin entry is a verbatim copy of a live one and a
   * restore puts back what was taken out.
   */
  function readEntry(
    entry: unknown,
    strict: boolean,
    errors: StructureError[],
    warnings: StructureError[],
    seenIds: Set<string>,
  ): DocNode | null {
    const problem = (
      code: string,
      values?: Record<string, string | number>,
    ) => {
      const err = { code, values };
      if (strict) errors.push(err);
      else warnings.push(err);
    };

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problem("entryNotAMap");
      return null;
    }
    const row = entry as Record<string, unknown>;

    const hasPart = "part" in row;
    const hasSection = "section" in row;
    if (hasPart === hasSection) {
      // Both or neither: the entry's kind cannot be told.
      problem("entryKind");
      return null;
    }
    const kind: NodeKind = hasPart ? "part" : "section";

    const id = row.id;
    if (typeof id !== "string" || !ID_RE.test(id)) {
      problem("entryId", { kind });
      return null;
    }
    if (seenIds.has(id.toLowerCase())) {
      problem("duplicateId", { id });
      return null;
    }
    seenIds.add(id.toLowerCase());

    // The display name, never a file name.
    const title = row[kind];
    if (typeof title !== "string" || title.length === 0) {
      problem("entryName", { kind });
      return null;
    }

    const adopted = row.adopted;
    if (typeof adopted !== "string" || adopted.length === 0) {
      problem("entryAdopted", { id, title });
      return null;
    }

    // The snapshot record and the summary binding live outside this file, so
    // creating a snapshot is one properties write and adopting one is one
    // yaml write. `reconcileRecords` in `properties.ts` validates them
    // strictly and attaches both afterwards, so the empty placeholder here
    // never reaches the UI.
    const base = {
      id,
      title,
      adopted,
      snapshots: [] as Snapshot[],
      summary: undefined,
    };

    if (kind === "section") {
      if ("children" in row) {
        problem("sectionWithChildren", { title });
        return null;
      }
      return { kind: "section", ...base };
    }

    const rawChildren = row.children;
    if (
      rawChildren !== undefined &&
      rawChildren !== null &&
      !Array.isArray(rawChildren)
    ) {
      problem("childrenNotAList", { title });
      return null;
    }

    const children = readList(
      Array.isArray(rawChildren) ? rawChildren : [],
      title,
      strict,
      errors,
      warnings,
      seenIds,
    );
    return { kind: "part", ...base, children } as PartNode;
  }

  /** `owner` is the containing Part's display name, or null at the root. */
  function readList(
    entries: unknown[],
    owner: string | null,
    strict: boolean,
    errors: StructureError[],
    warnings: StructureError[],
    seenIds: Set<string>,
  ): DocNode[] {
    const nodes: DocNode[] = [];
    for (const entry of entries) {
      const node = readEntry(entry, strict, errors, warnings, seenIds);
      if (node) nodes.push(node);
    }
    // The Golden Rule, checked once per container.
    if (nodes.length > 1 && nodes.some((n) => n.kind !== nodes[0].kind)) {
      const err = { code: "mixedChildren", values: { owner: owner ?? "" } };
      if (strict) errors.push(err);
      else warnings.push(err);
    }
    return nodes;
  }

  const children = readList(root, null, true, errors, warnings, seenIds);
  if (errors.length > 0) return { ok: false, errors };

  // `removed:` holds the subtrees sent to the bin, kept verbatim so a restore
  // puts them back as they were. The same reader reads it, with two
  // differences from `document:`:
  // - It has its own seen-set: a live node and a removed one may share an id,
  //   since their files sit in different folders.
  // - A problem warns and drops the entry instead of refusing.
  let removed: DocNode[] = [];
  const rawRemoved = (data as Record<string, unknown>).removed;
  if (rawRemoved !== undefined && rawRemoved !== null) {
    if (!Array.isArray(rawRemoved)) {
      warnings.push({ code: "removedNotAList" });
    } else {
      removed = readList(rawRemoved, null, false, errors, warnings, new Set());
    }
  }

  const rawVersion = (data as Record<string, unknown>).version;
  return {
    ok: true,
    structure: {
      version: typeof rawVersion === "number" ? rawVersion : STRUCTURE_VERSION,
      children,
      removed,
    },
    warnings,
  };
}

// ── Agreement with the folder ────────────────────────────────────────────────

/**
 * The yaml and `document/` must describe the same set of files. `onDisk` is
 * every Part or Section file name in `document/`; the caller filters out the
 * rest, so a stray `.DS_Store` or `notes.txt` is invisible here. Strictness
 * applies to the document, not the folder.
 */
export function validateAgainstDisk(
  structure: DocumentStructure,
  onDisk: string[],
): StructureError[] {
  const listed = new Set(allFileNames(structure));
  const present = new Set(onDisk);

  const missing = [...listed].filter((name) => !present.has(name));
  const unlisted = [...present].filter((name) => !listed.has(name));

  const errors: StructureError[] = [];
  if (missing.length > 0) {
    errors.push({
      code: "filesMissing",
      values: { count: missing.length, names: summarise(missing) },
    });
  }
  if (unlisted.length > 0) {
    errors.push({
      code: "filesUnlisted",
      values: { count: unlisted.length, names: summarise(unlisted) },
    });
  }
  return errors;
}

/** At most five names, then a count. */
function summarise(names: string[]): string {
  const shown = names.slice(0, 5).join(", ");
  return names.length > 5 ? `${shown}, +${names.length - 5}` : shown;
}

// ── Serialising ──────────────────────────────────────────────────────────────

export function serializeStructure(structure: DocumentStructure): string {
  const body = stringifyYaml(
    {
      version: structure.version || STRUCTURE_VERSION,
      document: structure.children.map(toPlain),
      // Written only when the bin holds something, so a project with no
      // removals has no `removed:` key.
      ...(structure.removed && structure.removed.length > 0
        ? { removed: structure.removed.map(toPlain) }
        : {}),
    },
    { lineWidth: 0 },
  );
  return `${STRUCTURE_HEADER}${body}`;
}

/**
 * A node as the yaml holds it.
 *
 * Every key the yaml holds for a node is named here. Each entry is rebuilt
 * from literals rather than spread, which keeps the file tidy, so a field not
 * named here is erased on the next add, rename, move or remove. A field
 * changes in the type, the reader and this function together.
 */
function toPlain(node: DocNode): Record<string, unknown> {
  const base = {
    id: node.id,
    [node.kind]: node.title,
    adopted: node.adopted,
  };
  if (node.kind === "section") return base;
  return { ...base, children: node.children.map(toPlain) };
}

/**
 * Both records as `document-properties.json` holds them: every node's
 * snapshot list and summary binding, live and removed, keyed by the node's
 * stable id. The reverse of the reconcile. Ids are never reused, so one map
 * per block covers both lists.
 */
export function recordsOf(structure: DocumentStructure): {
  snapshots: Record<string, Snapshot[]>;
  summaries: Record<string, string>;
} {
  const snapshots: Record<string, Snapshot[]> = {};
  const summaries: Record<string, string> = {};
  // A hand-edited yaml can hold the same id in both lists, at any depth of a
  // removed subtree, which the reader judges separately. The first record
  // wins and the live list is collected first, so a removed record never
  // overwrites a live node's in the properties write.
  const collect = (nodes: DocNode[]) => {
    for (const node of nodes) {
      if (!(node.id in snapshots)) {
        snapshots[node.id] = node.snapshots;
        if (node.summary) summaries[node.id] = node.summary;
      }
      if (node.kind === "part") collect(node.children);
    }
  };
  collect(structure.children);
  collect(structure.removed ?? []);
  return { snapshots, summaries };
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function walk(
  nodes: DocNode[],
  visit: (node: DocNode, depth: number) => void,
  depth = 0,
): void {
  for (const node of nodes) {
    visit(node, depth);
    if (node.kind === "part") walk(node.children, visit, depth + 1);
  }
}

/**
 * Every Section's place in the book, counted from 1 in reading order across
 * every Part, as a manuscript numbers its chapters (Part Two opens on chapter
 * 19, not 1). The structure panel draws it; titles never carry it.
 */
export function sectionNumbers(
  structure: DocumentStructure,
): Map<string, number> {
  const numbers = new Map<string, number>();
  walk(structure.children, (node) => {
    if (node.kind === "section") numbers.set(node.id, numbers.size + 1);
  });
  return numbers;
}

/**
 * The number the structure panel draws beside a node, for places that name
 * the node elsewhere, such as the titlebar's crumb: a Section's place in the
 * whole book (`sectionNumbers`), a top-level Part's place among the root's
 * rows, and null for a Part nested in another, as the panel draws none, or
 * for an id not in the structure.
 */
export function nodeNumber(
  structure: DocumentStructure,
  id: string,
): number | null {
  const at = structure.children.findIndex((node) => node.id === id);
  if (at >= 0 && structure.children[at].kind === "part") return at + 1;
  return sectionNumbers(structure).get(id) ?? null;
}

/** Every snapshot file name in the document: the disk check's expected set. */
export function allFileNames(structure: DocumentStructure): string[] {
  const names: string[] = [];
  walk(structure.children, (node) => {
    for (const snap of node.snapshots) names.push(snap.file);
  });
  return names;
}

/**
 * How many rows sit under a node: descendant nodes, never snapshot files. Two
 * snapshots are two versions of one row, and a remove confirm counting them
 * would overstate what the removal takes.
 */
export function descendantCount(node: DocNode): number {
  if (node.kind !== "part") return 0;
  let count = 0;
  for (const child of node.children) count += 1 + descendantCount(child);
  return count;
}

/**
 * The node with this id, or null. Stops at the match, because the move rules
 * make this lookup several times per gap they judge. Same order as `walk`, a
 * node before its children.
 */
export function findNode(
  structure: DocumentStructure,
  id: string,
): DocNode | null {
  return findIn(structure.children, id);
}

/** One snapshot record of a node, by its file, or null. */
export function snapshotOf(
  structure: DocumentStructure,
  id: string,
  file: string,
): Snapshot | null {
  return (
    findNode(structure, id)?.snapshots.find((s) => s.file === file) ?? null
  );
}

function findIn(nodes: DocNode[], id: string): DocNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === "part") {
      const inside = findIn(node.children, id);
      if (inside) return inside;
    }
  }
  return null;
}

/**
 * The node a file belongs to: the reverse of the adopted and snapshots
 * pointers. Snapshot file names are unique document-wide, so the lookup is
 * unambiguous.
 */
export function nodeOfFile(
  structure: DocumentStructure,
  fileName: string,
): DocNode | null {
  let found: DocNode | null = null;
  walk(structure.children, (node) => {
    if (found) return;
    if (node.adopted === fileName) found = node;
    else if (node.snapshots.some((s) => s.file === fileName)) found = node;
  });
  return found;
}

/** The Part holding `id`, or null when it sits at the root (or is absent). */
export function findParent(
  structure: DocumentStructure,
  id: string,
): PartNode | null {
  let found: PartNode | null = null;
  walk(structure.children, (node) => {
    if (found || node.kind !== "part") return;
    if (node.children.some((c) => c.id === id)) found = node;
  });
  return found;
}

/** A container's children: a Part's own, or the root's when `id` is null. */
export function childrenOf(
  structure: DocumentStructure,
  id: string | null,
): DocNode[] {
  if (id === null) return structure.children;
  const node = findNode(structure, id);
  return node && node.kind === "part" ? node.children : [];
}

/** What a container holds, and therefore what it may accept. */
export function childKindOf(
  structure: DocumentStructure,
  id: string | null,
): ChildKind {
  const children = childrenOf(structure, id);
  return children.length === 0 ? "empty" : children[0].kind;
}

/** True when `ancestor` contains `id` at any depth. */
export function isDescendant(
  structure: DocumentStructure,
  ancestor: string,
  id: string,
): boolean {
  const node = findNode(structure, ancestor);
  if (!node || node.kind !== "part") return false;
  let hit = false;
  walk(node.children, (child) => {
    if (child.id === id) hit = true;
  });
  return hit;
}

/** The next node id: max over the live and removed lists, plus one. */
export function nextNodeId(structure: DocumentStructure): string {
  const ids: string[] = [];
  walk(structure.children, (node) => ids.push(node.id));
  for (const node of structure.removed ?? []) {
    ids.push(node.id);
    if (node.kind === "part") walk(node.children, (c) => ids.push(c.id));
  }
  return nextId(ids);
}

/** Every node id in the document, live and removed. */
export function allIds(structure: DocumentStructure): Set<string> {
  const ids = new Set<string>();
  walk(structure.children, (node) => ids.add(node.id));
  for (const node of structure.removed ?? []) {
    ids.add(node.id);
    if (node.kind === "part") walk(node.children, (c) => ids.add(c.id));
  }
  return ids;
}

/**
 * A label per live node that tells it apart from every other, keyed by id.
 *
 * Titles are free, so "Anna" may head two chapters. A reader that
 * cannot see the tree, such as the assistant handed titles as text, would
 * take the two for one. A unique title stays as it is; a shared one gains its
 * ancestors' path ("Part One › Anna"), and where even the paths agree each
 * gains its place in reading order ("Part One › Anna #2"). Matching ignores
 * case, as a reader would.
 */
export function nodeLabels(structure: DocumentStructure): Map<string, string> {
  const placed: { id: string; title: string; path: string }[] = [];
  const trail: string[] = [];
  walk(structure.children, (node, depth) => {
    trail.length = depth;
    trail[depth] = node.title;
    placed.push({ id: node.id, title: node.title, path: trail.join(" › ") });
  });
  const count = (key: (one: (typeof placed)[number]) => string) => {
    const seen = new Map<string, number>();
    for (const one of placed) {
      const k = key(one).toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return seen;
  };
  const byTitle = count((one) => one.title);
  const byPath = count((one) => one.path);
  const nth = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const one of placed) {
    if (byTitle.get(one.title.toLowerCase()) === 1) {
      labels.set(one.id, one.title);
      continue;
    }
    const path = one.path.toLowerCase();
    if (byPath.get(path) === 1) {
      labels.set(one.id, one.path);
      continue;
    }
    const n = (nth.get(path) ?? 0) + 1;
    nth.set(path, n);
    labels.set(one.id, `${one.path} #${n}`);
  }
  return labels;
}

export function emptyStructure(): DocumentStructure {
  return { version: STRUCTURE_VERSION, children: [], removed: [] };
}
