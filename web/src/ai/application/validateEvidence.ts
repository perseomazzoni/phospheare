// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { fieldRef, pageOf } from "../domain/referenceCatalogue";
import {
  parseReference,
  recordAt,
  type ParsedReference,
} from "../domain/referenceRecords";
import type {
  ContextUse,
  EvidenceAnchor,
  Finding,
  SourceDescriptor,
  SourceText,
} from "../domain/types";
import { occurrences, typographic } from "../domain/textMatch";
import { plainLine } from "../domain/webText";
import type { AssistantDependencies } from "./assistantTypes";

// Citations are earned, not claimed. The model proposes quotations; this
// module decides whether they exist in the exact text captured for the run
// (`anchorState`). A finding that loses all of its evidence is demoted to an
// observation with an explicit note, because an unsupported "major
// contradiction" is the most damaging thing a review can print.

export type AnchorState = "verified" | "ambiguous" | "missing";

/** Where an anchor lands in a text: its one offset, or why it has none. */
type AnchorMatch =
  { state: "verified"; at: number } | { state: "ambiguous" | "missing" };

/**
 * The one matcher behind `anchorState` and `anchorOffset`. They are two views
 * of one rule: a map placing a beat by one uniqueness test and the evidence
 * button verifying it by another would put a tick on a passage the button
 * then refuses to open.
 */
function matchAnchor(anchor: EvidenceAnchor, raw: string): AnchorMatch {
  if (!anchor.quote) return { state: "missing" };
  // Both sides folded one character for one, so every offset found in the
  // folded text is the same offset in the writer's.
  const text = typographic(raw);
  const quote = typographic(anchor.quote);
  const prefix = anchor.prefix ? typographic(anchor.prefix) : undefined;
  const suffix = anchor.suffix ? typographic(anchor.suffix) : undefined;
  const found = occurrences(text, quote);
  if (found.length === 0) return { state: "missing" };
  if (found.length === 1) return { state: "verified", at: found[0] };
  if (prefix || suffix) {
    const resolved = found.filter((at) => {
      const prefixOk =
        !prefix || text.slice(Math.max(0, at - prefix.length), at) === prefix;
      const suffixOk =
        !suffix ||
        text.slice(at + quote.length, at + quote.length + suffix.length) ===
          suffix;
      return prefixOk && suffixOk;
    });
    if (resolved.length === 1) return { state: "verified", at: resolved[0] };
  }
  return { state: "ambiguous" };
}

/**
 * Whether one anchor matches the captured text. An exact match is required;
 * a repeated quotation is resolved by its prefix and suffix, and otherwise
 * refused rather than guessed.
 */
export function anchorState(anchor: EvidenceAnchor, text: string): AnchorState {
  return matchAnchor(anchor, text).state;
}

/**
 * Where a verified anchor begins in `text`, or `null` when it does not verify
 * there: the rule of `anchorState`, answering where instead of whether, for a
 * figure that places a passage along its Section.
 */
export function anchorOffset(
  anchor: EvidenceAnchor,
  text: string,
): number | null {
  const match = matchAnchor(anchor, text);
  return match.state === "verified" ? match.at : null;
}

/**
 * A web quote as the app found it in the excerpt it claims: the matching
 * slice of the excerpt's plain line, or `null` when it is not there.
 * It is the app's slice, not the model's string. Both sides go through the
 * one `plainLine`, so the slice is the normalised quote, and a quote that
 * differs by a curly apostrophe or a widened space is not found rather than
 * repaired.
 *
 * One occurrence is enough: unlike a passage in the manuscript there is no
 * place to open, so a phrase an excerpt repeats is still a phrase it holds.
 * An empty or invisible-only quote is never found, since it would match
 * everywhere.
 */
export function quoteIn(text: string, quote: string): string | null {
  const needle = plainLine(quote);
  // An empty needle is `occurrences`' guard to answer, found nowhere.
  const at = occurrences(plainLine(text), needle)[0];
  return at === undefined ? null : needle;
}

export interface FindingValidation {
  finding: Finding;
  droppedAnchors: number;
  demoted: boolean;
}

/**
 * What the evidence check knows of each source beyond its capture: whether
 * it is a reference, and which page. Absent, every source is checked
 * as text alone.
 */
export type SourceKind = Pick<
  SourceDescriptor,
  "kind" | "group" | "sectionId" | "summarises" | "title"
>;
export type SourceKinds = ReadonlyMap<string, SourceKind>;

/**
 * A reference's records over its capture, or `null` for a source that is not
 * a reference, such as the manuscript or a summary. A note counts as one: its
 * lines are records the catalogue could not place, and a quote must still sit
 * inside one of them.
 */
function referenceOf(
  source: SourceKind,
  capture: SourceText,
): ParsedReference | null {
  if (source.kind !== "reference" && source.kind !== "note") return null;
  if (source.summarises !== undefined) return null;
  return parseReference(capture.text, pageOf(source), source.title);
}

/**
 * Validates one finding against the captures of the sources it cites. Anchors
 * against unknown sources or a changed revision are dropped, as are quotes
 * that cannot be located uniquely. The finding survives with its remaining
 * evidence; with none left it becomes an observation carrying the reason.
 */
export function validateFinding(
  finding: Finding,
  captures: ReadonlyMap<string, SourceText>,
  kinds: SourceKinds = new Map(),
  parsed: Map<string, ParsedReference | null> = new Map(),
): FindingValidation {
  let dropped = 0;
  const evidence: EvidenceAnchor[] = [];
  for (const anchor of finding.evidence) {
    const capture = captures.get(anchor.sourceId);
    if (!capture) {
      dropped += 1;
      continue;
    }
    if (anchor.revision && anchor.revision !== capture.revision) {
      dropped += 1;
      continue;
    }
    const at = anchorOffset(anchor, capture.text);
    if (at === null) {
      dropped += 1;
      continue;
    }
    // A reference's quote stands inside one of its answers, and the field it
    // names is the one it was found in, never one the model claims.
    // A label, a heading, or a run across two answers is no evidence, and the
    // same words under two fields are told apart by their place.
    const kind = kinds.get(anchor.sourceId);
    if (kind && !parsed.has(anchor.sourceId))
      parsed.set(anchor.sourceId, referenceOf(kind, capture));
    const reference = parsed.get(anchor.sourceId) ?? null;
    const { field: _claimed, ...rest } = anchor;
    if (reference) {
      const record = recordAt(reference, at, at + anchor.quote.length);
      if (!record) {
        dropped += 1;
        continue;
      }
      evidence.push({
        ...rest,
        revision: capture.revision,
        ...(record.field ? { field: fieldRef(record.field) } : {}),
      });
      continue;
    }
    evidence.push({ ...rest, revision: capture.revision });
  }
  // A claim between sources (the prose against a character sheet, chapter
  // two against chapter nine) stands on both sides. With one side unverified
  // what remains is half a contradiction, which reads as a finding about the
  // other side alone, so it is an observation.
  const sides = (anchors: readonly EvidenceAnchor[]) =>
    new Set(anchors.map((anchor) => anchor.sourceId)).size;
  const halved = sides(finding.evidence) >= 2 && sides(evidence) < 2;
  const demoted =
    (evidence.length === 0 && finding.evidence.length > 0) || halved;
  if (!demoted)
    return {
      finding: { ...finding, evidence },
      droppedAnchors: dropped,
      demoted: false,
    };
  return {
    finding: {
      ...finding,
      severity: "observation",
      // The side that did verify stays, so the writer can still look at it.
      evidence: halved ? evidence : [],
      // Said by the screen, in the writer's language (`Finding.unverified`).
      unverified: halved ? "half" : "all",
    },
    droppedAnchors: dropped,
    demoted: true,
  };
}

export interface FindingsValidation {
  findings: Finding[];
  droppedAnchors: number;
  demoted: number;
  rejected: number;
}

/** At most this many places one finding names, as the tool schema allows. */
const EVIDENCE_PER_FINDING = 8;

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  observation: 0,
  minor: 1,
  major: 2,
};

/**
 * Two findings that contest the same passage, folded into one.
 *
 * The fact check compares every value of a fact with every other, so one slip
 * in one sentence yields a finding per place it disagrees with, and each
 * would be a second margin comment on the same words. The first finding
 * keeps its title, the heavier severity wins, and a second claim with its own
 * title is kept in the explanation.
 */
function mergeFinding(into: Finding, from: Finding): Finding {
  const places = new Set(
    into.evidence.map((one) => `${one.sourceId}\u0000${one.quote}`),
  );
  const evidence = [...into.evidence];
  for (const one of from.evidence) {
    const key = `${one.sourceId}\u0000${one.quote}`;
    if (places.has(key) || evidence.length >= EVIDENCE_PER_FINDING) continue;
    places.add(key);
    evidence.push(one);
  }
  const sameClaim =
    from.title.trim().toLocaleLowerCase() ===
    into.title.trim().toLocaleLowerCase();
  return {
    ...into,
    severity:
      SEVERITY_RANK[from.severity] > SEVERITY_RANK[into.severity]
        ? from.severity
        : into.severity,
    explanation: sameClaim
      ? into.explanation
      : `${into.explanation}\n\n${from.title.trim()}: ${from.explanation.trim()}`,
    evidence,
  };
}

/**
 * Validates and deduplicates a batch of findings, preserving order. Findings
 * whose first verified quote is the same passage become one.
 */
export function validateFindings(
  findings: readonly Finding[],
  captures: ReadonlyMap<string, SourceText>,
  kinds: SourceKinds = new Map(),
): FindingsValidation {
  // Each reference parsed once for the batch.
  const parsed = new Map<string, ParsedReference | null>();
  const seen = new Set<string>();
  const byPlace = new Map<string, number>();
  const out: Finding[] = [];
  let droppedAnchors = 0;
  let demoted = 0;
  let rejected = 0;
  for (const finding of findings) {
    // An exact repeat (same claim, same places) is dropped before any work.
    // A repeat that names another place goes on, and is folded below.
    const key = `${finding.title.trim().toLocaleLowerCase()}\u0000${finding.evidence
      .map((one) => `${one.sourceId}\u0000${one.quote}`)
      .join("\u0001")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!finding.title.trim() || !finding.explanation.trim()) {
      rejected += 1;
      continue;
    }
    const validated = validateFinding(finding, captures, kinds, parsed);
    droppedAnchors += validated.droppedAnchors;
    if (validated.demoted) demoted += 1;
    // Only a passage that verified is a place to fold on: an unverified
    // finding has no passage the two could share.
    const first = validated.demoted ? undefined : validated.finding.evidence[0];
    const place = first ? `${first.sourceId}\u0000${first.quote}` : null;
    const at = place === null ? undefined : byPlace.get(place);
    if (at !== undefined) {
      out[at] = mergeFinding(out[at], validated.finding);
      continue;
    }
    if (place !== null) byPlace.set(place, out.length);
    out.push(validated.finding);
  }
  return { findings: out, droppedAnchors, demoted, rejected };
}

/** A turn's findings, each anchor checked against the source as it is now. */
export async function validateTurnFindings(
  dependencies: AssistantDependencies,
  findings: Finding[],
  used: ContextUse[],
): Promise<Finding[]> {
  const captures = new Map<
    string,
    { text: string; revision: string; origin: "live-buffer" | "project-file" }
  >();
  for (const sourceId of new Set(
    findings.flatMap((finding) =>
      finding.evidence.map((anchor) => anchor.sourceId),
    ),
  )) {
    try {
      if (!used.some((use) => use.id === sourceId)) continue;
      captures.set(sourceId, await dependencies.sources.read(sourceId));
    } catch {
      // Unreadable now; the anchor is dropped by validation.
    }
  }
  return validateFindings(
    findings,
    captures,
    new Map(used.map((use) => [use.id, use])),
  ).findings;
}
