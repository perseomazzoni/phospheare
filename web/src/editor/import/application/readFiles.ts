// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { PACKAGE_FORMATS, type FormatId } from "../domain/formats";
import { MAX_FILE_BYTES, MAX_FILES } from "../domain/limits";
import { sniff, type Refusal } from "../domain/sniff";
import {
  mergeReports,
  type SourceDocument,
  type SourceMeta,
} from "../domain/source";
import type { InputFile, ReadContext, ReaderLoader, ZipProbe } from "../ports";

// From chosen files to one source. Each file is sniffed, measured against its
// cap, handed to its reader, and answered with a typed result, read or
// refused with a reason a sentence can be made of, so the window can show
// every file's fate on its own row and the writer can remove the one that did
// not work. A failure in one file never stops the others.
//
// Several files are a book in pieces, one per chapter: they are merged, in
// the writer's order (natural-sorted by name to begin with, by
// `naturalSort`), into one source whose flows are the files. An epub is a
// whole book, so an epub among other files is refused rather than guessed
// at.

export interface ReadDeps {
  load: ReaderLoader;
  probe: ZipProbe;
}

export type FileResult =
  | {
      status: "ok";
      name: string;
      size: number;
      format: FormatId;
      doc: SourceDocument;
    }
  | {
      status: "refused";
      name: string;
      size: number;
      format?: FormatId;
      reason: Refusal;
    };

/** A reader's own refusal reason; any other throw is "damaged". */
function reasonOf(err: unknown): Refusal {
  if (
    err &&
    typeof err === "object" &&
    "reason" in err &&
    typeof (err as { reason: unknown }).reason === "string"
  )
    return (err as { reason: Refusal }).reason;
  return "damaged";
}

const capFor = (format: FormatId): number =>
  PACKAGE_FORMATS.has(format)
    ? MAX_FILE_BYTES.package
    : format === "rtf"
      ? MAX_FILE_BYTES.rtf
      : MAX_FILE_BYTES.text;

export async function readFile(
  file: InputFile,
  deps: ReadDeps,
  ctx: ReadContext,
): Promise<FileResult> {
  const base = { name: file.name, size: file.size };
  // The largest cap of any family, before a byte is read: nothing bigger
  // could be accepted whatever it turns out to be.
  if (file.size > MAX_FILE_BYTES.package)
    return { status: "refused", ...base, reason: "tooLarge" };
  let bytes: Uint8Array;
  try {
    bytes = await file.bytes();
  } catch {
    return { status: "refused", ...base, reason: "damaged" };
  }
  let found = sniff(file.name, bytes.subarray(0, 4096));
  // The probe inflates a part to look inside, and a damaged zip can throw
  // there: a throw here would leave the row "Reading…" and stop every file
  // after it in the pick, so it is a refusal like any other.
  if (found.kind === "zip")
    try {
      found = await deps.probe(bytes);
    } catch {
      return { status: "refused", ...base, reason: "damaged" };
    }
  if (found.kind === "refused")
    return { status: "refused", ...base, reason: found.reason };
  // A probe that answers "zip" again has found no package it knows.
  if (found.kind === "zip")
    return { status: "refused", ...base, reason: "unknown" };
  const format = found.format;
  if (bytes.length > capFor(format))
    return { status: "refused", ...base, format, reason: "tooLarge" };
  try {
    const reader = await deps.load(format);
    const doc = await reader.read(bytes, file.name, ctx);
    const empty = doc.flows.every((flow) =>
      flow.blocks.every(
        (block) =>
          block.kind !== "para" ||
          block.inlines.every((inline) => !inline.text.trim()),
      ),
    );
    if (empty) return { status: "refused", ...base, format, reason: "empty" };
    return { status: "ok", ...base, format, doc };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { status: "refused", ...base, format, reason: reasonOf(err) };
  }
}

/**
 * The results a set of files may go forward with: past `MAX_FILES` is
 * refused, and an epub among other files is refused (the others stay).
 */
export function admit(results: readonly FileResult[]): FileResult[] {
  const several = results.length > 1;
  return results.map((result, index) => {
    if (result.status !== "ok") return result;
    if (index >= MAX_FILES)
      return {
        status: "refused",
        name: result.name,
        size: result.size,
        format: result.format,
        reason: "tooMany",
      };
    if (several && result.format === "epub")
      return {
        status: "refused",
        name: result.name,
        size: result.size,
        format: "epub",
        reason: "mixed",
      };
    return result;
  });
}

/** One source from the read files, in order; null when none was read. */
export function mergeSources(
  results: readonly FileResult[],
): SourceDocument | null {
  const docs = results.flatMap((r) => (r.status === "ok" ? [r.doc] : []));
  if (!docs.length) return null;
  if (docs.length === 1) return docs[0];
  const merged: SourceDocument = {
    formats: [...new Set(docs.flatMap((d) => d.formats))],
    meta: {},
    flows: [],
    comments: [],
    report: {},
  };
  for (const doc of docs) {
    const offset = merged.flows.length;
    merged.flows.push(...doc.flows);
    for (const comment of doc.comments)
      merged.comments.push(
        comment.anchor
          ? {
              ...comment,
              anchor: { ...comment.anchor, flow: comment.anchor.flow + offset },
            }
          : comment,
      );
    mergeReports(merged.report, doc.report);
    for (const key of ["title", "author", "language"] as (keyof SourceMeta)[])
      if (!merged.meta[key] && doc.meta[key]) merged.meta[key] = doc.meta[key];
  }
  // Each file's own title is a chapter's, not the book's.
  if (docs.length > 1) delete merged.meta.title;
  return merged;
}
