// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  type BlockEntity,
  type CatalogueContainer,
  type CatalogueField,
  type CataloguePage,
  type RecordRole,
  REFERENCE_LOCALES,
} from "./referenceCatalogue";
import {
  normalLabel,
  outlineOf,
  type OutlineHeading,
  type OutlineLine,
} from "./referenceOutline";

// A reference document as records.
//
// The outline says where the fields are; the catalogue says what each field
// is for; a record is the two joined: one field's answers, with its role, the
// fixed group or repeatable block it sits in, and the entity it is about (the
// person a character sheet is for, the place a `## Harbour` block describes).
// Everything the catalogue does not recognise (a label the writer renamed,
// prose under no field, the whole of a notes file) is kept, word for word, as
// an `unclassified` record: context a model may read and the fact check may
// show its judge, never evidence a candidate can stand on. Preserving the
// writer's text and making it eligible as established evidence are two
// separate decisions.
//
// A field is recognised by its label in any shipped language, so a sheet
// started from the Italian template in an English project is still a sheet.
// That holds because no label repeats inside one page in any language
// (`editor/assistant/referenceLabels.test.ts`). The heading a field sits under
// decides its block instance: a `##` that is a block's placeholder
// ("[Location]"), or any other `##` whose first recognised field belongs to a
// block, opens an instance of that block named by the heading, or, when the
// heading is still the placeholder, by the block's names field.

export interface RecordInstance {
  block: string;
  entity: BlockEntity;
  /** The heading the writer gave the instance; null for the placeholder. */
  heading: string | null;
}

export interface ReferenceRecord {
  /** The catalogue field, or null for what the catalogue does not recognise. */
  field: CatalogueField | null;
  role: RecordRole;
  /** The label as the writer wrote it; empty for loose lines. */
  label: string;
  /** The fixed group the record sits under, when its field has one. */
  group: string | null;
  instance: RecordInstance | null;
  /**
   * What the record is about, as the writer names it: the person a
   * character sheet or an arc is for, a block instance's name, or null.
   */
  entity: string | null;
  /** The answer lines, each with its offsets into the text as parsed. */
  lines: readonly OutlineLine[];
  /** The record's span: the label line to its last answer. */
  start: number;
  end: number;
}

/**
 * How much of a document the catalogue could read: every record placed,
 * some, or none (a notes file, a page with every label renamed, a file the
 * parser made nothing of). Reported wherever a document is used, so
 * "fully interpreted" is never assumed of a document that was not.
 */
export type Interpretation = "full" | "partial" | "raw";

export interface ParsedReference {
  page: CataloguePage | null;
  title: string | null;
  records: readonly ReferenceRecord[];
  interpretation: Interpretation;
  /**
   * The roles `records` was narrowed to (`withRoles`), when it was: a page
   * shown in part says so, or a sheet with its voice alone reads as a sheet
   * whose writer wrote nothing else.
   */
  roles?: ReadonlySet<RecordRole>;
}

type Labelled = { labels: Readonly<Record<string, string>> | null };

function matches(item: Labelled, text: string): boolean {
  const wanted = normalLabel(text);
  const labels = item.labels;
  return (
    labels !== null &&
    REFERENCE_LOCALES.some((locale) => normalLabel(labels[locale]) === wanted)
  );
}

function containerOf(
  page: CataloguePage,
  field: CatalogueField,
): CatalogueContainer | undefined {
  return page.containers.find((one) => one.id === field.container);
}

/**
 * A reference document's records. `title` is the source's own title: the
 * name a character sheet or an arc is filed under, which names the person
 * every record on it is about. Never throws: a document the parser cannot
 * read is one unclassified record holding every line.
 */
export function parseReference(
  text: string,
  page: CataloguePage | null,
  title: string | null = null,
): ParsedReference {
  let outline: ReturnType<typeof outlineOf>;
  try {
    outline = outlineOf(text);
  } catch {
    return rawDocument(text, page, title);
  }
  const person = page?.entity === "person" ? title : null;
  const fieldFor = (label: string) =>
    page?.fields.find((one) => matches(one, label)) ?? null;

  // Each heading's container: a fixed group by its heading, a block by its
  // placeholder, or, for a heading the writer named, the block of the first
  // recognised field under it.
  const placed = new Map<
    OutlineHeading,
    { group: string | null; instance: RecordInstance | null }
  >();
  for (const heading of outline.headings) {
    const group = page?.containers.find(
      (one) => one.kind === "group" && matches(one, heading.text),
    );
    if (group) {
      placed.set(heading, { group: group.id, instance: null });
      continue;
    }
    const placeholder = page?.containers.find(
      (one) => one.kind === "block" && matches(one, heading.text),
    );
    const block =
      placeholder ??
      outline.fields
        .filter((one) => one.heading === heading)
        .map((one) => fieldFor(one.label))
        .map((field) => (field && page ? containerOf(page, field) : undefined))
        .find((container) => container?.kind === "block");
    placed.set(heading, {
      group: null,
      instance:
        block?.entity !== undefined
          ? {
              block: block.id,
              entity: block.entity,
              heading: placeholder ? null : heading.text,
            }
          : null,
    });
  }

  const records: ReferenceRecord[] = [];
  for (const one of outline.fields) {
    if (one.answers.length === 0) continue;
    const field = fieldFor(one.label);
    const where = one.heading ? placed.get(one.heading) : undefined;
    const container = field && page ? containerOf(page, field) : undefined;
    records.push({
      field,
      role: field ? field.role : "unclassified",
      label: one.label,
      group: container?.kind === "group" ? container.id : null,
      instance:
        where?.instance && (!container || container.kind === "block")
          ? where.instance
          : null,
      entity: null,
      lines: one.answers,
      start: one.start,
      end: one.end,
    });
  }
  // Loose lines, one record per run under one heading, in place: a field
  // between two loose lines ends the run, or the run's span would hold the
  // field's answers and take them from it.
  let run: ReferenceRecord | null = null;
  let runHeading: OutlineHeading | null = null;
  for (const line of outline.loose) {
    const heading = line.heading;
    const where = heading ? placed.get(heading) : undefined;
    const from = run?.end ?? 0;
    if (
      run &&
      runHeading === heading &&
      line.start >= from &&
      !outline.fields.some(
        (field) => field.start >= from && field.start < line.start,
      )
    ) {
      run.lines = [...run.lines, line];
      run.end = line.end;
      continue;
    }
    run = {
      field: null,
      role: "unclassified",
      label: "",
      group: null,
      instance: where?.instance ?? null,
      entity: null,
      lines: [line],
      start: line.start,
      end: line.end,
    };
    runHeading = heading;
    records.push(run);
  }
  records.sort((a, b) => a.start - b.start);

  // Each record's entity: the page's person, or its block instance's name,
  // which is the heading, or the block's names field when the heading is the
  // placeholder.
  for (const record of records) {
    if (person !== null) record.entity = person;
    else if (record.instance) {
      record.entity =
        record.instance.heading ??
        records.find(
          (other) =>
            other.instance === record.instance &&
            other.field?.flags.has("names"),
        )?.lines[0]?.text ??
        null;
    }
  }

  const classified = records.filter((one) => one.field !== null).length;
  return {
    page,
    title: outline.title ?? title,
    records,
    interpretation:
      classified === 0
        ? "raw"
        : classified === records.length
          ? "full"
          : "partial",
  };
}

function rawDocument(
  text: string,
  page: CataloguePage | null,
  title: string | null,
): ParsedReference {
  const trimmed = text.trim();
  const start = text.indexOf(trimmed);
  return {
    page,
    title,
    interpretation: "raw",
    records: trimmed
      ? [
          {
            field: null,
            role: "unclassified",
            label: "",
            group: null,
            instance: null,
            entity: page?.entity === "person" ? title : null,
            lines: [
              { text: trimmed, start, end: start + trimmed.length, indent: 0 },
            ],
            start,
            end: start + trimmed.length,
          },
        ]
      : [],
  };
}

/**
 * The record whose answer holds `[start, end)`, if any: a quote's owner.
 * A quote may run across two answer lines of one field; it never
 * belongs to a record by its label, and one that straddles two records
 * belongs to neither.
 */
export function recordAt(
  parsed: ParsedReference,
  start: number,
  end: number,
): ReferenceRecord | null {
  return (
    parsed.records.find((one) => {
      const first = one.lines[0];
      const last = one.lines[one.lines.length - 1];
      return (
        first !== undefined &&
        last !== undefined &&
        first.start <= start &&
        end <= last.end &&
        start < end
      );
    }) ?? null
  );
}

/**
 * `parsed` with only the records whose role is in `roles`; null
 * keeps them all. How far the file was read stays as it was: it is a fact
 * about the file, not about how much of it is shown.
 *
 * What the parser could not place (`unclassified`, shown as other notes) is
 * always kept: its role is unknown, not known to be another, and a sheet
 * written in the writer's own words has nothing else. Narrowed away, a
 * free-form sheet would vanish from `/line-editing` with no line in the
 * coverage.
 */
export function withRoles(
  parsed: ParsedReference,
  roles: ReadonlySet<RecordRole> | null,
): ParsedReference {
  if (roles === null) return parsed;
  const shown = new Set<RecordRole>([...roles, "unclassified"]);
  return {
    ...parsed,
    records: parsed.records.filter((one) => shown.has(one.role)),
    roles: shown,
  };
}

/**
 * Where a shipped template departs from its catalogue page in one language:
 * the headings and field labels in document order, compared with the order
 * the catalogue declares: every group's heading or block's placeholder where
 * its first field begins, then its fields. Empty when they agree.
 *
 * Label by label, container by container, never by count: two fields swapped
 * in a template keep the count and would hand each other's roles to the
 * writer's answers, so a swap must show here.
 */
export function templateMismatches(
  template: string,
  page: CataloguePage,
  locale: (typeof REFERENCE_LOCALES)[number],
): string[] {
  const outline = outlineOf(template);
  const actual = [
    ...outline.headings.map((one) => ({
      at: one.start,
      item: `## ${normalLabel(one.text)}`,
    })),
    ...outline.fields.map((one) => ({
      at: one.start,
      item: normalLabel(one.label),
    })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((one) => one.item);
  const expected: string[] = [];
  const opened = new Set<string>(["-"]);
  for (const field of page.fields) {
    if (!opened.has(field.container)) {
      opened.add(field.container);
      const container = page.containers.find(
        (one) => one.id === field.container,
      );
      if (container?.labels)
        expected.push(`## ${normalLabel(container.labels[locale])}`);
    }
    expected.push(normalLabel(field.labels[locale]));
  }
  const out: string[] = [];
  for (let at = 0; at < Math.max(actual.length, expected.length); at += 1)
    if (actual[at] !== expected[at])
      out.push(
        `${page.id} (${locale}) #${at + 1}: template "${actual[at] ?? "-"}", catalogue "${expected[at] ?? "-"}"`,
      );
  return out;
}
