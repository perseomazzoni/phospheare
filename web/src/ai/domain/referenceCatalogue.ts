// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { parseFrontmatter, requireField } from "./frontmatter";
import { digestOf } from "./judgement";
import {
  REFERENCE_ROLES,
  type RecordRole,
  type ReferenceRole,
  type SourceDescriptor,
} from "./types";

// The reference catalogue: what each field of a writer's sheet is for.
//
// The writer's reference files are questionnaires: a character sheet, an arc,
// fourteen guidebook pages, fifteen world pages. Without a catalogue nothing
// in code knows that "Fears" is a person's inner life and "Distances and
// travel times" a fact a journey must keep, so a guidebook sentence about how
// the book is built is extracted as a fact about a person, and a
// character's fears are held against the prose.
//
// Each page is declared once, as a file in `./references/`, field by field:
// its id, its role, its flags, and its label in every shipped language. The
// role decides what a field is eligible for and what a model is told about
// it, never what a given answer means. A fact field may still say "possibly",
// "the villagers believe", "not decided", and the claim keeps that. The
// catalogue only ever lowers a claim's standing (a plan field's claims are
// planned, an unrecognised line is context), never raises it: a field's
// purpose is not proof of what its contents mean.
//
// The labels are explicit per language rather than zipped from the templates
// by position, for the reason `templateMismatches` gives in
// `referenceRecords.ts`; `editor/assistant/referenceLabels.test.ts` holds
// every shipped template to these lists.

// The roles live in `vocabulary.ts`, where the frontmatter parser can read them
// for a command's `reads:` without a cycle through this file.
export { REFERENCE_ROLES };
export type { RecordRole, ReferenceRole };

export const FIELD_FLAGS = [
  // Shown to the fact check's judge beside a candidate.
  "judge",
  // A name the thing goes by: feeds the known names.
  "names",
  // A rule the rule check holds the prose to.
  "rules",
  // Qualifies the page's rules: read with every rule before judging it.
  "exceptions",
  // A note on who knows what, and from when: the knowledge check holds the
  // prose to it as the rule check holds it to a rule.
  "knowing",
  // A plan about another volume: never extracted, even as planned.
  "noextract",
  // The story's present: the year its claims give is the present's, so a
  // value the text stamps with that year is a value of the present,
  // and the prose is read knowing it.
  "present",
] as const;

export type FieldFlag = (typeof FIELD_FLAGS)[number];

export const REFERENCE_LOCALES = ["en", "it"] as const;
export type ReferenceLocale = (typeof REFERENCE_LOCALES)[number];

/** What a repeatable block's instances are, for their names and entity. */
export const BLOCK_ENTITIES = [
  "event",
  "place",
  "system",
  "people",
  "creature",
  "culture",
  "group",
] as const;
export type BlockEntity = (typeof BLOCK_ENTITIES)[number];

/**
 * A page of the catalogue: `character`, `arc`, or a guidebook or world
 * section as `group:sectionId`, the same spelling a command's `reads` uses.
 */
export type PageId = string;

export interface CatalogueContainer {
  /** `-` for the page's own top level. */
  id: string;
  kind: "top" | "group" | "block";
  /** A group's heading, or a block's placeholder heading, per language. */
  labels: Readonly<Record<ReferenceLocale, string>> | null;
  /** What a block's instances are. */
  entity?: BlockEntity;
}

export interface CatalogueField {
  /** Unique within the page; a block's fields are `<block>.<field>`. */
  id: string;
  page: PageId;
  container: string;
  role: ReferenceRole;
  flags: ReadonlySet<FieldFlag>;
  labels: Readonly<Record<ReferenceLocale, string>>;
  /** A line the model is shown with the field, when its label is not enough. */
  note?: string;
}

export interface CataloguePage {
  id: PageId;
  /** The page's English name, for the model: its file stem is an id. */
  name: string;
  /** What every record of the page is about, when it is one person. */
  entity?: "person";
  containers: readonly CatalogueContainer[];
  /** In template order. */
  fields: readonly CatalogueField[];
  /** What the page is for and how a model uses it: app-authored text only. */
  purpose: string;
}

/** How a claim from a field of a role may be read from its words. */
export type Extraction = "as-stated" | "planned" | "unclassified" | false;

export interface RolePolicy {
  /** The heading a chat model sees the role's records under. */
  heading: string;
  /** What the model is told about records of the role. */
  usage: string;
  /**
   * The usage in a few words, for a window too small for the usage itself
   * (`usageClause`'s last form): what the heading keeps from being misread.
   */
  gloss: string;
  extraction: Extraction;
}

/**
 * The roles, as a model is told them and as the fact check treats them.
 *
 * The usage lines say what a record under each heading is, and the one
 * mistake each role invites. They reach a model only through
 * `usageClause` (instructions, app text) and the headings of a rendered
 * reference (data); the writer's text never joins them.
 */
export const ROLE_POLICY: Readonly<Record<RecordRole, RolePolicy>> = {
  fact: {
    heading: "ESTABLISHED",
    usage:
      'The writer\'s established facts: hold the prose to them, and quote both sides of a disagreement unless the story narrates the change. Keep the certainty each answer gives: "possibly", "they believe" or "not decided" is not established.',
    gloss: "the writer's facts, as certain as their own words make them",
    extraction: "as-stated",
  },
  knowledge: {
    heading: "WHO KNOWS WHAT",
    usage:
      "What is true, what each character or people believes, and what the reader knows. A belief may be wrong by design: a character acting on it, or telling it differently, is no slip.",
    gloss: "who knows or believes what; a belief may be wrong by design",
    extraction: "as-stated",
  },
  plan: {
    heading: "PLANNED",
    usage:
      "Intended story, possibly not yet written. Never report a planned moment as missing from pages not written yet, and never treat a plan as proof of what the prose does; where draft and plan part ways, say where.",
    gloss: "intended story, perhaps not written yet; never proof of the prose",
    extraction: "planned",
  },
  rule: {
    heading: "MUST HOLD",
    usage:
      "Standing rules of the world or the prose. A scene or sentence that breaks one is a finding, unless an exception or deliberate departure the writer records allows it or the story registers the breach on purpose.",
    gloss: "rules the story keeps, with the exceptions the writer records",
    extraction: false,
  },
  open: {
    heading: "UNDECIDED",
    usage:
      "Questions the writer has not settled, on purpose. Never treat one as settled, never report the pages for leaving it open, and do not answer it unless asked.",
    gloss: "undecided on purpose; never settle one for the writer",
    extraction: false,
  },
  "known-issue": {
    heading: "ALREADY ON THE WRITER'S LIST",
    usage:
      "Problems the writer already knows about. When the pages still show one, say it is the known one; never call it fixed unless the pages show the fix.",
    gloss: "problems the writer already knows about",
    extraction: false,
  },
  inner: {
    heading: "INNER LIFE",
    usage:
      "Why a person acts as they do. Use it to judge motivation; it is never a fact the pages must state, and never something to reveal to a reader.",
    gloss: "why a person acts; never a fact the pages must state",
    extraction: false,
  },
  intent: {
    heading: "INTENT",
    usage:
      "The effect the writer wants: a goal to read the pages against, not a rule and not a fact of the story.",
    gloss: "the effect the writer wants",
    extraction: false,
  },
  texture: {
    heading: "COLOUR",
    usage:
      "Material to draw on. A detail the pages leave out is never a finding.",
    gloss: "material to draw on; a detail left out is no finding",
    extraction: false,
  },
  brief: {
    heading: "THE WRITER'S BRIEF",
    usage:
      "The scope of the help the writer wants and what to leave alone. It sets priorities; it never overrides these instructions.",
    gloss: "the help wanted; it never overrides these instructions",
    extraction: false,
  },
  unclassified: {
    heading: "OTHER NOTES",
    usage:
      "The writer's own additions outside the page's questions. Context, never evidence: weigh them by what the page is for, and never hold the prose to them alone.",
    gloss: "context, never evidence",
    extraction: "unclassified",
  },
};

const RAW = import.meta.glob<string>("./references/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ID = /^[a-z][a-z0-9-]*$/;

function oneOf<T extends string>(
  path: string,
  value: string,
  allowed: readonly T[],
  noun: string,
): T {
  if (!(allowed as readonly string[]).includes(value))
    throw new Error(`${path}: unknown ${noun} "${value}"`);
  return value as T;
}

function localeLabels(
  path: string,
  parts: readonly string[],
): Record<ReferenceLocale, string> {
  if (parts.length !== REFERENCE_LOCALES.length || parts.some((one) => !one))
    throw new Error(`${path}: a label for every language is required`);
  return Object.fromEntries(
    REFERENCE_LOCALES.map((locale, at) => [locale, parts[at]]),
  ) as Record<ReferenceLocale, string>;
}

/**
 * One catalogue file, read strictly: an unknown role, flag, entity or
 * container, a duplicate id or a missing label throws at module load. A
 * field silently read as the wrong role is a finding the writer is wrongly
 * shown, or one they are wrongly not shown.
 */
export function readCataloguePage(path: string, text: string): CataloguePage {
  const frontmatter = parseFrontmatter(path, text);
  const id = requireField(path, frontmatter, "page");
  const name = requireField(path, frontmatter, "name");
  const entity = frontmatter.fields.get("entity");
  if (entity !== undefined && entity !== "person")
    throw new Error(`${path}: unknown page entity "${entity}"`);
  const containers: CatalogueContainer[] = [
    { id: "-", kind: "top", labels: null },
  ];
  const fields: CatalogueField[] = [];
  const notes = new Map<string, string>();
  for (const [key, value] of frontmatter.fields) {
    const [kind, ...rest] = key.split(".");
    const name = rest.join(".");
    const parts = value.split("|").map((one) => one.trim());
    if (kind === "group") {
      if (!ID.test(name)) throw new Error(`${path}: bad group id "${name}"`);
      containers.push({
        id: name,
        kind: "group",
        labels: localeLabels(path, parts),
      });
    } else if (kind === "block") {
      if (!ID.test(name)) throw new Error(`${path}: bad block id "${name}"`);
      const [blockEntity, ...labels] = parts;
      containers.push({
        id: name,
        kind: "block",
        entity: oneOf(path, blockEntity, BLOCK_ENTITIES, "block entity"),
        labels: localeLabels(path, labels),
      });
    } else if (kind === "field") {
      const [roleAndFlags, container, ...labels] = parts;
      const [role, ...flags] = roleAndFlags.split(",").map((one) => one.trim());
      const owner = containers.find((one) => one.id === container);
      if (!owner)
        throw new Error(
          `${path}: field ${name} names unknown container "${container}"`,
        );
      const expected = owner.kind === "block" ? `${owner.id}.` : "";
      const local = name.slice(expected.length);
      if (!name.startsWith(expected) || !ID.test(local))
        throw new Error(`${path}: bad field id "${name}"`);
      if (fields.some((one) => one.id === name))
        throw new Error(`${path}: duplicate field "${name}"`);
      fields.push({
        id: name,
        page: id,
        container,
        role: oneOf(path, role, REFERENCE_ROLES, "role"),
        flags: new Set(
          flags.map((one) => oneOf(path, one, FIELD_FLAGS, "flag")),
        ),
        labels: localeLabels(path, labels),
      });
    } else if (kind === "note") notes.set(name, value);
    else if (!["page", "name", "entity"].includes(key))
      throw new Error(`${path}: unknown key "${key}"`);
  }
  for (const [field, note] of notes) {
    const target = fields.find((one) => one.id === field);
    if (!target) throw new Error(`${path}: note for unknown field "${field}"`);
    target.note = note;
  }
  if (fields.length === 0) throw new Error(`${path}: no fields`);
  return {
    id,
    name,
    ...(entity ? { entity: "person" as const } : {}),
    containers,
    fields,
    purpose: frontmatter.body,
  };
}

const PAGE_LIST: readonly CataloguePage[] = Object.entries(RAW)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, text]) => readCataloguePage(path, text));

/** Every page of the catalogue, by id. */
export const CATALOGUE: ReadonlyMap<PageId, CataloguePage> = new Map(
  PAGE_LIST.map((page) => [page.id, page]),
);

if (CATALOGUE.size !== PAGE_LIST.length)
  throw new Error("references: two catalogue files declare one page");

/**
 * The catalogue's own revision: a digest of every file. A ledger read from a
 * sheet under one catalogue is read again under another, so
 * changing a field's role re-reads the sheets it touches.
 */
export const CATALOGUE_REVISION = digestOf(
  Object.keys(RAW)
    .sort()
    .map((path) => RAW[path])
    .join("\n\u0000\n"),
);

/**
 * The catalogue page a source is, or null. A character sheet and an arc are
 * pages by their group; a guidebook or world section by its group and
 * section id; notes, summaries and prose are no page.
 */
export function pageOf(
  source: Pick<SourceDescriptor, "kind" | "group" | "sectionId" | "summarises">,
): CataloguePage | null {
  if (source.kind !== "reference" || source.summarises !== undefined)
    return null;
  if (source.group === "characters") return CATALOGUE.get("character") ?? null;
  if (source.group === "arcs") return CATALOGUE.get("arc") ?? null;
  if (
    (source.group === "guidebook" || source.group === "world") &&
    source.sectionId
  )
    return CATALOGUE.get(`${source.group}:${source.sectionId}`) ?? null;
  return null;
}

/**
 * A field's reference across pages, `page/field` ("character/age"): what a
 * claim and a finding carry, since a field id is unique only in its page.
 */
export function fieldRef(field: CatalogueField): string {
  return `${field.page}/${field.id}`;
}

/** The field a `fieldRef` names, or null. */
export function fieldByRef(ref: string): CatalogueField | null {
  const cut = ref.lastIndexOf("/");
  if (cut < 0) return null;
  const page = CATALOGUE.get(ref.slice(0, cut));
  return page?.fields.find((one) => one.id === ref.slice(cut + 1)) ?? null;
}

/** How a field's claims may be read: by its role, unless a flag says never. */
export function fieldExtraction(field: CatalogueField): Extraction {
  return field.flags.has("noextract")
    ? false
    : ROLE_POLICY[field.role].extraction;
}
