// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { NodeKind } from "./types";
import { PRODUCT } from "../product";
import { isWindowsDeviceName } from "../text/deviceNames";

// ── Names, prefixes and paths ────────────────────────────────────────────────
//
// One node, many files. A Part or a Section is a set of snapshot files in
// `document/` (`part--act_one.EL1.00.md`, `part--act_one.EL1.01.md`), and the
// yaml says which one is adopted, the node's live content. The node has a
// stable, human-readable id (`EL1`, `EL399`) that is in every one of its file
// names: a rename re-stems the files but keeps the id, so every reference
// (journal, stats, lastOpened, chat, summary) survives it, and no two nodes
// share a file.
//
// The prefix makes a flat `document/` folder legible: the kind shows without
// opening the yaml. The slug, the transliterated display name, is what the
// writer reads in a file manager. A slug holds no dots, so the `.id.xy`
// positions are deterministic.

export const PART_PREFIX = "part--";
export const SECTION_PREFIX = "section--";
export const MD_EXT = ".md";

/**
 * The prefixes the open half is read by; `reference.ts` groups by them.
 *
 * `summary--` carries a binding: `summary--EL1.md` belongs to the node `EL1`,
 * and the structure file holds the same pair so neither side drifts alone.
 * The binding is by id, so the file never re-stems when the node is renamed.
 */
export const SUMMARY_PREFIX = "summary--";
// `guidebook` is the reference group's id on disk: the writer's files keep
// that prefix although the product says project.
export const GUIDEBOOK_PREFIX = "guidebook--";
export const CHARACTER_PREFIX = "character--";
export const ARC_PREFIX = "arc--";
export const WORLD_PREFIX = "world--";
export const NOTES_PREFIX = "notes--";

export const CHAT_PREFIX = "chat--";

export const DOCUMENT_DIR = "/document";
/** The recycle bin: nodes removed from the document move here. */
export const RECYCLE_BIN_DIR = "/recyclebin";
export const PROPERTIES_FILE = "/document-properties.json";
export const STRUCTURE_FILE = "/document-structure.yaml";
/** The snapshot records (`SnapshotCatalogue`). */
export const SNAPSHOTS_CATALOGUE_FILE = "/snapshots-catalogue.json";
/**
 * The undo timeline's journals: one file per snapshot file, each an opaque
 * blob written by the engine's `DeltaTimeline` and moved by the shell, never
 * hand-edited. The folder sits at the project root (bucket a, the writer's
 * own folder), not under `document/` or `APP_CACHE_DIR`: a journal is not a
 * node, and it is not rebuildable.
 *
 * One file per snapshot, so one Section's large or unreadable journal never
 * blocks or evicts another's. Named by snapshot file name, not by node id:
 * changes tracked for snapshot `.00` do not apply to `.01`, so each snapshot
 * keeps its own undo timeline through adoption cycles.
 */
export const HISTORY_DIR = "/history";

/** The one spelling of a snapshot file's journal. */
export function historyPath(fileName: string): string {
  return `${HISTORY_DIR}/${fileName}.json`;
}

// ── The open half of the project ─────────────────────────────────────────────
//
// Strict validation stops at `document/` and the two manifests above. The
// folders below are freeform: the assistant's personas, rules and skills,
// whatever the document is written against, and a derived cache holding only
// what can be rebuilt.

export const ASSISTANT_DIR = "/assistant";
/**
 * Everything the assistant keeps that is not a chat: review runs, the fact
 * ledgers, the kept judgements and groupings, the rule checks. A writer
 * opening `assistant/` sees their conversations and one folder, not a hundred
 * hashed machine files between them. Chats stay flat at the top
 * because the chat list is a listing of that one folder; memory is written
 * and read by path, never listed.
 */
export const ASSISTANT_MEMORY_DIR = `${ASSISTANT_DIR}/memory`;
/**
 * The sources the writer barred from the assistant (`barredSources.ts`).
 * Under `assistant/`, so the sync scans it and a bar set on one device holds
 * on every paired copy.
 */
export const BARRED_SOURCES_FILE = `${ASSISTANT_DIR}/barred-sources.json`;
export const REFERENCE_DIR = "/reference";
/**
 * The app's own hidden folder inside a local project (conflict backups). The
 * resolution UI names its path, so it carries the product's public name in
 * the form a folder can hold. A folder made under an earlier name is
 * left where it is.
 */
export const APP_CACHE_DIR = `/.${PRODUCT.kebab}`;
/**
 * Where an export is kept: `export/<name>.<ext>`, beside the book it
 * was made from, in every home the book has. It is the one folder in a
 * project that holds binary files, so every walk that reads a whole project
 * as text must skip it (`project/transfer.ts`).
 */
export const EXPORT_DIR = "/export";
/**
 * Where the margin's comments are kept: one file per node,
 * `comments/<nodeId>.json`, named by the id so a rename never moves it and a
 * node binned and restored keeps it. Only the nodes the live structure names
 * are read, and the folder is never listed, so a binned chapter's comments
 * are invisible without being moved.
 */
export const COMMENTS_DIR = "/comments";

/** The one spelling of a node's comments file. */
export function commentsFilePath(nodeId: string): string {
  return `${COMMENTS_DIR}/${nodeId}.json`;
}

export function prefixFor(kind: NodeKind): string {
  return kind === "part" ? PART_PREFIX : SECTION_PREFIX;
}

/**
 * A file name without its `.md` extension, kept in its own case. Reference
 * documents, their catalogues and the assistant's files all take this one
 * spelling, so none of them case-folds where the others do not.
 */
export function stemOf(fileName: string): string {
  return fileName.toLowerCase().endsWith(MD_EXT)
    ? fileName.slice(0, -MD_EXT.length)
    : fileName;
}

/** The stem without the prefix when the file carries it, case preserved. */
export function stemAfterPrefix(fileName: string, prefix: string): string {
  const stem = stemOf(fileName);
  return stem.startsWith(prefix) ? stem.slice(prefix.length) : stem;
}

/** The kind a file name declares, or null when it is not a document node. */
export function kindOf(fileName: string): NodeKind | null {
  if (!fileName.toLowerCase().endsWith(MD_EXT)) return null;
  if (fileName.startsWith(PART_PREFIX)) return "part";
  if (fileName.startsWith(SECTION_PREFIX)) return "section";
  return null;
}

/** Where a node's file lives on disk. */
export function filePath(fileName: string): string {
  return `${DOCUMENT_DIR}/${fileName}`;
}

/**
 * The one spelling of a chat's project path: the assistant adapter writes it,
 * and the panel recognises a queued path by it.
 */
export function chatFilePath(id: string): string {
  return `${ASSISTANT_DIR}/${CHAT_PREFIX}${id}.json`;
}

// ── The slug ─────────────────────────────────────────────────────────────────
//
// The display-name-to-file-stem rule, shared by node files, snapshot files,
// summary bindings and project folders. One algorithm, parameterized by
// separator, so no two parts of the app disagree about what a name becomes.
//
// Letters and digits from any script survive (`Perché` keeps its é).
// Apostrophes join rather than separate ("L'Isola" is one word). Everything
// else, spaces and punctuation and with them every path separator a platform
// reads, becomes the separator. The result holds no dots, so the snapshot
// `.xy` position is deterministic and a name crafted in the yaml cannot
// escape `document/`.
//
// ext4 and most Linux file systems cap a file name at 255 bytes of UTF-8, and
// a 120-character title in a three-byte script is 360. The slug keeps at most
// `SLUG_MAX_BYTES`, which leaves room for the longest prefix, the
// `.id.xy.md` tail and a journal's `.json`. It is a label, so a cut
// one loses nothing.

/** The UTF-8 bytes a slug keeps, cut on a whole character. */
const SLUG_MAX_BYTES = 200;

/** The most UTF-8 bytes a file name may take on the strictest platform. */
const MAX_FILE_NAME_BYTES = 255;

const utf8 = new TextEncoder();

function byteLength(text: string): number {
  return utf8.encode(text).length;
}

/** `text` cut to at most `max` UTF-8 bytes, on a whole character. */
function fitBytes(text: string, max: number): string {
  if (byteLength(text) <= max) return text;
  let out = "";
  let bytes = 0;
  for (const char of text) {
    const size = byteLength(char);
    if (bytes + size > max) break;
    out += char;
    bytes += size;
  }
  return out;
}

/** A display name as a file stem: 'My Section' → 'my_section'. */
export function toSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return fitBytes(slug, SLUG_MAX_BYTES).replace(/_+$/, "");
}

/**
 * A title as a project folder name: the same transliteration joined with `-`,
 * the folder convention (`once-dark/`), where the document's files use `_`.
 */
export function folderNameFor(title: string): string {
  return toSlug(title).replace(/_/g, "-");
}

/**
 * Whether a title can become a project, given the folder names already in use.
 *
 * Laxer than `validateReferenceName`: no illegal-character rule, because
 * those characters cannot survive `folderNameFor`. "Salt: A Novel" is a valid
 * title whose folder is `salt-a-novel`, and the title is the writer's.
 *
 * It refuses instead a title with nothing usable in it, like "???", which
 * produces no folder name at all.
 */
export function validateProjectName(
  raw: string,
  taken: Set<string>,
): NameProblem | null {
  const title = raw.trim();
  if (title.length === 0) return { code: "empty" };
  if (title.length > MAX_LENGTH)
    return { code: "tooLong", values: { max: MAX_LENGTH } };

  const folder = folderNameFor(title);
  if (folder.length === 0) return { code: "noFolderName" };
  if (isWindowsDeviceName(folder)) return { code: "reserved" };
  if (taken.has(folder)) return { code: "folderTaken", values: { folder } };
  return null;
}

// ── Snapshot file names ──────────────────────────────────────────────────────
//
// A snapshot's name is `prefix--slug.id.xy.md`: the slug is the display name
// transliterated, the id is the node's own (`EL12`), and `xy` is a zero-padded
// counter (00, 01, … 99, 100 …) that keeps the node's snapshots unique.
//
// The id makes a name unique and anchors it to its node; the slug is only for
// the writer browsing the folder, so two chapters may share a title.
// The validator anchors every name against the node's kind and id, so a
// crafted record cannot name another node's file, and a slug left stale by an
// interrupted rename, or by a writer renaming files by hand, does not stop a
// book from opening.

/** `section--my_section.EL2.01.md` from a kind, slug, node id and counter. */
export function snapshotFileName(
  kind: NodeKind,
  slug: string,
  id: string,
  xy: number,
): string {
  return `${prefixFor(kind)}${slug}.${id}.${String(xy).padStart(2, "0")}${MD_EXT}`;
}

export interface ParsedSnapshotName {
  kind: NodeKind;
  /** The transliterated display name the file was derived from; cosmetic. */
  slug: string;
  /** The node the file belongs to: the anchor the validator checks. */
  id: string;
  /** The snapshot counter: two to six digits on disk. */
  xy: number;
}

// The slug group allows the empty string: a title like "???" transliterates
// to nothing, and `part--.EL3.00.md` is a valid file name on every platform.
// The slug alphabet holds no separators, dots or trailing spaces, and the id
// group is fenced by dots on both sides, so nothing ambiguous hides in the
// empty form. The counter is two to six digits; an unbounded one could
// overflow `Number` in the ops that read it, and no project needs one.
const SNAPSHOT_RE =
  /^(part|section)--([\p{L}\p{N}_]*)\.(EL\d+)\.(\d{2,6})\.md$/u;

/**
 * The parts of a snapshot's file name, or null when it is not one. The test
 * is shape, not a registry: a bare `section--foo.md`, a name with no id, a
 * path escape or another suffix is not a snapshot name.
 */
export function parseSnapshotName(fileName: string): ParsedSnapshotName | null {
  const match = fileName.match(SNAPSHOT_RE);
  if (!match) return null;
  return {
    kind: match[1] === "part" ? "part" : "section",
    slug: match[2],
    id: match[3],
    xy: Number(match[4]),
  };
}

// ── Node ids ─────────────────────────────────────────────────────────────────
//
// The node's identity: the prefix `EL` (element) plus an increasing integer,
// created as max+1 over live and removed ids, so ids are never reused. It
// shows only in the yaml; the tree shows the display name. The shape is
// strict (`^EL\d+$`), so a hand-edited yaml cannot invent an id that reads
// ambiguously or collides with a file name derived from an id
// (`summary--EL1.md`).

export const ID_PREFIX = "EL";

export const ID_RE = /^EL\d+$/;

/**
 * The next id in a sequence: the max existing number plus one. `existing`
 * carries the live and the removed ids alike, so a removed node's id stays
 * taken and a restore never meets a live node reusing it.
 */
export function nextId(existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(ID_RE);
    if (match) max = Math.max(max, Number(match[0].slice(ID_PREFIX.length)));
  }
  return `${ID_PREFIX}${max + 1}`;
}

// ── Name validation ──────────────────────────────────────────────────────────
//
// Runs on every keystroke of the inline rename and create field, so it returns
// the first problem rather than all of them: a writer fixes one thing at a
// time. Null means the name is usable.

/** Characters Windows forbids in a file name, the strictest target platform. */
const ILLEGAL = /[\\/:*?"<>|]/;

/** Control characters: no platform accepts them, and they are invisible. */
function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const MAX_LENGTH = 120;

export interface NameProblem {
  code: string;
  values?: Record<string, string | number>;
}

/**
 * The platform's rules, in one order. A validator such as
 * `validateReferenceName` owns what differs (which prefixes to forbid, how a
 * duplicate is recognised) and calls this for what does not: a name Windows
 * will not host, whatever the file will be.
 */
function platformChecks(
  title: string,
  forbiddenPrefixes: string[],
): NameProblem | null {
  if (title.length === 0) return { code: "empty" };
  if (title.length > MAX_LENGTH)
    return { code: "tooLong", values: { max: MAX_LENGTH } };
  if (ILLEGAL.test(title) || hasControlChar(title))
    return { code: "illegalChars" };
  if (forbiddenPrefixes.some((prefix) => title.startsWith(prefix)))
    return { code: "noPrefix" };
  if (title.endsWith(".")) return { code: "trailingDot" };
  if (isWindowsDeviceName(title)) return { code: "reserved" };
  return null;
}

/**
 * What, if anything, stops a string from being a node's title.
 *
 * Titles are free: two chapters may share one, and a title may hold any
 * punctuation ("Chapter 1: The Storm", "Why?"). The file name carries the
 * node's id, and its slug strips everything a platform could object to, so
 * no platform rule applies to the title.
 *
 * A title needs something in it, a length a tree row can show, and no
 * control characters: they are invisible while typing, and a newline would
 * break the one-line yaml value and the row.
 */
export function titleProblem(raw: string): NameProblem | null {
  const title = raw.trim();
  if (title.length === 0) return { code: "empty" };
  if (title.length > MAX_LENGTH)
    return { code: "tooLong", values: { max: MAX_LENGTH } };
  if (hasControlChar(title)) return { code: "controlChars" };
  return null;
}

// ── Reference file names ─────────────────────────────────────────────────────
//
// The `[+]` on each reference group names a file in `reference/`. The
// platform's rules apply as they would to any file, the prefix belongs to the
// group, and the duplicate check runs against every file name in the folder,
// ignoring case, because the groups share one directory.

/** The prefixes a writer must not type: the app adds the group's own. */
const REFERENCE_PREFIXES = [
  SUMMARY_PREFIX,
  GUIDEBOOK_PREFIX,
  CHARACTER_PREFIX,
  ARC_PREFIX,
  WORLD_PREFIX,
  NOTES_PREFIX,
];

/** `guidebook--the-ferry.md` from the group's prefix and a title. */
export function referenceFileName(prefix: string, title: string): string {
  return `${prefix}${title.trim()}${MD_EXT}`;
}

/**
 * Validate a title for a reference file of `prefix` group. `taken` holds the
 * lower-cased file names already in `reference/`, so a name that exists under
 * any group, or under none, is refused: the files share one folder.
 *
 * The title is the file name, so its file must also fit
 * `MAX_FILE_NAME_BYTES`, which a title under the character limit can pass in
 * a script of two or more bytes per letter.
 */
export function validateReferenceName(
  raw: string,
  prefix: string,
  taken: Set<string>,
): NameProblem | null {
  const title = raw.trim();

  const platform = platformChecks(title, REFERENCE_PREFIXES);
  if (platform) return platform;
  if (byteLength(referenceFileName(prefix, title)) > MAX_FILE_NAME_BYTES)
    return { code: "tooLongForFile" };
  if (taken.has(referenceFileName(prefix, title).toLowerCase())) {
    return { code: "duplicate", values: { kind: prefix.slice(0, -2), title } };
  }
  return null;
}
