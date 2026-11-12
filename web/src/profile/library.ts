// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { CardContent, LibraryRow } from "./profileStore";
import type { ProjectRef } from "../storage";
import {
  STRUCTURE_VERSION,
  DEFAULT_DOCUMENT_TYPE,
  type DocNode,
  type DocumentStructure,
  type NodeStat,
} from "../project/types";

// The library's rows as the shelf reads them: one row per project holding
// the membership and the derived card content (title, type, counts, spine
// shape, never the manuscript body text, with `CardContent` as the
// boundary). The rows live in the account's profile (`profileStore.ts`);
// this module holds the pure rules over them.

// ── Card content validation ──────────────────────────────────────────────────
//
// The forgiving read of the profile's card and the write-side normalizer in
// one, so the reduced shape is the only one that crosses the seam. The
// structure's bin subtrees, summaries and any future yaml field never reach
// the synced copy.

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function asNodeStats(value: unknown): NodeStat[] {
  if (!Array.isArray(value)) return [];
  const out: NodeStat[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.nodeId !== "string" || !raw.nodeId) continue;
    out.push({
      nodeId: raw.nodeId,
      words: asCount(raw.words),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    });
  }
  return out;
}

/**
 * The shape, read back forgivingly, as `parseProperties` reads its half.
 *
 * A node without a usable id, title or adopted file is dropped rather than
 * guessed at, and an unreadable shape becomes an empty one, which draws no
 * spine, as a card whose structure is unknown should. A node keeps its kind,
 * id, title, adopted file and children; nothing else crosses the seam.
 *
 * The snapshot list leaves as `[]` and is never required: `parseStructure`
 * hands every node `snapshots: []`, so requiring one would drop every node
 * and draw every spine empty. A snapshot's file name and title are the
 * writer's words and have no reason to cross the seam.
 */
function asNode(value: unknown): DocNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : "";
  const title = typeof raw.title === "string" ? raw.title : "";
  const adopted = typeof raw.adopted === "string" ? raw.adopted : "";
  if (!id || !title || !adopted) return null;
  if (raw.kind === "section") {
    return { kind: "section", id, title, adopted, snapshots: [] };
  }
  if (raw.kind === "part") {
    return {
      kind: "part",
      id,
      title,
      adopted,
      snapshots: [],
      children: asNodes(raw.children),
    };
  }
  return null;
}

function asNodes(value: unknown): DocNode[] {
  if (!Array.isArray(value)) return [];
  const out: DocNode[] = [];
  for (const entry of value) {
    const node = asNode(entry);
    if (node) out.push(node);
  }
  return out;
}

function asStructure(value: unknown): DocumentStructure {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { version: STRUCTURE_VERSION, children: [] };
  }
  const raw = value as Record<string, unknown>;
  return {
    version: typeof raw.version === "number" ? raw.version : STRUCTURE_VERSION,
    children: asNodes(raw.children),
  };
}

/**
 * A card, or null when it cannot be trusted. An untrusted card is dropped,
 * not repaired: one built from half-understood data would state things about
 * a writer's document that were never true. The id and the title are the
 * fields with no sensible default.
 */
export function asCardContent(value: unknown): CardContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.title !== "string" || !raw.title) return null;
  // The type is the writer's own words: a named option stored verbatim or
  // the text typed for Other. An unusable type keeps the default; it is
  // display metadata, not a reason to drop a card.
  return {
    id: raw.id,
    title: raw.title,
    type:
      typeof raw.type === "string" && raw.type.trim().length > 0
        ? raw.type
        : DEFAULT_DOCUMENT_TYPE,
    words: asCount(raw.words),
    parts: asCount(raw.parts),
    sections: asCount(raw.sections),
    goal:
      typeof raw.goal === "number" && Number.isFinite(raw.goal) && raw.goal > 0
        ? Math.floor(raw.goal)
        : null,
    perNode: asNodeStats(raw.perNode),
    structure: asStructure(raw.structure),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    cachedAt: typeof raw.cachedAt === "string" ? raw.cachedAt : "",
  };
}

/**
 * Whether every drawn field is deep-equal, ignoring the `cachedAt` clock.
 * Two devices remembering identical content under different stamps is the
 * ordinary case, so a `cachedAt`-only difference must not mint a profile
 * write, flag the merge as changed, or repaint a card that draws the same.
 * This is the one content predicate; the field list lives only here.
 */
export function sameCardContent(
  a: CardContent | null,
  b: CardContent | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.type === b.type &&
    a.words === b.words &&
    a.parts === b.parts &&
    a.sections === b.sections &&
    a.goal === b.goal &&
    a.updatedAt === b.updatedAt &&
    sameDeep(a.perNode, b.perNode) &&
    sameDeep(a.structure, b.structure)
  );
}

/**
 * Structural deep equality, insensitive to object key order and identity.
 * Not `JSON.stringify` equality, because the same store with its keys
 * rebuilt in another order stringifies differently.
 */
function sameDeep(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, i) => sameDeep(item, b[i]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  return aKeys.every((key) => sameDeep(aRecord[key], bRecord[key]));
}

// ── Rows and the refs the shelf paints ───────────────────────────────────────

/**
 * Membership rows as the refs the shelf paints. The row-to-ref mapping,
 * including the `openedAt ?? lastSeenAt ?? now` fallback, lives only here.
 */
export function libraryRefs(rows: readonly LibraryRow[]): ProjectRef[] {
  return rows.map((row) => ({
    providerId: row.provider,
    key: row.key,
    name: row.name,
    openedAt: row.openedAt ?? row.lastSeenAt ?? new Date().toISOString(),
  }));
}

/**
 * The row a ref is, when the shelf knows it. A row matches a ref on the
 * provider and key alone.
 */
export function libraryRowFor(
  rows: readonly LibraryRow[],
  ref: Pick<ProjectRef, "providerId" | "key">,
): LibraryRow | undefined {
  return rows.find(
    (row) => row.provider === ref.providerId && row.key === ref.key,
  );
}

/**
 * One row's card content: what the shelf draws when the folder cannot be
 * read.
 */
export function libraryCard(
  rows: readonly LibraryRow[],
  ref: Pick<ProjectRef, "providerId" | "key">,
): CardContent | null {
  return libraryRowFor(rows, ref)?.card ?? null;
}

/**
 * The project one URL names: the whole of `/app/project/<id>`'s resolution.
 * The id is `document.id`, the row's own key. A row is addressable from the
 * moment it exists, so a project no device has read yet, whose `card` is
 * still null, is reachable by its URL.
 *
 * At most one row answers: the profile keys its rows by the document id. A
 * folder copied outside the app carries the same `document-properties.json`
 * uuid, and the shelf refuses the second folder rather than holding two rows;
 * the app's own Duplicate mints the copy a new identity.
 */
export function libraryRefForId(
  rows: readonly LibraryRow[],
  id: string,
): ProjectRef | null {
  if (!id) return null;
  const row = rows.find((r) => r.id === id);
  return row ? libraryRefs([row])[0] : null;
}

/**
 * The id of the book reachable at this address. The shelf's controls start
 * from a card the writer clicked, which is a location; a caller resolves the
 * id here and passes it down, so the location travels no further.
 *
 * `null` means no row is there, and every caller treats it as nothing to do
 * rather than inventing an identity: a folder the app cannot read is one it
 * cannot name.
 */
export function libraryIdForRef(
  rows: readonly LibraryRow[],
  ref: Pick<ProjectRef, "providerId" | "key">,
): string | null {
  return libraryRowFor(rows, ref)?.id ?? null;
}

/**
 * Whether both hold the same books, each with the same name and reachable
 * in the same place; never the rows themselves. `openedAt` and `lastSeenAt`
 * change on every open, and counting them would re-gather the shelf on every
 * mount. Card content is not compared either: it is a display question,
 * which `sameCardContent` answers.
 *
 * The location is compared although it is not the identity: the
 * shelf fetches every candidate through its location, so a move read as no
 * change would leave the shelf reading an address the book has left.
 */
export function sameMembership(a: LibraryRow[], b: LibraryRow[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Map(a.map((row) => [row.id, rowFacts(row)]));
  return b.every((row) => seen.get(row.id) === rowFacts(row));
}

function rowFacts(row: LibraryRow): string {
  return `${row.name}\u0000${row.provider}\u0000${row.key}`;
}
