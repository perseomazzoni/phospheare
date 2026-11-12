// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { GHOST_COMMENTS_PER_SECTION } from "./limits";
import {
  firstLine,
  personaOf,
  type CommentAnchor,
  type CommentsFile,
  type Weight,
} from "./model";

// Which of a persona's proposals become ghost comments. A persona proposes;
// the file decides. Three rules, in this order:
//
//   - nothing raised twice: a proposal on a passage the same persona was
//     turned away on (a dismissal), already settled (a resolved thread), or
//     already speaks to (a thread it owns, waiting or kept) is refused;
//   - the heaviest first: what is left is ranked major, minor, observation,
//     keeping the persona's own order inside each weight;
//   - the cap: one persona never has more than `GHOST_COMMENTS_PER_SECTION`
//     ghost comments waiting in one chapter, so a run takes only the room
//     left. Keeping or dismissing a ghost frees room.
//
// "The same passage" is an overlap of the quoted words, one containing the
// other, because a persona coming back to a sentence rarely quotes it to the
// letter. A chapter-level proposal is the same as another when their first
// lines are.

export interface Proposal {
  anchor: CommentAnchor | null;
  body: string;
  weight: Weight;
}

export type RefusalReason = "dismissed" | "settled" | "duplicate" | "cap";

export interface Admission {
  admitted: Proposal[];
  refused: { proposal: Proposal; reason: RefusalReason }[];
}

const RANK: Record<Weight, number> = { major: 0, minor: 1, observation: 2 };

function sameSubject(
  a: { quote: string; gist: string },
  b: { quote: string; gist: string },
): boolean {
  if (a.quote && b.quote) {
    const x = a.quote.toLocaleLowerCase();
    const y = b.quote.toLocaleLowerCase();
    return x.includes(y) || y.includes(x);
  }
  if (!a.quote && !b.quote)
    return (
      a.gist.trim().toLocaleLowerCase() === b.gist.trim().toLocaleLowerCase()
    );
  return false;
}

function subjectOf(proposal: Proposal): { quote: string; gist: string } {
  return {
    quote: proposal.anchor?.quote ?? "",
    gist: firstLine(proposal.body),
  };
}

/** Which proposals the file takes, and why the rest are turned away. */
export function admit(
  file: CommentsFile,
  persona: string,
  proposals: readonly Proposal[],
  cap = GHOST_COMMENTS_PER_SECTION,
): Admission {
  const refused: Admission["refused"] = [];
  const own = file.threads.filter((thread) => personaOf(thread) === persona);
  const waiting = own.filter((thread) => thread.state === "proposed").length;
  const candidates: Proposal[] = [];
  for (const proposal of proposals) {
    const subject = subjectOf(proposal);
    if (
      file.dismissed.some(
        (one) => one.persona === persona && sameSubject(one, subject),
      )
    ) {
      refused.push({ proposal, reason: "dismissed" });
      continue;
    }
    const earlier = own.find((thread) =>
      sameSubject(
        {
          quote: thread.anchor?.quote ?? "",
          gist: firstLine(thread.entries[0].body),
        },
        subject,
      ),
    );
    if (earlier) {
      refused.push({
        proposal,
        reason: earlier.state === "resolved" ? "settled" : "duplicate",
      });
      continue;
    }
    if (candidates.some((one) => sameSubject(subjectOf(one), subject))) {
      refused.push({ proposal, reason: "duplicate" });
      continue;
    }
    candidates.push(proposal);
  }
  const ranked = candidates
    .map((proposal, order) => ({ proposal, order }))
    .sort(
      (a, b) =>
        RANK[a.proposal.weight] - RANK[b.proposal.weight] || a.order - b.order,
    )
    .map((one) => one.proposal);
  const room = Math.max(0, cap - waiting);
  for (const proposal of ranked.slice(room))
    refused.push({ proposal, reason: "cap" });
  return { admitted: ranked.slice(0, room), refused };
}
