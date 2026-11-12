// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ClaimStatus } from "./ledger";
import {
  fieldExtraction,
  ROLE_POLICY,
  type Extraction,
} from "./referenceCatalogue";
import type { ParsedReference, ReferenceRecord } from "./referenceRecords";

// A reference document as the fact reader is shown it. The
// reader sees only the records a fact may be read from: a fact or knowledge
// field, a plan field (read as planned), and what the catalogue could not
// place (read, and kept as context only). Each sits under one line that says
// what the field is and whom it is about, so a guidebook's "Open questions"
// is never read for facts like a character's age.
//
// The answer lines are the writer's text unchanged, each a segment mapped
// back to where it stands in the text as read. A claim's quote is placed in
// the file by its segment, never by searching for its words, because the same
// words under two fields are two different places. A quote not inside
// one answer line, such as the bracketed line or a run across two lines, is
// not placed, and the claim is dropped rather than bound to a field it may
// not come from.
//
// The bracketed line is the app's; the answers are the writer's. The line
// never becomes evidence, because no segment covers it.

/** One answer line: `[at, end)` in the chunk, `readAt` in the file. */
export interface ViewSegment {
  at: number;
  end: number;
  readAt: number;
  record: ReferenceRecord;
}

/** A piece of a sheet the fact reader is shown in one request. */
export interface ExtractionChunk {
  text: string;
  segments: readonly ViewSegment[];
}

/** How a record's claims may be read: its field's, or unclassified. */
export function recordExtraction(record: ReferenceRecord): Extraction {
  return record.field
    ? fieldExtraction(record.field)
    : ROLE_POLICY.unclassified.extraction;
}

/** The records a fact may be read from, in the document's order. */
export function extractableRecords(parsed: ParsedReference): ReferenceRecord[] {
  return parsed.records.filter((one) => recordExtraction(one) !== false);
}

/**
 * The line a record is shown under: the writer's label, the role's heading,
 * whose page it is or what block it is about, and the catalogue's note on
 * the field when it has one ("a pointer is no fact").
 *
 * A person's page says "on Hollis's page", never "about Hollis": a
 * relationships answer on her page may state her father's tenure, and read
 * as about her, the tenure is filed as hers and a slip in his goes unseen.
 * A block's instance is what its records are about: a place's
 * access is the place's.
 */
export function recordHeader(record: ReferenceRecord): string {
  const label = record.label.replace(/\s*:\s*$/u, "") || "(no label)";
  const about = !record.entity
    ? ""
    : record.instance === null
      ? `, on ${record.entity}'s page`
      : `, about ${record.entity}`;
  const note = record.field?.note ? ` ${record.field.note}` : "";
  return `[${label} — ${ROLE_POLICY[record.role].heading}${about}]${note}`;
}

/**
 * The document's extractable records packed into chunks of at most `size`
 * characters, a record never split from its line, and a record longer than
 * a chunk split between its answer lines with its line repeated. Empty when
 * nothing on the page may be read for facts.
 */
export function extractionChunks(
  parsed: ParsedReference,
  size: number,
): ExtractionChunk[] {
  const chunks: ExtractionChunk[] = [];
  let text = "";
  let segments: ViewSegment[] = [];
  const flush = () => {
    if (text) chunks.push({ text, segments });
    text = "";
    segments = [];
  };
  for (const record of extractableRecords(parsed)) {
    const header = `${recordHeader(record)}\n`;
    const lines = record.lines.map((line) => `  ${line.text}\n`);
    const whole =
      header.length + lines.reduce((sum, one) => sum + one.length, 0);
    if (text && text.length + whole > size) flush();
    let opened = false;
    record.lines.forEach((line, at) => {
      if (opened && text.length + lines[at].length > size) {
        flush();
        opened = false;
      }
      if (!opened) {
        text += header;
        opened = true;
      }
      const start = text.length + 2;
      segments.push({
        at: start,
        end: start + line.text.length,
        readAt: line.start,
        record,
      });
      text += lines[at];
    });
  }
  flush();
  return chunks;
}

/**
 * Where `[start, end)` of a chunk stands in the file, and the record it
 * belongs to, or `null` when it is not wholly inside one answer line.
 */
export function placeInFile(
  chunk: ExtractionChunk,
  start: number,
  end: number,
): { at: number; record: ReferenceRecord } | null {
  const segment = chunk.segments.find(
    (one) => one.at <= start && end <= one.end && start < end,
  );
  return segment
    ? { at: segment.readAt + (start - segment.at), record: segment.record }
    : null;
}

/**
 * The status a claim keeps, given the record it was read from: a plan
 * field's claim is planned whatever the reader called it, unless it said
 * open, which is further still from established. Code only lowers a claim's
 * standing here: a fact field's "maybe" stays open, and no field's
 * purpose turns a belief into a statement.
 */
export function statusWithin(
  record: ReferenceRecord,
  status: ClaimStatus,
): ClaimStatus {
  if (recordExtraction(record) === "planned" && status !== "open")
    return "planned";
  return status;
}
