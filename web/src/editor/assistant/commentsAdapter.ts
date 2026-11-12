// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Comments } from "../../ai/ports";
import type {
  ChapterComments,
  CommentProposal,
  CommentThreadView,
  ProposalOutcome,
} from "../../ai/domain/comments";
import { commonmarkCodec } from "../engine";
import { evidenceOrdinal, evidencePassage } from "../searchArrival";
import type { CommentsService } from "../comments/application/comments";
import {
  anchorFrom,
  place,
  within,
  type Placement,
} from "../comments/domain/anchor";
import type { CommentAnchor, Thread } from "../comments/domain/model";
import type { Proposal } from "../comments/domain/proposals";
import { GHOST_COMMENTS_PER_SECTION } from "../comments/domain/limits";
import { escapeRegExp } from "../../text/regExp";

// The margin as the assistant's `Comments` port: the comments' own service
// on one side, the assistant's port on the other. The assistant never sees a
// comments file, an id it could write to, or the editor's types, only each
// thread's passage, its voices and its state.
//
// A node is read fresh unless the margin already holds it ready, so a turn
// asked while the chapter's file is still loading waits for it rather than
// answering as if the margin were empty.
//
// A persona quotes the chapter as the model was shown it, the file's text
// with its markup, and a comment anchors on the writer's visible words. The
// quote is turned into a passage the way an evidence link is (no
// coordinate mapping): parsed by the editor's own codec, looked for as one
// passage, and told apart from a repeat by its context. A quote that runs
// across paragraphs is found whole, its words matched however the model
// wrote the join. A quote the chapter does not hold is refused,
// never placed near enough.

function viewOf(thread: Thread): CommentThreadView {
  return {
    id: thread.id,
    state: thread.state,
    passage: thread.anchor?.quote ?? null,
    entries: thread.entries.map((entry) => ({
      by: entry.author,
      body: entry.body,
    })),
  };
}

/** The anchor for a model's quote of this chapter text, or null. */
export function anchorOfQuote(
  text: string,
  quote: NonNullable<CommentProposal["quote"]>,
): CommentAnchor | null {
  const doc = commonmarkCodec.parse(text);
  const paragraphs = doc.map((para) => para.runs.map((r) => r.text).join(""));
  const passage = evidencePassage(doc, quote.text);
  if (!passage) return spanning(paragraphs, quote);
  const ordinal = evidenceOrdinal(doc, passage, {
    prefix: quote.prefix,
    suffix: quote.suffix,
  });
  let seen = 0;
  let first: Placement | null = null;
  for (let para = 0; para < paragraphs.length; para++) {
    let at = paragraphs[para].indexOf(passage);
    while (at !== -1) {
      const placement = within(para, at, at + passage.length);
      first ??= placement;
      if (seen === ordinal) return anchorFrom(paragraphs, placement);
      seen += 1;
      at = paragraphs[para].indexOf(passage, at + 1);
    }
  }
  // The ordinal counts over the paragraphs run together, where a repeat can
  // straddle a boundary. Past what is found here the first match is the
  // answer, as it is for the painter.
  return first && anchorFrom(paragraphs, first);
}

/**
 * A quote that is not one passage of one paragraph: most often one that runs
 * across paragraphs, which a model writes with a blank line, a single
 * break or only a space where the paragraphs meet. Its words are parsed as
 * the chapter's were and looked for in the chapter's visible text with any
 * run of whitespace standing for any other, so the join never makes a true
 * quote miss. It matches words, never a near match: a quote the chapter does
 * not hold is refused.
 */
function spanning(
  paragraphs: readonly string[],
  quote: NonNullable<CommentProposal["quote"]>,
): CommentAnchor | null {
  const words = commonmarkCodec
    .parse(quote.text.trim())
    .filter((para) => para.blockType !== "pagebreak")
    .map((para) => para.runs.map((r) => r.text).join(""))
    .join(" ")
    .trim();
  if (!words) return null;
  const pattern = new RegExp(
    words.split(/\s+/).map(escapeRegExp).join("\\s+"),
    "g",
  );
  const found = paragraphs.join("\n").match(pattern);
  if (!found) return null;
  // Among repeats, the one whose surroundings agree with the model's: the
  // margin's own way of finding a passage again (`place`).
  const at = place(
    { quote: found[0], prefix: quote.prefix ?? "", suffix: quote.suffix ?? "" },
    paragraphs,
  );
  return at && anchorFrom(paragraphs, at);
}

export function commentsPort(
  service: CommentsService,
  /** The chapter's text as the assistant is shown it, or null. */
  chapterText: (nodeId: string) => Promise<string | null>,
): Comments {
  return {
    cap: GHOST_COMMENTS_PER_SECTION,
    async threadsOf(nodeIds) {
      await Promise.all(
        nodeIds.map((id) =>
          service.stateOf(id)?.status === "ready"
            ? undefined
            : service.reload(id),
        ),
      );
      return nodeIds.flatMap((nodeId): ChapterComments[] => {
        const file = service.fileOf(nodeId);
        return file ? [{ nodeId, threads: file.threads.map(viewOf) }] : [];
      });
    },
    async reply(nodeId, threadId, personaId, body, searched = []) {
      await service.reply(
        nodeId,
        threadId,
        { kind: "persona", id: personaId },
        body,
        searched,
      );
    },
    async propose(nodeId, personaId, proposals) {
      const text = proposals.some((one) => one.quote)
        ? await chapterText(nodeId)
        : null;
      const outcomes: ProposalOutcome[] = proposals.map(() => "unplaceable");
      const asked = new Map<Proposal, number>();
      proposals.forEach((one, index) => {
        const anchor =
          one.quote && text !== null ? anchorOfQuote(text, one.quote) : null;
        if (one.quote && !anchor) return;
        asked.set({ anchor, body: one.body, weight: one.weight }, index);
      });
      if (asked.size === 0) return outcomes;
      const admission = await service.propose(nodeId, personaId, [
        ...asked.keys(),
      ]);
      for (const proposal of admission.admitted) {
        const index = asked.get(proposal);
        if (index !== undefined) outcomes[index] = "placed";
      }
      for (const { proposal, reason } of admission.refused) {
        const index = asked.get(proposal);
        if (index !== undefined) outcomes[index] = reason;
      }
      return outcomes;
    },
  };
}
