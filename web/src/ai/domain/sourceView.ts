// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { RecordRole } from "./referenceCatalogue";
import type {
  ChatRecord,
  CoverageReport,
  ModelRef,
  ReadRef,
  SourceDescriptor,
} from "./types";
import { sameModel } from "./types";
import { ROOMS } from "./rooms";

// ── What a chat may be shown ─────────────────────────────────────────────────
//
// Two surfaces answer "which sources does this chat have": the Context dialog
// (every source it may pin) and the pinned chips above the composer (what it
// has pinned). The rule lives once, here, because two copies of a reader
// horizon could let a chip show a pin the dialog has hidden: a source the
// run will not send, drawn as attached.
//
// This is the presentation of the horizon, not its enforcement. The run asks
// the port (`allowedReaderSources`) at its own boundary and never reads this;
// what this decides is only what the writer is shown.

function isReader(chat: ChatRecord): boolean {
  return chat.kind === "alpha-reader" || chat.kind === "beta-reader";
}

/**
 * The sources this chat may be shown: everything for a general chat; for a
 * reader, the manuscript up to its horizon and its room's few extras (the
 * intent an alpha reader knows, the back cover a beta reader saw, as
 * `rooms.ts` declares), and nothing else.
 *
 * `whole` and "not chosen yet" both leave the horizon open: the first allows
 * everything, and the second is a chat that is refused before it can read
 * anything at all. A horizon at a node the sources do not hold shows no
 * manuscript, as the port allows none: a deletion never opens the whole book.
 */
export function visibleSources(
  chat: ChatRecord,
  sources: readonly SourceDescriptor[],
): SourceDescriptor[] {
  if (!isReader(chat)) return [...sources];
  const scope = chat.preferences.readerScope;
  const horizon =
    scope?.kind === "through"
      ? (sources.find((one) => one.nodeId === scope.nodeId)?.order ??
        Number.NEGATIVE_INFINITY)
      : undefined;
  const extras = new Set(
    readerExtras(chat.kind, sources).map((source) => source.id),
  );
  return sources.filter(
    (source) =>
      extras.has(source.id) ||
      (source.kind === "manuscript" &&
        (horizon === undefined ||
          (source.order ?? Number.MAX_SAFE_INTEGER) <= horizon)),
  );
}

/**
 * The reference documents a reader room may see beside its horizon, from the
 * catalogue. This is the enforcement's answer as well as the panel's: the
 * run adds these to what the port allows (`readerBoundary`), so the two
 * cannot disagree. Empty for every other room.
 */
export function readerExtras(
  kind: ChatRecord["kind"],
  catalog: readonly SourceDescriptor[],
): SourceDescriptor[] {
  const refs = ROOMS[kind].readerExtras;
  if (refs.length === 0) return [];
  return declaredSources(
    catalog,
    new Set(catalog.map((source) => source.id)),
    refs,
  );
}

/**
 * The pins that are live: pinned, still in the catalogue, and inside what the
 * chat may be shown, in the order the writer pinned them, which is the order
 * the chips read in. A pin whose source was deleted, barred or put past a
 * narrowed horizon is not attached to anything, so it is not drawn as if it
 * were; it stays in the preferences, and returns if its source does.
 */
export function pinnedSources(
  chat: ChatRecord,
  sources: readonly SourceDescriptor[],
): SourceDescriptor[] {
  const visible = new Map(
    visibleSources(chat, sources).map((source) => [source.id, source]),
  );
  return chat.preferences.pinnedSourceIds.flatMap((id) => {
    const source = visible.get(id);
    return source ? [source] : [];
  });
}

// ── Which Sections a search can see ──────────────────────────────────────────
//
// `/where` ranks Sections by their summaries, so "this Section has a
// summary" is one question with three askers: the search that ranks, the
// "Summarise n sections" button under its answer (which counts what is still
// missing), and the run behind that button (which must not rewrite a summary a
// search can already use). The rule lives once, here, so the button never
// offers work the run would skip and the run never skips what the search
// cannot see.

/**
 * Whether a search can rank by this summary: one the scope allows, bound to
 * its node, and present. An `outdated` or `unverified` one counts: it
 * ranks, and the row says it may be out of date, so it is never rewritten
 * only to be searched.
 */
export function searchableSummary(
  source: SourceDescriptor,
  allowed?: ReadonlySet<string>,
): source is SourceDescriptor & { summarises: string } {
  return (
    source.kind === "summary" &&
    typeof source.summarises === "string" &&
    source.summarises.length > 0 &&
    (!allowed || allowed.has(source.id)) &&
    source.freshness !== "missing"
  );
}

/** The node ids a search can see through a summary (`searchableSummary`). */
export function summarisedNodes(
  catalog: readonly SourceDescriptor[],
  allowed?: ReadonlySet<string>,
): Set<string> {
  return new Set(
    catalog.flatMap((source) =>
      searchableSummary(source, allowed) ? [source.summarises] : [],
    ),
  );
}

/**
 * The manuscript sources among `requested` that a summary run would write, in
 * catalogue order: live, inside the scope, a node, and not yet searchable.
 *
 * `requested` is an answer's `unmapped` rows, a `/where`'s or a wide
 * review's narrowed to its scope. It is a record of that run, read
 * back from a chat file, so an id can name a Section deleted since, or
 * nothing at all.
 */
export function unsummarised(
  catalog: readonly SourceDescriptor[],
  requested: Iterable<string>,
  allowed?: ReadonlySet<string>,
): SourceDescriptor[] {
  const wanted = new Set(requested);
  const seen = summarisedNodes(catalog, allowed);
  return catalog.filter(
    (source) =>
      wanted.has(source.id) &&
      (!allowed || allowed.has(source.id)) &&
      source.kind === "manuscript" &&
      typeof source.nodeId === "string" &&
      source.nodeId.length > 0 &&
      !seen.has(source.nodeId),
  );
}

/**
 * The Sections among `sectionIds` whose summary a `/summarise part` writes
 * before it composes: those with none, and those whose summary is
 * out of date. A Part's account with a missing middle, or one told from a
 * Section's earlier text, is a false story, and the writer's verb is the
 * consent. One list serves the run that writes it and the transit notice, which
 * states its count only as an upper bound because the panel's listing is not
 * re-read on a keystroke. A summary that cannot be checked
 * (`unverified`) is used as it is, as a search uses it; a Section whose
 * summary is barred is never written. Node ids, in the order
 * given.
 */
export function summariesToWrite(
  catalog: readonly SourceDescriptor[],
  sectionIds: readonly string[],
  allowed?: ReadonlySet<string>,
): string[] {
  const usable = new Set(
    catalog.flatMap((source) =>
      searchableSummary(source, allowed) && source.freshness !== "outdated"
        ? [source.summarises]
        : [],
    ),
  );
  const byId = new Map(catalog.map((source) => [source.id, source]));
  return sectionIds.flatMap((id) => {
    const section = byId.get(id);
    // A barred summary is the writer's: never written over.
    if (!section?.nodeId || section.summaryBarred) return [];
    return usable.has(section.nodeId) ? [] : [section.nodeId];
  });
}

/**
 * The rows of an answer's coverage a summary click may take: its `unmapped`
 * ones, and its `unsummarisable` ones once the chat's model is not the one
 * that failed on them (`summaryBlockLifted`). On a remote model the button's
 * label is the writer's consent to send the Sections it counts.
 */
export function offerableRows(
  skipped: readonly { sourceId: string; reason: unknown }[],
  lifted: boolean,
): string[] {
  return skipped
    .filter(
      (row) =>
        row.reason === "unmapped" ||
        (lifted && row.reason === "unsummarisable"),
    )
    .map((row) => row.sourceId);
}

/**
 * The coverage a run re-asked after "Summarise n Sections" publishes: each
 * `unmapped` row whose Section this run's summaries failed on for good
 * (`blocked`, node ids) becomes `unsummarisable`. Only this run's
 * own failures count, with nothing copied from the answer it replaces, and
 * only rows that were `unmapped`, so no other reason is rewritten.
 */
export function markUnsummarisable(
  coverage: CoverageReport,
  blocked: ReadonlySet<string> | undefined,
): CoverageReport {
  if (!blocked || blocked.size === 0) return coverage;
  const ids = new Set([...blocked].map((id) => `node:${id}`));
  return {
    ...coverage,
    skipped: coverage.skipped.map((row) =>
      row.reason === "unmapped" && ids.has(row.sourceId)
        ? { ...row, reason: "unsummarisable" as const }
        : row,
    ),
  };
}

/**
 * Whether an answer's `unsummarisable` rows may be offered again: the chat
 * now asks a different model than the one that answered (and failed on
 * them). A missing model on either side keeps the block: no click can run
 * without one, and a planted file cannot lift it by leaving the field out.
 */
export function summaryBlockLifted(
  answered: ModelRef | undefined,
  current: ModelRef | null | undefined,
): boolean {
  return Boolean(answered && current && !sameModel(answered, current));
}

/**
 * The node ids a "Summarise n Sections" click writes: the
 * answer's `unmapped` rows, narrowed to `reach` when the run has one (a wide
 * review's Sections; a planted row naming a Part's heading file is in the
 * boundary, not in `reach`), then judged by `unsummarised` against the
 * boundary, which holds the summaries. Judged against the Sections alone,
 * every summary is invisible and each click rewrites them all.
 */
export function toSummarise(
  coverage: CoverageReport | undefined,
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
  reach?: ReadonlySet<string>,
  lifted = false,
): string[] {
  return unsummarised(
    catalog,
    offerableRows(coverage?.skipped ?? [], lifted).filter(
      (id) => !reach || reach.has(id),
    ),
    allowed,
  ).flatMap((source) => (source.nodeId ? [source.nodeId] : []));
}

// ── What a command reads besides the prose ───────────────────────────────────
//
// The references and notes a review's file declares, which are never
// summaries (`READ_GROUPS`) and never the manuscript; this is not a search's
// scope.

/** Whether one `reads` entry names `source`: its group, and its section. */
function reaches(read: ReadRef, source: SourceDescriptor): boolean {
  return (
    source.group === read.group &&
    (read.sectionId === undefined || source.sectionId === read.sectionId)
  );
}

/**
 * The references and notes `reads` names, in declared order, each once,
 * from the run's catalogue and `allowed` set only. Pure: a wide review's map
 * lists their titles without reading a word of them. It is the one
 * matcher of a `reads` entry against the catalogue, so no two readers can
 * disagree.
 */
export function declaredSources(
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
  reads: readonly ReadRef[],
): SourceDescriptor[] {
  const found = new Map<string, SourceDescriptor>();
  for (const read of reads)
    for (const source of catalog)
      if (
        (source.kind === "reference" || source.kind === "note") &&
        allowed.has(source.id) &&
        !found.has(source.id) &&
        reaches(read, source)
      )
        // A document two entries both reach (the Editing brief, then
        // "guidebook") is placed at the first, which is its priority.
        found.set(source.id, source);
  return [...found.values()];
}

/**
 * The roles `reads` attaches of `source`: the union of every entry
 * that reaches it. `null`, meaning every record, when any entry that reaches
 * it names no roles, or when none reaches it, since nothing narrows it. A
 * document is placed at its first entry (`declaredSources`), but what is
 * shown of it is everything any entry asked for:
 * "guidebook:prose-style(rule)" and a later bare "guidebook" show the whole
 * page.
 */
export function readRoles(
  source: SourceDescriptor,
  reads: readonly ReadRef[],
): ReadonlySet<RecordRole> | null {
  const roles = new Set<RecordRole>();
  let reached = false;
  for (const read of reads) {
    if (!reaches(read, source)) continue;
    if (!read.roles) return null;
    reached = true;
    for (const role of read.roles) roles.add(role);
  }
  return reached ? roles : null;
}

/**
 * The documents a named reference stands for, as the review may read them at
 * run time. Each id must still be one `reads` names in the run's
 * catalogue and `allowed` set, by the same matcher that decides what may be
 * named, so a sheet barred, deleted or moved outside what the chat may read
 * since the name was typed is refused, never swapped for every read. `null`
 * when any id is not, or when there are none.
 */
export function namedSources(
  catalog: readonly SourceDescriptor[],
  allowed: ReadonlySet<string>,
  reads: readonly ReadRef[],
  ids: readonly string[],
): SourceDescriptor[] | null {
  if (ids.length === 0) return null;
  const nameable = new Map(
    declaredSources(catalog, allowed, reads).map((one) => [one.id, one]),
  );
  const found: SourceDescriptor[] = [];
  for (const id of new Set(ids)) {
    const source = nameable.get(id);
    if (!source) return null;
    found.push(source);
  }
  return found;
}
