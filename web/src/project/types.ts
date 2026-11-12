// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { AgeCategory, GenreId } from "./genres";
import type { FocusMode, ProseSize } from "../editor/views/view/port";

// What a view setting is belongs to the writing view; a project stores it.
export type { FocusMode, ProseSize };
// ── The document model ───────────────────────────────────────────────────────
//
// A project is a root folder holding the settings
// (`document-properties.json`), the shape (`document-structure.yaml`), and a
// flat `document/` folder of markdown. Every Part and Section file sits side
// by side there; nesting exists only in the yaml.
//
// Moving a node is therefore a single yaml write that touches no file, so a
// drag cannot half-fail and leave the document in a shape nobody chose.
//
// A Part or a Section is a set of snapshot files; the yaml names the adopted
// one, the node's live content, and the catalogue lists every snapshot. Nodes
// are referenced by id and files by name, two namespaces with different
// lifecycles; `naming.ts` spells both.

/** A Part contains other nodes; a Section contains nothing but its own text. */
export type NodeKind = "part" | "section";

/** What a container holds. The Golden Rule forbids a fourth case, 'mixed'. */
export type ChildKind = NodeKind | "empty";

/**
 * The reference document that summarises this node, if it has one.
 *
 * The binding is kept in the properties file's `summaries`, and the file name
 * echoes it (`summary--EL1.md`, named for the node's id, which no rename
 * changes), so a human reading `reference/` sees the pairing. The reconcile
 * requires the two to agree, as the `part:` or `section:` key must agree with
 * the file prefix.
 *
 * Unlike those, a mismatch here degrades rather than refuses: a wrong `part:`
 * makes the document ambiguous, while a wrong binding only makes an
 * annotation wrong, and a novel must not be refused over a mistyped
 * annotation.
 */
export type Summary = string | undefined;

/**
 * One snapshot of a Part or Section: a literal file in `document/` plus the
 * two properties the dock's table shows. The file itself is the content.
 *
 * The edit time is not here: the table reads `stats.perNode[].updatedAt`,
 * written by the same save, and this stays the immutable creation
 * record.
 */
export interface Snapshot {
  /** The literal file in `document/` (`section--the_storm.EL3.01.md`). */
  file: string;
  /** The display title, unique among the node's snapshots, ignoring case. */
  title: string;
  /** When the file was created: the table's date. Never updated on edit. */
  created: string;
  /**
   * SHA-256 hex of the canonical file content (`contentHash.canonicalize`),
   * so an out-of-band edit (VS Code, git, Remote Storage sync) is detected on
   * open or reload. Warn-only: a mismatch never refuses the open; it marks the
   * node out-of-band. Missing means not yet computed, and backfill fills it;
   * the next save or backfill persists a fresh hash and clears the flag.
   *
   * A hash of the app's string, not of provider bytes, so local and Remote
   * Storage copies agree regardless of encoding. Canonicalization turns CRLF
   * into LF and strips a leading BOM, so line-ending churn is not a change.
   */
  contentHash?: string;
}

export interface SectionNode {
  kind: "section";
  /** The stable human-readable identity (`EL2`); no rename changes it. */
  id: string;
  /** The display name the tree shows; the yaml's `section:` value. */
  title: string;
  /** The node's live file, which the editor edits. */
  adopted: string;
  /** Every snapshot of the node, adopted included. Never empty. */
  snapshots: Snapshot[];
  /** `reference/summary--EL2.md`, when one is bound (`Summary`). */
  summary?: Summary;
}

export interface PartNode {
  kind: "part";
  id: string;
  title: string;
  adopted: string;
  snapshots: Snapshot[];
  /**
   * Homogeneous by the Golden Rule: all Parts or all Sections, never both.
   * Typed loosely because the invariant is enforced where the error messages
   * can be good: the structure validator and the mutation helpers.
   */
  children: DocNode[];
  /** The Part's own summary, as on `SectionNode`. */
  summary?: Summary;
}

export type DocNode = PartNode | SectionNode;

export interface DocumentStructure {
  version: number;
  /** The root's children; the root is a container with no file of its own. */
  children: DocNode[];
  /**
   * The subtrees sent to the bin. Optional only so test fixtures that never
   * touch the bin need not name it; `emptyStructure` and `parseStructure`
   * always carry the list, so readers treat absence as `[]`.
   */
  removed?: DocNode[];
}

export const STRUCTURE_VERSION = 1;

// ── The properties file ──────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;

/**
 * The document's type as the writer picked it in the creation dialog: the
 * English name verbatim ("Novel", "Epic Novel") or the text typed for Other.
 * A free string, because the value lands in the writer's own file and must
 * survive a locale change and a hand-edit. Code that branches on it compares
 * against `DOCUMENT_TYPE_OPTIONS`.
 */
export type DocumentType = string;

/** The named types the creation dialog offers, stored as written. */
export const DOCUMENT_TYPE_OPTIONS = [
  "Novel",
  "Epic Novel",
  "Short Story",
  "Novella",
  "Flash Fiction",
] as const;

/** The dialog's sixth option; never persisted, the custom text is. */
export const OTHER_DOCUMENT_TYPE = "Other";

/** One of the named types, as the file stores it. */
export type NamedDocumentType = (typeof DOCUMENT_TYPE_OPTIONS)[number];

/**
 * Each named type's name in the locales: its display name is
 * `create.typeName.<slug>`, its word-count guidance `create.typeGuide.<slug>`.
 * Keyed by the named types, as is `TYPE_GOAL_DEFAULTS`, so a type added to
 * `DOCUMENT_TYPE_OPTIONS` without its words fails the typecheck rather than
 * showing a raw key.
 *
 * The file keeps the English name, and only what the writer sees follows the
 * interface language. A custom type is shown as typed.
 */
const TYPE_SLUGS: Readonly<Record<NamedDocumentType, string>> = {
  Novel: "novel",
  "Epic Novel": "epicNovel",
  "Short Story": "shortStory",
  Novella: "novella",
  "Flash Fiction": "flashFiction",
};

function slugOf(type: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(TYPE_SLUGS, type)
    ? TYPE_SLUGS[type as NamedDocumentType]
    : undefined;
}

/** A type as the writer reads it: named ones translated, custom as typed. */
export function documentTypeLabel(
  type: DocumentType,
  t: (key: string) => string,
): string {
  if (type === OTHER_DOCUMENT_TYPE) return t("create.typeName.other");
  const slug = slugOf(type);
  return slug ? t(`create.typeName.${slug}`) : type;
}

/** A named type's word-count guidance key; null for Other or a custom type. */
export function documentTypeGuideKey(type: string): string | null {
  const slug = slugOf(type);
  return slug ? `create.typeGuide.${slug}` : null;
}

/** What an empty or unreadable `type` falls back to. */
export const DEFAULT_DOCUMENT_TYPE: DocumentType = "Novel";

/**
 * The top of each named type's word-count guidance (`create.typeGuide.*`),
 * where a new project's goal starts. Here rather than in the creation
 * dialog because the import proposes a goal from the same numbers. Other has
 * no guidance, so no entry.
 */
export const TYPE_GOAL_DEFAULTS: Readonly<
  Record<NamedDocumentType, number> & Record<string, number | undefined>
> = {
  Novel: 110_000,
  "Epic Novel": 110_000,
  Novella: 50_000,
  "Short Story": 7_500,
  "Flash Fiction": 1_000,
};

/**
 * The named type a manuscript of this length most likely is, read off the
 * same guidance ranges the creation dialog shows: under 1,000 words is flash
 * fiction, under 20,000 a short story (the guidance's 7,500 is where a short
 * story usually ends, not where a novella begins), under 50,000 a novella, up
 * to 110,000 a novel, and beyond that an epic. A proposal only: the import
 * shows it as a choice the writer can change.
 */
export function typeForWords(words: number): DocumentType {
  if (words < 1_000) return "Flash Fiction";
  if (words < 20_000) return "Short Story";
  if (words < 50_000) return "Novella";
  if (words <= 110_000) return "Novel";
  return "Epic Novel";
}

export interface DocumentMeta {
  id: string;
  title: string;
  /**
   * The name the book goes out under: an export's byline, its EPUB creator,
   * a manuscript's running head. Empty until the writer says it; the
   * export window offers the account's name the first time. It stays in the
   * writer's own file and is not card content: the shelf has no use for it.
   */
  author: string;
  type: DocumentType;
  /**
   * The structure the writer started from, as a `ShapeId` ("threeact",
   * "kishotenketsu", …), or null when none was chosen and no Parts were
   * created. Recorded so the creation choice outlives the dialog and is read,
   * not guessed from the yaml.
   */
  structure: string | null;
  language: string;
  createdAt: string;
  updatedAt: string;
  /** A word target for the whole document, or null when none is set. */
  goal: number | null;
  /**
   * The genres the writer declared, lead first, at most two (`genres.ts`).
   * Empty means not said, never no genre: the assistant then reads the book
   * without a genre's promise rather than guessing one.
   */
  genres: GenreId[];
  /** Who the book is written for, or null when the writer has not said. */
  ageCategory: AgeCategory | null;
  /**
   * The tropes the writer means the book to deliver, in their own words
   * (`asTropes`). Empty means not said.
   */
  tropes: string[];
}

// ── Stats ────────────────────────────────────────────────────────────────────
//
// What the Library needs to draw a document it has not opened: how long it
// is, what shape it is, and which parts were touched most recently.
//
// They live in the properties file, the one place a document's own facts are
// kept, so the Library learns them from a single read. The spine glyph is
// drawn from `perNode` (bar width from `words`, opacity from how recent
// `updatedAt` is), so it is a per-node list rather than a total.
//
// It covers Parts as well as Sections, because a Part's file holds the
// writer's own text too; Sections alone would under-count the document. The
// spine draws only the Sections, grouped by Part.
//
// Only the editor produces these, because only the editor has the text.

export interface NodeStat {
  /** The node's id (`EL2`), stable across renames and adoptions. */
  nodeId: string;
  words: number;
  /**
   * When the app last wrote this node's file. Absent for nodes the stats
   * backfill counted but this editor never wrote, and in a fresh project: a
   * backfill must not fabricate an edit time.
   */
  updatedAt?: string;
  /**
   * How many words this node's last writing session added or removed,
   * positive for written words and negative for cut ones. Settled at the
   * session's exit by diffing the baseline against the counted words; a
   * visit that changed nothing leaves the previous value, the last session
   * with work, in place. Derived from word counts only, never manuscript
   * text.
   *
   * A fact about one writer's sitting, so it stays in the properties file:
   * `asNodeStats`, the `CardContent` reducer, drops it, and adding it to
   * `CardContent` would widen what a synced profile holds and need a privacy
   * review.
   */
  lastDelta?: number;
}

export interface DocumentStats {
  words: number;
  parts: number;
  sections: number;
  /** When the count was taken; the Library shows it rather than implying a
   *  live count. */
  countedAt: string;
  perNode: NodeStat[];
}

/**
 * Three sizes, not a slider: three named steps are a choice made once. 19 is
 * the middle and the default: the size the measure was drawn against, about
 * sixty-six characters on a 680px line.
 *
 * The constants sit beside `DocumentUiState` because the size is a property
 * of the project, not of the browser; the view declares the steps it draws.
 */
export const PROSE_SIZES = [17, 19, 21] as const satisfies readonly ProseSize[];
export const DEFAULT_PROSE_SIZE: ProseSize = 19;

/**
 * The autosave safety net. Off by default: a project saves when the writer
 * says so, and autosave is switched on from the bar, with the delay in
 * seconds set in the preferences panel. The delay is one select with six
 * named steps, so the writer picks "1 min", never 47 seconds; a hand-edited
 * value outside them reads as unset.
 */
export const DEFAULT_AUTOSAVE_DELAY_S = 30;
export const AUTOSAVE_DELAY_PRESETS = [5, 10, 30, 60, 120, 300] as const;

/**
 * Henosis mode: after Y seconds of writing the room fades out over X,
 * and once it has gone the prose widens; a pause longer than P brings it back.
 * Off by default, because it takes the whole editor away. Y, X and P are
 * whole seconds from 0 to 10, eleven named steps rather than a dial, so a
 * hand-edited 7.5 reads as unset. 0 is a step: the fade starts at the first
 * keystroke, or the room goes at once.
 */
const ZERO_TO_TEN = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const HENOSIS_AFTER_PRESETS = ZERO_TO_TEN;
export const DEFAULT_HENOSIS_AFTER_S = 2;
export const HENOSIS_FADE_PRESETS = ZERO_TO_TEN;
export const DEFAULT_HENOSIS_FADE_S = 3;
/** P: a pause in the writing this long ends the mode. */
export const HENOSIS_PAUSE_PRESETS = ZERO_TO_TEN;
export const DEFAULT_HENOSIS_PAUSE_S = 10;
/**
 * The settings panel's fields as stored: null where the writer has not set
 * them, so the project defaults apply (typewriter off, focus off, smooth
 * caret off, autosave off, 30s once autosave is on, 19px, Henosis off).
 */
export interface WritingPrefs {
  proseSize: ProseSize | null;
  typewriter: boolean | null;
  focus: FocusMode | null;
  /** The caret's typing spring; off by default. */
  smoothCaret: boolean | null;
  autosave: boolean | null;
  /** Seconds, when autosave is on; the bar's checkbox is the master switch. */
  autosaveDelay: number | null;
  /** Henosis mode; off by default. */
  henosis: boolean | null;
  /** Y, in seconds: one of `HENOSIS_AFTER_PRESETS`. */
  henosisAfter: number | null;
  /** X, in seconds: one of `HENOSIS_FADE_PRESETS`. */
  henosisFade: number | null;
  /** P, in seconds: one of `HENOSIS_PAUSE_PRESETS`. */
  henosisPause: number | null;
}

export interface DocumentUiState extends WritingPrefs {
  /** The ids of the Parts left open; a rename never invalidates an id. */
  expanded: string[];
  /** The id of the node to restore on open, if it still exists. */
  lastOpened: string | null;
  /**
   * How wide the dock (reference, assistant and snapshot panel) was left, in
   * pixels; null until the writer first drags its handle. The clamp to the
   * dock's real limits happens where the width is applied.
   */
  dockWidth: number | null;
  /**
   * How wide the structure panel was left, in pixels; null until the writer
   * first drags its edge, and clamped where it is applied.
   *
   * Panel geometry is the project's own memory and never reaches the profile:
   * nothing in `ui` is in `CardContent` (`profile/profileStore.ts`).
   */
  structureWidth: number | null;
  /**
   * Whether the writer put the margin's comments away: none drawn, no
   * passage painted, no room kept beside the prose. Null means shown, the
   * default. The comments themselves are untouched and still counted in the
   * structure.
   */
  commentsHidden: boolean | null;
  /**
   * Where the snapshot tab's divider was left, as a fraction of the panel
   * height; null until the writer first drags it. The clamp to the panel's
   * real limits happens where the split is applied.
   */
  snapshotSplit: number | null;
  /**
   * Where this writing session started, so the Desk can say what has changed
   * rather than only what exists: a writer coming back wants "what did I do",
   * not "how big is the project".
   *
   * In `ui` rather than `stats`, because `stats` counts the project for the
   * Library, while this is a fact about one person's last sitting. Null
   * before the first session (`deskLedger.ts`).
   */
  session: WritingSession | null;
}

export interface WritingSession {
  /** When the session began, ISO. */
  startedAt: string;
  /** The project's word count at that moment. */
  words: number;
}

// ── Sync pairing ─────────────────────────────────────────────────────────────
//
// A hint, never the authority: sync trusts the device's own IndexedDB
// manifest. This lets a second device re-establish the pairing after picking
// the local folder again. Losing it costs a re-pair, not data, and
// `parseProperties` reads an unknown `sync` shape as unpaired.
//
// It names the provider as well as the key, because the record
// travels in a file the writer syncs between machines, and a bare folder id
// does not say which backend it belongs to.

export interface DocumentSyncState {
  remote: { providerId: string; key: string };
}

/**
 * The project's snapshot records, in `snapshots-catalogue.json`: the one
 * place that says which files in `document/` and `recyclebin/` are
 * snapshots, keyed by the node's stable id. It holds nothing else, so it
 * changes only when a snapshot is taken, renamed, binned, restored or
 * deleted, and the sync compares it like the files it lists.
 */
export interface SnapshotCatalogue {
  /**
   * Every node's snapshot list, live and removed alike, with no
   * `contentHash` (`DocumentProperties.snapshotHashes` holds them).
   * `document-structure.yaml` keeps only the shape (id, display name,
   * `adopted`, children), so creating a snapshot is one catalogue write and
   * adopting one is one yaml write. A snapshot is the prose, so
   * `reconcileRecords` validates this strictly and a corrupt record refuses
   * the open.
   */
  snapshots: Record<string, Snapshot[]>;
  /**
   * Snapshots the writer sent to the recycle bin, keyed by the node they came
   * from. They are not in `snapshots`, which is derived from the structure,
   * so the panel stops listing one the moment it is binned.
   *
   * The record travels with the file because the title is the writer's own
   * words: the bin row shows them, as the delete confirm does, rather than a
   * file name such as `section--the_flame.EL10.01.md`.
   *
   * A binned snapshot's journal section is deleted with it, unlike a removed
   * node's. `addSnapshot` counts past these records, so no new snapshot takes
   * a binned file's name, and the restore still refuses a name that is in
   * `document/` again.
   */
  binned: Record<string, Snapshot[]>;
}

export interface DocumentProperties {
  schemaVersion: number;
  document: DocumentMeta;
  /** Null when the project has never been paired with a remote folder. */
  sync: DocumentSyncState | null;
  ui: DocumentUiState;
  stats: DocumentStats;
  /**
   * Each snapshot file's `contentHash`, keyed by its file name. Here and not
   * in the catalogue because a save changes it: in a file the sync compares,
   * two devices writing different Sections would always conflict. The open
   * joins them to the catalogue's records.
   */
  snapshotHashes: Record<string, string>;
  /** Each node's summary binding (`summary--EL1.md`), keyed by node id (`Summary`). */
  summaries: Record<string, string>;
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Why a folder could not be opened as a project. `line` is present when the
 * problem came from a YAML parse that located it.
 */
export interface StructureError {
  /** Message key, resolved through i18n by the panel. */
  code: string;
  /** Interpolation values for the message: file names, counts, lines. */
  values?: Record<string, string | number>;
  line?: number;
}
