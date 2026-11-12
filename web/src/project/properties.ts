// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  AUTOSAVE_DELAY_PRESETS,
  HENOSIS_AFTER_PRESETS,
  HENOSIS_FADE_PRESETS,
  HENOSIS_PAUSE_PRESETS,
  PROSE_SIZES,
  SCHEMA_VERSION,
  DEFAULT_DOCUMENT_TYPE,
  type DocNode,
  type DocumentProperties,
  type DocumentStats,
  type DocumentStructure,
  type DocumentSyncState,
  type DocumentType,
  type DocumentUiState,
  type FocusMode,
  type NodeKind,
  type NodeStat,
  type ProseSize,
  type Snapshot,
  type StructureError,
  type WritingSession,
} from "./types";
import { MD_EXT, SUMMARY_PREFIX, parseSnapshotName, prefixFor } from "./naming";
import { asAgeCategory, asGenres, asTropes } from "./genres";
import { NO_STRUCTURE, SHAPE_IDS } from "./startingShape";
import { emptyStats } from "./stats";

// ── The properties file ──────────────────────────────────────────────────────
//
// `document-properties.json` holds settings, metadata and UI state: everything
// except the shape of the document, which `document-structure.yaml` owns.
//
// Two contracts:
// - `validateProperties` is the gate. A folder without a readable title is not
//   a project, and it is refused.
// - `parseProperties` runs afterwards and never throws. Past the gate, a
//   corrupt value costs its default, never the open: a broken `ui.expanded`
//   is a collapsed tree.

// The type is the writer's own words: a named option stored verbatim, or the
// text typed for Other. Nothing narrows it; an empty or non-string value
// falls back to the default.
export function asDocumentType(value: unknown): DocumentType {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : DEFAULT_DOCUMENT_TYPE;
}

/**
 * The creation-time structure, or null. Only a known `ShapeId` counts
 * ("threeact", "herosjourney", …); anything else, `NO_STRUCTURE` included,
 * persists as null. As in `ui`, an unknown id never refuses an open; it costs
 * only the fact it carried.
 */
export function asStructureId(value: unknown): string | null {
  return typeof value === "string" &&
    value !== NO_STRUCTURE &&
    (SHAPE_IDS as readonly string[]).includes(value)
    ? value
    : null;
}

export const FOCUS_MODES: readonly FocusMode[] = ["off", "line", "paragraph"];

function isFocusMode(value: unknown): value is FocusMode {
  return (
    typeof value === "string" &&
    (FOCUS_MODES as readonly string[]).includes(value)
  );
}

/**
 * A project's identity, minted: the id that keys the project everywhere, the
 * URL, the shelf row and every store keyed on a project.
 *
 * Minted in two places only: when a book is created, and when one is
 * duplicated. A duplicate is a new project and must not carry the original's
 * identity. Never on a move, a rename or a re-pairing: those are
 * the same book, and the identity exists to survive them.
 */
export function newProjectId(): string {
  return crypto.randomUUID();
}

export function defaultProperties(title: string): DocumentProperties {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    document: {
      id: newProjectId(),
      title,
      author: "",
      type: DEFAULT_DOCUMENT_TYPE,
      structure: null,
      language: "en",
      createdAt: now,
      updatedAt: now,
      goal: null,
      genres: [],
      ageCategory: null,
      tropes: [],
    },
    sync: null,
    ui: {
      expanded: [],
      lastOpened: null,
      session: null,
      dockWidth: null,
      structureWidth: null,
      commentsHidden: null,
      snapshotSplit: null,
      proseSize: null,
      typewriter: null,
      focus: null,
      smoothCaret: null,
      autosave: null,
      autosaveDelay: null,
      henosis: null,
      henosisAfter: null,
      henosisFade: null,
      henosisPause: null,
    },
    // Counted and empty, not unknown: a new document has no words, and the
    // Library says so rather than showing a blank.
    stats: emptyStats(now),
    snapshotHashes: {},
    summaries: {},
  };
}

// ── The record blocks ────────────────────────────────────────────────────────
//
// Every node's summary binding lives in this file, and its snapshot list in
// `snapshots-catalogue.json` (`snapshotCatalogue.ts`), both keyed by the
// node's id. Settings and UI state are read forgivingly, but the snapshot
// record names the manuscript's files, so it also has a strict reader,
// `reconcileRecords`, that runs once the structure is known. The parse
// functions are the lenient half. The reconcile attaches the records, refuses
// the open on a live node whose record is corrupt, and only warns for
// summaries: a wrong annotation never locks a novel.

/**
 * Lenient read of the snapshot hashes: SHA-256 hex of each file's canonical
 * content, keyed by file name. Missing or malformed means not yet computed,
 * and backfill fills it on the next open or save. Only 64 lower-case hex
 * characters are kept.
 */
function parseHashes(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [file, hash] of Object.entries(value)) {
    if (typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash))
      out[file] = hash;
  }
  return out;
}

/**
 * Lenient read of the summaries block: anything but a non-empty string is
 * dropped. The check against the id (`summary--EL1.md`) is the reconcile's,
 * where the warning can name the node.
 */
function parseSummaries(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [id, bound] of Object.entries(value)) {
    if (typeof bound === "string" && bound.length > 0) out[id] = bound;
  }
  return out;
}

export type ReconcileOutcome =
  | { ok: true; structure: DocumentStructure; warnings: StructureError[] }
  | { ok: false; errors: StructureError[] };

/**
 * Attach the properties' records to the structure's nodes.
 *
 * A snapshot is the prose, so a live node's record must exist, hold at least
 * one snapshot, list the adopted file, anchor every file name to the node's
 * own kind and id (`snapshotFileName` is the whole snapshot namespace),
 * and keep file names and titles unique; otherwise the open is refused. In the
 * removed list a problem warns and drops the entry, as `structure.ts` reads
 * the bin.
 *
 * At every node, a summary binding that is not the node's id-derived name
 * warns and attaches nothing: a summary is an annotation into the freeform
 * `reference/` folder, and a mistyped one must not stop a novel opening.
 *
 * Runs in the open pipeline between `parseStructure`, which reads neither
 * record, and `validateAgainstDisk`, which needs snapshots attached to list
 * the expected files.
 */
export function reconcileRecords(
  structure: DocumentStructure,
  snapshots: Record<string, Snapshot[]>,
  summaries: Record<string, string>,
): ReconcileOutcome {
  const errors: StructureError[] = [];
  const warnings: StructureError[] = [];

  /**
   * One snapshot entry, anchored against the node's own kind and id, so a
   * crafted record cannot name a file that is not this node's. The slug is
   * not compared: it is a label for the writer's file manager, and a
   * slug left stale by an interrupted rename must not refuse a readable book.
   */
  function readSnapshot(
    raw: Snapshot,
    kind: NodeKind,
    id: string,
    expectedPrefix: string,
    seenTitles: Set<string>,
  ): Snapshot | null {
    const file = raw.file;
    const parsed = parseSnapshotName(file);
    if (
      !parsed ||
      parsed.kind !== kind ||
      parsed.id !== id ||
      !file.startsWith(expectedPrefix)
    ) {
      return null;
    }
    if (seenTitles.has(raw.title.toLowerCase())) return null;
    seenTitles.add(raw.title.toLowerCase());
    // A malformed `contentHash` reads as not yet computed, as in
    // `parseHashes`. A hash that does not match the bytes is found later,
    // when the disk file is hashed.
    const ch = (raw as unknown as Record<string, unknown>).contentHash;
    const contentHash =
      typeof ch === "string" && /^[0-9a-f]{64}$/.test(ch) ? ch : undefined;
    return {
      file,
      title: raw.title,
      created: raw.created,
      ...(contentHash ? { contentHash } : {}),
    };
  }

  /**
   * One node. `strict` is true for live nodes and false for removed ones;
   * `seenFiles` is per list, because live and removed files sit in different
   * folders.
   */
  function readNode(
    node: DocNode,
    strict: boolean,
    seenFiles: Set<string>,
  ): DocNode | null {
    const problem = (
      code: string,
      values?: Record<string, string | number>,
    ) => {
      const err = { code, values };
      if (strict) errors.push(err);
      else warnings.push(err);
    };

    const list = snapshots[node.id];
    if (!Array.isArray(list) || list.length === 0) {
      problem("snapshotsEmpty", { id: node.id, title: node.title });
      return null;
    }

    const expectedPrefix = prefixFor(node.kind);
    const parsed: Snapshot[] = [];
    const seenTitles = new Set<string>();
    for (const raw of list) {
      const snap = readSnapshot(
        raw,
        node.kind,
        node.id,
        expectedPrefix,
        seenTitles,
      );
      if (!snap) {
        problem("snapshotEntryBad", { id: node.id, title: node.title });
        return null;
      }
      if (seenFiles.has(snap.file.toLowerCase())) {
        problem("duplicateSnapshotFile", { file: snap.file });
        return null;
      }
      seenFiles.add(snap.file.toLowerCase());
      parsed.push(snap);
    }

    if (!parsed.some((s) => s.file === node.adopted)) {
      problem("adoptedNotListed", { adopted: node.adopted });
      return null;
    }

    // At live and removed nodes alike.
    const bound = summaries[node.id];
    let summary: string | undefined;
    if (bound !== undefined) {
      const expected = `${SUMMARY_PREFIX}${node.id}${MD_EXT}`;
      if (bound === expected) summary = bound;
      else {
        warnings.push({
          code: "summaryMismatch",
          values: { title: node.title, value: bound, expected },
        });
      }
    }

    if (node.kind === "part") {
      const children: DocNode[] = [];
      for (const child of node.children) {
        const next = readNode(child, strict, seenFiles);
        if (next) children.push(next);
      }
      return { ...node, snapshots: parsed, children, summary };
    }
    return { ...node, snapshots: parsed, summary };
  }

  // File-name uniqueness is judged per folder: one set across every live node,
  // whose files share `document/`, and a fresh set for the removed list, whose
  // files sit in `recyclebin/` and may repeat those names.
  const liveSeenFiles = new Set<string>();
  const children: DocNode[] = [];
  for (const node of structure.children) {
    const next = readNode(node, true, liveSeenFiles);
    if (next) children.push(next);
  }
  if (errors.length > 0) return { ok: false, errors };

  const removedSeenFiles = new Set<string>();
  const removed: DocNode[] = [];
  for (const node of structure.removed ?? []) {
    const next = readNode(node, false, removedSeenFiles);
    if (next) removed.push(next);
  }

  return {
    ok: true,
    structure: { ...structure, children, removed },
    warnings,
  };
}

// ── The open pipeline's first checks ─────────────────────────────────────────

export function validateProperties(raw: string | null): StructureError[] {
  if (raw === null) return [{ code: "missingProperties" }];

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [{ code: "propertiesParse" }];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return [{ code: "propertiesParse" }];
  }

  // A file from a newer build is refused, never opened: this reader keeps
  // only the fields it knows, and its next write would drop the rest.
  const version = (data as Record<string, unknown>).schemaVersion;
  if (typeof version === "number" && version > SCHEMA_VERSION) {
    return [
      {
        code: "propertiesNewer",
        values: { version, supported: SCHEMA_VERSION },
      },
    ];
  }

  const doc = (data as Record<string, unknown>).document;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return [{ code: "propertiesField", values: { field: "document" } }];
  }
  const title = (doc as Record<string, unknown>).title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return [{ code: "propertiesField", values: { field: "document.title" } }];
  }
  return [];
}

// ── Forgiving read ───────────────────────────────────────────────────────────

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * A panel's width in pixels, or null: any finite positive number. The clamp
 * to the panel's real limits belongs where the value is applied.
 */
function asPixelWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/** The snapshot tab's divider fraction, strictly between 0 and 1, or null. */
function asSnapshotSplit(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 1
    ? value
    : null;
}

/**
 * The pairing hint, or null. A malformed `sync` block never refuses a folder
 * (`validateProperties` does not read it); it degrades to not paired, which
 * costs a re-pair, never data.
 */
function parseSync(value: unknown): DocumentSyncState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const remote = (value as Record<string, unknown>).remote;
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
    return null;
  }
  const { providerId, key } = remote as Record<string, unknown>;
  return typeof providerId === "string" &&
    providerId.length > 0 &&
    typeof key === "string" &&
    key.length > 0
    ? { remote: { providerId, key } }
    : null;
}

function parseUi(value: unknown): DocumentUiState {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    expanded: [...new Set(asStringArray(raw.expanded))],
    lastOpened: typeof raw.lastOpened === "string" ? raw.lastOpened : null,
    session: parseSession(raw.session),
    dockWidth: asPixelWidth(raw.dockWidth),
    structureWidth: asPixelWidth(raw.structureWidth),
    commentsHidden:
      typeof raw.commentsHidden === "boolean" ? raw.commentsHidden : null,
    snapshotSplit: asSnapshotSplit(raw.snapshotSplit),
    // A size outside the three presets, or a non-boolean toggle, is null.
    proseSize: (PROSE_SIZES as readonly number[]).includes(
      raw.proseSize as number,
    )
      ? (raw.proseSize as ProseSize)
      : null,
    typewriter: typeof raw.typewriter === "boolean" ? raw.typewriter : null,
    focus: isFocusMode(raw.focus) ? raw.focus : null,
    smoothCaret: typeof raw.smoothCaret === "boolean" ? raw.smoothCaret : null,
    autosave: typeof raw.autosave === "boolean" ? raw.autosave : null,
    autosaveDelay: asDelay(raw.autosaveDelay),
    henosis: typeof raw.henosis === "boolean" ? raw.henosis : null,
    henosisAfter: asPreset(raw.henosisAfter, HENOSIS_AFTER_PRESETS),
    henosisFade: asPreset(raw.henosisFade, HENOSIS_FADE_PRESETS),
    henosisPause: asPreset(raw.henosisPause, HENOSIS_PAUSE_PRESETS),
  };
}

/** One of a setting's named steps, or null: Henosis's Y, X and P. */
function asPreset(value: unknown, presets: readonly number[]): number | null {
  return typeof value === "number" && presets.includes(value) ? value : null;
}

/**
 * Whether a value is an autosave delay in seconds: one of the preset
 * select's steps.
 */
function isDelay(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (AUTOSAVE_DELAY_PRESETS as readonly number[]).includes(value)
  );
}

function asDelay(value: unknown): number | null {
  return isDelay(value) ? value : null;
}

/**
 * The session baseline, or null. Half a session is none: a stamp with no
 * count would make the Desk print a delta against zero, as if the writer had
 * written the whole project this morning.
 */
function parseSession(value: unknown): WritingSession | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.startedAt !== "string" || raw.startedAt === "") return null;
  if (
    typeof raw.words !== "number" ||
    !Number.isFinite(raw.words) ||
    raw.words < 0
  )
    return null;
  return { startedAt: raw.startedAt, words: Math.floor(raw.words) };
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** The longest author name kept: a byline, not a paragraph. */
export const AUTHOR_MAX = 200;

/**
 * An author name as the file may hold it: one line, trimmed, bounded. The
 * file is hand-editable, and the name travels into export metadata and
 * running heads, where a line break or a page of text would break the page.
 */
export function asAuthor(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/\s+/g, " ").trim())
    .slice(0, AUTHOR_MAX)
    .join("")
    .trim();
}

/**
 * A word goal of at least one, floored, or null. A hand-edited `goal: 0.5`
 * costs the goal, never an impossible "0 words to write".
 */
export function asGoal(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : null;
}

function parseNodeStats(value: unknown): NodeStat[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: NodeStat[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    // `nodeId` is the key; a count without one names no node and is dropped.
    const nodeId = raw.nodeId;
    if (typeof nodeId !== "string" || !nodeId || seen.has(nodeId)) continue;
    seen.add(nodeId);
    // The session delta is a finite integer, negative allowed because cutting
    // is work, or absent. It is summed nowhere, since the totals read `words`
    // only, so a hostile value never feeds arithmetic.
    const delta =
      typeof raw.lastDelta === "number" &&
      Number.isInteger(raw.lastDelta) &&
      Number.isFinite(raw.lastDelta)
        ? raw.lastDelta
        : undefined;
    out.push({
      nodeId,
      words: asCount(raw.words),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
      ...(delta !== undefined ? { lastDelta: delta } : {}),
    });
  }
  return out;
}

/**
 * Stats are derived, so a damaged block costs a recount, never an open. The
 * totals are read as written, not re-derived from `perNode`, because the
 * editor may have counted files the reader cannot see.
 */
function parseStats(value: unknown, fallbackAt: string): DocumentStats {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return emptyStats(fallbackAt);
  const raw = value as Record<string, unknown>;
  return {
    words: asCount(raw.words),
    parts: asCount(raw.parts),
    sections: asCount(raw.sections),
    countedAt: typeof raw.countedAt === "string" ? raw.countedAt : fallbackAt,
    perNode: parseNodeStats(raw.perNode),
  };
}

export function parseProperties(
  raw: string | null,
  fallbackTitle: string,
): DocumentProperties {
  // Old shapes are not adopted: when the shape changes, stale local data is
  // cleared, never migrated.
  const defaults = defaultProperties(fallbackTitle);
  if (!raw) return defaults;

  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return defaults;
    data = parsed as Record<string, unknown>;
  } catch {
    return defaults;
  }

  const doc = (data.document ?? {}) as Record<string, unknown>;

  // The nine facts after the id (title through tropes) go through the guards
  // the Properties window writes with, `guarded` in `facts.ts`. A
  // guard changed here must change there too, or the window could write a
  // value this reader would not keep.
  return {
    schemaVersion:
      typeof data.schemaVersion === "number"
        ? data.schemaVersion
        : SCHEMA_VERSION,
    document: {
      id: asString(doc.id, defaults.document.id),
      title: asString(doc.title, fallbackTitle),
      author: asAuthor(doc.author),
      type: asDocumentType(doc.type),
      structure: asStructureId(doc.structure),
      language: asString(doc.language, defaults.document.language),
      createdAt: asString(doc.createdAt, defaults.document.createdAt),
      updatedAt: asString(doc.updatedAt, defaults.document.updatedAt),
      goal: asGoal(doc.goal),
      genres: asGenres(doc.genres),
      ageCategory: asAgeCategory(doc.ageCategory),
      tropes: asTropes(doc.tropes),
    },
    sync: parseSync(data.sync),
    ui: parseUi(data.ui),
    stats: parseStats(data.stats, defaults.stats.countedAt),
    snapshotHashes: parseHashes(data.snapshotHashes),
    summaries: parseSummaries(data.summaries),
  };
}

export function serializeProperties(props: DocumentProperties): string {
  const out: DocumentProperties = {
    ...props,
    schemaVersion: SCHEMA_VERSION,
    document: { ...props.document, updatedAt: new Date().toISOString() },
  };
  // Trailing newline and two-space indent: the file lives in the writer's
  // folder and may end up in their git history.
  return `${JSON.stringify(out, null, 2)}\n`;
}

// ── Edits ────────────────────────────────────────────────────────────────────
//
// Each takes the latest properties and returns the next. `null` means no
// change, and the properties lane then writes nothing.

/** Binds a node's summary file. */
export function withSummary(
  props: DocumentProperties,
  nodeId: string,
  fileName: string,
): DocumentProperties {
  return { ...props, summaries: { ...props.summaries, [nodeId]: fileName } };
}

/** Drops a node's summary binding, or null when it has none. */
export function withoutSummary(
  props: DocumentProperties,
  nodeId: string,
): DocumentProperties | null {
  if (!(nodeId in props.summaries)) return null;
  const summaries = { ...props.summaries };
  delete summaries[nodeId];
  return { ...props, summaries };
}

/**
 * Merges fields into the `ui` block. The rest of `ui` is spread through
 * rather than rebuilt: a literal erases every key it does not name, the
 * session baseline among them.
 */
export function withUi(
  props: DocumentProperties,
  next: Partial<DocumentUiState>,
): DocumentProperties {
  return { ...props, ui: { ...props.ui, ...next } };
}

/**
 * Clears a `lastOpened` that names a node in `ids`, or null when it names
 * none: a removed node is not a place to resume.
 */
export function withoutLastOpened(
  props: DocumentProperties,
  ids: ReadonlySet<string>,
): DocumentProperties | null {
  return ids.has(props.ui.lastOpened ?? "")
    ? withUi(props, { lastOpened: null })
    : null;
}
