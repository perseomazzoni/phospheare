// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  commentsContext,
  type ChapterLabel,
  type CommentedChapter,
  type CommentProposal,
  type ProposalOutcome,
} from "../domain/comments";
import type {
  ChatKind,
  ContextUse,
  Finding,
  SourceDescriptor,
} from "../domain/types";
import type { Comments } from "../ports";
import {
  COMMENTS_CONTEXT_CHARACTERS,
  COMMENTS_CONTEXT_SHARE,
  type RunBudget,
} from "./budgets";

// ── A turn's comments block ──────────────────────────────────────────────────
//
// The comments of the chapters this turn attached (the prose the persona is
// looking at), read through the port and rendered for the persona answering.
// Only the attached chapters: a margin elsewhere in the book is the writer's
// business until the persona reads that chapter.
//
// Not in a reader's chat: a first reader never sees a margin full of the
// writer's and an editor's notes, which is the contamination the reader
// boundary exists to prevent.

const READERS: ReadonlySet<ChatKind> = new Set(["alpha-reader", "beta-reader"]);

export async function commentsBlock(
  port: Comments | undefined,
  kind: ChatKind,
  uses: readonly ContextUse[],
  personaId: string,
  personaName: (id: string) => string | null,
  budget: RunBudget,
): Promise<string> {
  if (!port || READERS.has(kind)) return "";
  const labels = new Map<string, ChapterLabel>();
  for (const use of uses)
    if (use.kind === "manuscript" && use.nodeId && !labels.has(use.nodeId))
      labels.set(use.nodeId, { sourceId: use.id, title: use.title });
  if (labels.size === 0) return "";
  let chapters;
  try {
    chapters = await port.threadsOf([...labels.keys()]);
  } catch {
    // A margin that cannot be read costs the turn its comments, never the
    // turn: the prose is still there to answer from.
    return "";
  }
  return commentsContext(
    chapters,
    labels,
    personaId,
    personaName,
    Math.min(
      COMMENTS_CONTEXT_CHARACTERS,
      Math.floor(budget.totalCharacters * COMMENTS_CONTEXT_SHARE),
    ),
  );
}

// ── Review findings into the margin ──────────────────────────────────────────
//
// A finding about one chapter's words belongs beside them: it leaves the
// chat and becomes a ghost comment there, which the writer keeps, answers or
// dismisses where the words are. What stays in the chat is what has no one
// place in a chapter: a finding whose evidence spans chapters, or one the
// evidence check could not verify, which must never be pinned to words as
// though it were proven.
//
// The margin has the last word on each one. A finding the writer already
// dismissed or settled there, or that the margin already holds, is gone from
// both: answered once is answered. One the margin has no room for, or whose
// quote it cannot find as one passage, stays in the chat, so nothing a review
// found is lost to a cap.

/**
 * The finding as a margin note: its claim, its reasoning, and its other
 * places as bare quotations — the note is read in the writer's language, so
 * the app adds no words of its own to it.
 */
function noteOf(finding: Finding): string {
  const also = finding.evidence.slice(1).map((anchor) => `“${anchor.quote}”`);
  return [
    finding.title,
    finding.explanation,
    ...(finding.uncertainty ? [finding.uncertainty] : []),
    ...also,
  ]
    .filter((part) => part.trim())
    .join("\n\n");
}

/** The one chapter a finding's evidence is in, or null for none or several. */
function chapterOf(
  finding: Finding,
  catalog: readonly SourceDescriptor[],
): string | null {
  if (finding.unverified || finding.evidence.length === 0) return null;
  const ids = new Set(finding.evidence.map((anchor) => anchor.sourceId));
  if (ids.size !== 1) return null;
  const [id] = ids;
  const source = catalog.find((one) => one.id === id);
  return source?.kind === "manuscript" && source.nodeId ? source.nodeId : null;
}

const STAYS: ReadonlySet<ProposalOutcome> = new Set(["cap", "unplaceable"]);

export async function divertFindings(
  port: Comments | undefined,
  findings: readonly Finding[],
  catalog: readonly SourceDescriptor[],
  personaId: string,
): Promise<{ findings: Finding[]; commented: CommentedChapter[] }> {
  if (!port || findings.length === 0)
    return { findings: [...findings], commented: [] };
  const byNode = new Map<string, Finding[]>();
  for (const finding of findings) {
    const nodeId = chapterOf(finding, catalog);
    if (nodeId) byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), finding]);
  }
  const gone = new Set<Finding>();
  const commented: CommentedChapter[] = [];
  for (const [nodeId, list] of byNode) {
    let outcomes: ProposalOutcome[];
    try {
      outcomes = await port.propose(
        nodeId,
        personaId,
        list.map((finding) => {
          const [first] = finding.evidence;
          return {
            quote: {
              text: first.quote,
              ...(first.prefix ? { prefix: first.prefix } : {}),
              ...(first.suffix ? { suffix: first.suffix } : {}),
            },
            body: noteOf(finding),
            weight: finding.severity,
          };
        }),
      );
    } catch {
      // A margin that cannot be written keeps its findings in the chat.
      continue;
    }
    let placed = 0;
    list.forEach((finding, index) => {
      const outcome = outcomes[index] ?? "unplaceable";
      if (STAYS.has(outcome)) return;
      gone.add(finding);
      if (outcome === "placed") placed += 1;
    });
    if (placed > 0) commented.push({ nodeId, count: placed });
  }
  return {
    findings: findings.filter((finding) => !gone.has(finding)),
    commented,
  };
}

// ── Drafting notes into the margin ───────────────────────────────────────────
//
// What a drafting persona noticed and held back while the writer was in the
// scene (`splitForLater`) waits in the margin of the Section being drafted,
// as ghost comments the writer finds when they look up.
//
// A note the model pinned to words the Section does not hold as one passage
// is not lost for a misquote: it goes on the Section as a whole, carrying the
// words it meant as a bare quotation, the same shape a finding's other
// places take (`noteOf`). One the margin refuses for any other reason (no
// room, already dismissed, already there) is gone: the margin's answer is
// the answer. A margin that cannot be written costs the notes, never the
// turn, because the answer the writer asked for is what matters mid-scene.

/** How many of `notes` the margin now holds as ghost comments. */
export async function keepForLater(
  port: Comments,
  nodeId: string,
  personaId: string,
  notes: readonly CommentProposal[],
): Promise<number> {
  if (notes.length === 0) return 0;
  try {
    const outcomes = await port.propose(nodeId, personaId, notes);
    const misquoted = notes.filter(
      (note, index) => note.quote && outcomes[index] === "unplaceable",
    );
    let placed = outcomes.filter((one) => one === "placed").length;
    if (misquoted.length > 0) {
      const again = await port.propose(
        nodeId,
        personaId,
        misquoted.map((note) => ({
          quote: null,
          body: `${note.body}\n\n“${note.quote?.text ?? ""}”`,
          weight: note.weight,
        })),
      );
      placed += again.filter((one) => one === "placed").length;
    }
    return placed;
  } catch {
    return 0;
  }
}
