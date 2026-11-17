// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The panel's reads of the sources and the writer's actions on evidence: what
// a chat still needs, the live revision of a Section, a cited passage or
// source opened at the writer's click, a finding's status and a summary's
// freshness. None of them takes a run slot; the aggregate lends what each
// reads of it through `SourceHost`.

import { wantsOf } from "./chatFacts";
import { now } from "./runRecords";
import { missingWants } from "./context";
import { anchorState } from "./validateEvidence";
import type { WorkflowHost } from "./workflowRun";
import { readerExtras } from "../domain/sourceView";
import { summaryFreshness } from "../domain/summaryFreshness";
import type {
  EvidenceAnchor,
  ReadRef,
  SourceDescriptor,
  SummaryState,
} from "../domain/types";
import { withHost } from "./features";
import { appLog, describeError } from "../../log";

export type SourceHost = Pick<
  WorkflowHost,
  "dependencies" | "writes" | "activeChat" | "listCatalogue"
>;

/**
 * The documents the active chat's room and focus rely on that the writer
 * has not written yet, for the panel's quiet line that offers to open each
 * one. A reader is asked only about what it may see at all: its room's
 * extras.
 */
export async function missingReferences(host: SourceHost): Promise<ReadRef[]> {
  const chat = host.activeChat();
  if (!chat) return [];
  const catalog = await host.listCatalogue();
  const reader = chat.kind === "alpha-reader" || chat.kind === "beta-reader";
  const allowed = new Set(
    (reader ? readerExtras(chat.kind, catalog) : catalog).map(
      (source) => source.id,
    ),
  );
  return missingWants(
    host.dependencies.sources,
    catalog,
    allowed,
    wantsOf(chat),
    new Set(),
  );
}

/**
 * The live content revision of each Section, read the way a run reads it
 * (the live buffer, or the file), for a Section map to tell whether its
 * Section has changed. Null for one whose read failed, which the
 * map counts as changed. Only ever compared, never sent.
 */
export async function sectionRevisions(
  host: SourceHost,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  const revisions = new Map<string, string | null>();
  for (const id of ids) {
    try {
      revisions.set(id, (await host.dependencies.sources.read(id)).revision);
    } catch {
      revisions.set(id, null);
    }
  }
  return revisions;
}

/**
 * Writer-initiated evidence navigation: revalidate the anchor against the
 * current source first, then hand it to the host surface. A changed source
 * or an ambiguous quotation is refused, never guessed.
 */
export async function revealEvidence(
  host: SourceHost,
  anchor: EvidenceAnchor,
): Promise<"selected" | "changed" | "unavailable" | "held"> {
  if (!host.dependencies.evidence) return "unavailable";
  let capture;
  try {
    capture = await host.dependencies.sources.read(anchor.sourceId);
  } catch (err) {
    // The id's scheme alone: past it, a reference id carries a file name.
    appLog.warn("ai", "A cited source could not be read to show it.", {
      kind: /^[a-z-]+(?=:)/.exec(anchor.sourceId)?.[0] ?? "unknown",
      ...describeError(err),
    });
    return "unavailable";
  }
  if (anchor.revision && anchor.revision !== capture.revision) return "changed";
  if (anchorState(anchor, capture.text) !== "verified") return "unavailable";
  // A click is the writer asking, so nothing is watched and nothing can be
  // withheld; the narrowing only says so to the type.
  const shown = await host.dependencies.evidence.reveal({
    ...anchor,
    revision: capture.revision,
  });
  return shown === "withheld" ? "unavailable" : shown;
}

/**
 * Writer-initiated: open a source the assistant cited or read, with no
 * passage to land on.
 *
 * Separate from `revealEvidence` rather than a quote-less call to it: the
 * type guarantees no anchor reaches the prose unvalidated, and an optional
 * quote would turn that into a rule to remember. The id is checked against
 * the live catalogue at click time, so a forged or stale citation opens
 * nothing.
 */
export async function openSource(
  host: SourceHost,
  sourceId: string,
): Promise<"selected" | "unavailable"> {
  if (!host.dependencies.evidence) return "unavailable";
  let sources: SourceDescriptor[];
  try {
    sources = await host.listCatalogue();
  } catch (err) {
    appLog.warn(
      "ai",
      "The source catalogue could not be listed to open a source.",
      {
        kind: /^[a-z-]+(?=:)/.exec(sourceId)?.[0] ?? "unknown",
        ...describeError(err),
      },
    );
    return "unavailable";
  }
  if (!sources.some((source) => source.id === sourceId)) return "unavailable";
  return host.dependencies.evidence.open(sourceId);
}

/** Writer action on a finding: dismiss or resolve it, never the prose. */
export async function updateFindingStatus(
  host: SourceHost,
  turnId: string,
  findingId: string,
  status: "open" | "dismissed" | "resolved",
): Promise<void> {
  const chat = host.activeChat();
  const turn = chat?.turns.find((one) => one.id === turnId);
  if (!chat || !turn?.findings) return;
  await host.writes.persistChange(chat, (latest) => ({
    ...latest,
    updatedAt: now(),
    turns: latest.turns.map((one) =>
      one.id === turnId
        ? {
            ...one,
            findings: one.findings?.map((finding) =>
              finding.id === findingId ? { ...finding, status } : finding,
            ),
          }
        : one,
    ),
  }));
}

/**
 * Whether the node's generated summary is missing, current, outdated or
 * unverified.
 *
 * Judged against the source's current bytes, read through `sources.read` as
 * the summary was generated, so a summary written a moment ago is current by
 * construction. The catalogue's stored snapshot hash is not consulted: no
 * save moves it, and a node never hashed has none, so a fresh summary would
 * read "outdated". An unreadable source reads outdated.
 */
export async function summaryStateFor(
  host: SourceHost,
  nodeId: string,
): Promise<SummaryState> {
  const stored = await host.dependencies.artifacts.readSummary(nodeId);
  if (!stored) return "missing";
  const current = new Map<string, string>();
  for (const source of stored.metadata.sources) {
    try {
      const capture = await host.dependencies.sources.read(
        `node:${source.nodeId}`,
      );
      current.set(source.nodeId, capture.revision);
    } catch {
      // Unreadable now: absent from the map, so the check below fails.
    }
  }
  return summaryFreshness(stored, current);
}

/** The sources a chat reads, bound to the aggregate. */
export function bind(host: SourceHost) {
  return {
    missing: withHost(host, missingReferences),
    sectionRevisions: withHost(host, sectionRevisions),
    revealEvidence: withHost(host, revealEvidence),
    open: withHost(host, openSource),
    updateFindingStatus: withHost(host, updateFindingStatus),
    summaryStateFor: withHost(host, summaryStateFor),
  };
}
