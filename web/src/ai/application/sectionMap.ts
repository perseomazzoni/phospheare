// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SourceDescriptor } from "../domain/types";
import { searchableSummary } from "../domain/sourceView";
import type { ProjectSources } from "../ports";
import { oneLine } from "./context";
import { throwIfCancelled } from "./runStep";

// The Sections, seen through their summaries, for the workflows that route
// by summaries before they read any prose. Kept in one place so the row
// format and the rule for which ids an answer may name cannot drift.
//
// A summary is derived and can be stale: nothing here is evidence, only a map
// of where to look.

/** One Section in scope, with its summary when it has one. */
export interface SectionRow {
  node: SourceDescriptor;
  summary: SourceDescriptor | null;
}

/** A row a map can route to: one that has a summary. */
export type MappedRow = SectionRow & { summary: SourceDescriptor };

/** What a row says when its summary may predate the Section's prose. */
export const OUTDATED = "(summary may be out of date)";

/**
 * The Sections in scope, in book order, each with its summary if it has one.
 *
 * Sections only: a Part's own file is the few words that open it, and
 * its summary says so. Counting Parts would report more units than the book's
 * Sections, and coverage would read as missing work.
 */
export function sectionRows(
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
): SectionRow[] {
  const summaries = new Map<string, SourceDescriptor>();
  for (const source of catalog)
    if (searchableSummary(source, allowed))
      summaries.set(source.summarises, source);
  return catalog
    .flatMap((node) =>
      node.kind === "manuscript" &&
      node.nodeKind === "section" &&
      node.nodeId &&
      allowed.has(node.id)
        ? [{ node, summary: summaries.get(node.nodeId) ?? null }]
        : [],
    )
    .sort(
      (a, b) =>
        (a.node.order ?? Number.MAX_SAFE_INTEGER) -
        (b.node.order ?? Number.MAX_SAFE_INTEGER),
    );
}

/** One row as a step is shown it. */
export interface RenderedRow {
  id: string;
  text: string;
}

/**
 * The one line that opens a row: its id, the writer's title flattened so a
 * newline in a title cannot forge a row, then any `notes` the app writes
 * about it, each after its own bar, then `flag` (`OUTDATED`).
 */
export function rowHeader(
  node: SourceDescriptor,
  notes: readonly string[] = [],
  flag = "",
): string {
  return `ROW ${node.id} | ${oneLine(node.title)}${notes
    .map((note) => ` | ${note}`)
    .join("")}${flag}`;
}

/**
 * Each mapped row as the model reads it: a one-line header the app writes
 * (`rowHeader`), then the summary, at most `perRow` characters of it.
 */
export async function renderRows(
  sources: ProjectSources,
  rows: readonly MappedRow[],
  perRow: number,
  signal: AbortSignal,
): Promise<RenderedRow[]> {
  const rendered: RenderedRow[] = [];
  for (const row of rows) {
    throwIfCancelled(signal);
    const summary = await sources.read(row.summary.id);
    const flag = row.summary.freshness === "current" ? "" : ` ${OUTDATED}`;
    rendered.push({
      id: row.node.id,
      text: `${rowHeader(row.node, [], flag)}\n${clipped(
        summary.text.trim(),
        perRow,
      )}`,
    });
  }
  return rendered;
}

/** What `renderUnitRows` made of the units, and what it could not show. */
export interface UnitRows {
  rows: RenderedRow[];
  /** Sections with no summary to read them through. */
  unmapped: string[];
  /** Parts whose Sections, cut to the floor, still do not fit one step. */
  tooLarge: string[];
  /** Sections whose summary went into a row. */
  read: string[];
}

/**
 * `/map`'s rows: one per unit, either a Section with its summary or
 * a Part with a line per Section, each cut to its share of `room` and never
 * below `floor`. `notes` are the app's own words about a node: on a unit's
 * header (`"row"`: the beat it stands in, its words and share) and, in
 * brackets, on a Section's line inside a Part (`"line"`: its words).
 * A Part is never split across two steps: one that still does not fit is
 * too large, and a unit with no summarised Section has no row at all.
 */
export async function renderUnitRows(
  sources: ProjectSources,
  units: readonly { source: SourceDescriptor; sectionIds: readonly string[] }[],
  rows: readonly SectionRow[],
  options: {
    room: number;
    floor: number;
    perSection: number;
    notes: (node: SourceDescriptor, place: "row" | "line") => string[];
  },
  signal: AbortSignal,
): Promise<UnitRows> {
  const byId = new Map(rows.map((row) => [row.node.id, row]));
  const out: UnitRows = { rows: [], unmapped: [], tooLarge: [], read: [] };
  const header = (node: SourceDescriptor, flag: string) =>
    rowHeader(node, options.notes(node, "row"), flag);
  // A Section's line inside a Part: the same kind of note, bracketed after
  // its title, so the colon still opens its summary.
  const line = (node: SourceDescriptor) => {
    const notes = options.notes(node, "line");
    return notes.length > 0 ? ` (${notes.join("; ")})` : "";
  };
  for (const unit of units) {
    throwIfCancelled(signal);
    const mapped: MappedRow[] = [];
    for (const id of unit.sectionIds) {
      const row = byId.get(id);
      if (row?.summary) mapped.push(row as MappedRow);
      else if (row) out.unmapped.push(id);
    }
    if (mapped.length === 0) continue;
    const texts: string[] = [];
    for (const row of mapped)
      texts.push((await sources.read(row.summary.id)).text.trim());
    const stale = (row: MappedRow) =>
      row.summary.freshness === "current" ? "" : ` ${OUTDATED}`;
    let text: string;
    if (unit.source.nodeKind === "section" && mapped.length === 1) {
      text = `${header(unit.source, stale(mapped[0]))}\n${clipped(
        texts[0],
        options.perSection,
      )}`;
    } else {
      const share = Math.max(
        options.floor,
        Math.floor(options.room / mapped.length),
      );
      text = [
        header(unit.source, ""),
        ...mapped.map(
          (row, index) =>
            `- ${row.node.id} | ${oneLine(row.node.title)}${line(row.node)}${stale(row)}: ${oneLine(
              clipped(texts[index], share),
            )}`,
        ),
      ].join("\n");
      if (text.length > options.room) {
        out.tooLarge.push(unit.source.id);
        continue;
      }
    }
    out.rows.push({ id: unit.source.id, text });
    out.read.push(...mapped.map((row) => row.node.id));
  }
  return out;
}

/**
 * A summary cut to `max`, at a sentence end when there is one in its second
 * half, and marked, so the model sees a row was shortened rather than
 * reading a half sentence as the Section's last event.
 */
function clipped(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sentence = Math.max(
    ...[". ", "! ", "? ", "… "].map((end) => cut.lastIndexOf(end)),
  );
  const at =
    sentence >= cut.length / 2
      ? sentence + 1
      : cut.lastIndexOf(" ") || cut.length;
  return `${cut.slice(0, at > 0 ? at : cut.length).trimEnd()}…`;
}

/** Split the rows into steps that each fit `room`. */
export function chunkRows(
  rendered: readonly RenderedRow[],
  room: number,
): RenderedRow[][] {
  const chunks: RenderedRow[][] = [];
  let current: RenderedRow[] = [];
  let size = 0;
  for (const row of rendered) {
    if (current.length > 0 && size + row.text.length > room) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += row.text.length + 2;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * What a step's answer may name: the ids it was shown, and nothing else. A
 * summary is file-controlled text and could name any id at all. Each row
 * answers to its id and to its bare node id, because a model may name the row
 * `node:S1` as `S1`.
 */
export function shownIds(
  rows: readonly RenderedRow[],
): (named: unknown) => string | null {
  const shown = new Map<string, string>();
  for (const row of rows) {
    shown.set(row.id, row.id);
    shown.set(row.id.replace(/^node:/, ""), row.id);
  }
  return (named) =>
    typeof named === "string" ? (shown.get(named.trim()) ?? null) : null;
}
