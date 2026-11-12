// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The one frontmatter reader for the markdown folders that ship inside the
// bundle, `personas/` and `skills/`, which carry a few flat `key: value` lines
// above their prose.
//
// Hand-written rather than a YAML dependency: these are flat scalar lines
// written by this repository for itself, so a general parser would read a
// grammar nothing here may use. It must never fail silently, because an
// asset whose body went missing is a model answering in its default voice
// with no sign of it. So a caller that needs a field gets a throw at module
// load, which is build time for the bundle and the first import in a test.

import {
  CHAT_KINDS,
  READ_GROUPS,
  REFERENCE_ROLES,
  SCOPE_KINDS,
  WORD_KINDS,
  type ChatKind,
  type ReadGroup,
  type ReadRef,
  type RecordRole,
  type ScopeKind,
  type WordKind,
} from "./types";

export interface Frontmatter {
  /** The declared fields, by key. Empty when the file carries no block. */
  readonly fields: ReadonlyMap<string, string>;
  /** Everything after the block, trimmed. Never empty: an empty body throws. */
  readonly body: string;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Split an asset file into its fields and its prose.
 *
 * The block is optional: a skill with nothing to declare is its instruction
 * and nothing else, and an empty `---\n---` would carry no information. A
 * file that opens a block and does not close it is malformed rather than
 * bodiless, and the throw says so.
 *
 * The newline after the closing fence is optional, so a file that is only
 * frontmatter still matches and is reported as having no body, which is what
 * is wrong with it.
 */
export function parseFrontmatter(path: string, text: string): Frontmatter {
  const trimmed = text.trim();
  const match = BLOCK.exec(trimmed);
  if (!match) {
    if (trimmed.startsWith("---"))
      throw new Error(`${path}: frontmatter is not closed`);
    if (!trimmed) throw new Error(`${path}: empty`);
    return { fields: new Map(), body: trimmed };
  }
  const [, front, rest] = match;
  const fields = new Map<string, string>();
  for (const line of front.split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) throw new Error(`${path}: bad line "${line}"`);
    const key = line.slice(0, at).trim();
    // A key written twice throws, because keeping the second would silently
    // drop the first role of a catalogue field declared twice.
    if (fields.has(key)) throw new Error(`${path}: duplicate key "${key}"`);
    fields.set(key, line.slice(at + 1).trim());
  }
  const body = rest.trim();
  if (!body) throw new Error(`${path}: no body`);
  return { fields, body };
}

/** A field the file must carry, or a throw naming the file and the field. */
export function requireField(
  path: string,
  { fields }: Frontmatter,
  key: string,
): string {
  const value = fields.get(key);
  if (!value) throw new Error(`${path}: missing ${key}`);
  return value;
}

/**
 * A comma list whose every value must be one of `allowed`.
 *
 * A value this app does not have throws, naming the file. A lenient reader
 * would accept `alpha-readr`, and the voice would never appear anywhere,
 * which reads as a missing feature rather than as a typo. Every list a file
 * declares goes through this one reader, so each new key is as strict as the
 * first.
 */
function listField<T extends string>(
  path: string,
  frontmatter: Frontmatter,
  key: string,
  allowed: readonly T[],
  noun: string,
): T[] {
  const values = listValues(path, frontmatter, key);
  for (const value of values)
    if (!(allowed as readonly string[]).includes(value))
      throw new Error(`${path}: unknown ${noun} "${value}" in ${key}`);
  return values as T[];
}

function listValues(
  path: string,
  frontmatter: Frontmatter,
  key: string,
): string[] {
  return requireField(path, frontmatter, key)
    .split(",")
    .map((one) => one.trim());
}

/** Only the groups compiled from a catalogue have sections to name. */
const SECTIONED: readonly ReadGroup[] = ["guidebook", "world"];

/** Roles a `reads:` entry may narrow to: the catalogue's, `unclassified`. */
const READ_ROLES: readonly RecordRole[] = [...REFERENCE_ROLES, "unclassified"];

/**
 * What a command reads besides the prose: `group` or
 * `group:section`, as strict as every other list. Either may be narrowed to
 * some roles of its records by a parenthesis, space-separated because the
 * list is comma-separated: `characters(rule brief)`. The section's
 * shape is checked here; `readsCatalogue.test.ts`, on the editor side, the
 * one layer that may import both, checks it against the real catalogue.
 */
export function readsField(
  path: string,
  frontmatter: Frontmatter,
  key: string,
): ReadRef[] {
  return listValues(path, frontmatter, key).map((value) => {
    const shape = /^([^()]*)(?:\(([^()]*)\))?$/u.exec(value);
    if (!shape)
      throw new Error(
        `${path}: "${value}" is not group[:section][(roles)] in ${key}`,
      );
    const [, place = "", narrowed] = shape;
    const roles = narrowed?.split(/\s+/u).filter(Boolean);
    if (
      roles?.length === 0 ||
      roles?.some((role) => !(READ_ROLES as readonly string[]).includes(role))
    )
      throw new Error(`${path}: "${value}" names no known roles in ${key}`);
    const only = roles ? { roles: roles as RecordRole[] } : {};
    const [group = "", sectionId, extra] = place.split(":");
    if (!(READ_GROUPS as readonly string[]).includes(group))
      throw new Error(`${path}: unknown reference group "${group}" in ${key}`);
    const known = group as ReadGroup;
    if (sectionId === undefined) return { group: known, ...only };
    if (
      extra !== undefined ||
      !SECTIONED.includes(known) ||
      !/^[a-z]+(-[a-z]+)*$/.test(sectionId)
    )
      throw new Error(`${path}: "${value}" names no section in ${key}`);
    return { group: known, sectionId, ...only };
  });
}

/** Which chats a persona or a skill belongs to. */
export function chatKindsField(
  path: string,
  frontmatter: Frontmatter,
  key: string,
): ChatKind[] {
  return listField(path, frontmatter, key, CHAT_KINDS, "chat kind");
}

/** Which word counts a skill's run prints. */
export function wordKindsField(
  path: string,
  frontmatter: Frontmatter,
  key: string,
): WordKind[] {
  return listField(path, frontmatter, key, WORD_KINDS, "word count");
}

/** Which scope words a skill offers. */
export function scopeKindsField(
  path: string,
  frontmatter: Frontmatter,
  key: string,
): ScopeKind[] {
  return listField(path, frontmatter, key, SCOPE_KINDS, "scope");
}
