// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ChatRecord, SourceDescriptor } from "../domain/types";
import type { Comments } from "../ports";
import { roomEvidence } from "../domain/evidence";
import { planEvidence } from "../domain/plan";
import { titlesOf } from "./chatFacts";

/**
 * What an editor's letter is handed: the book's other chats (`roomEvidence`)
 * and, when this chat's last letter left one, its revision plan, which the
 * letter judges item by item before writing the next. The plan is this
 * chat's own record, so it rides beside the other rooms' evidence
 * rather than inside it, and is never cut short by that block's cap. The
 * margin is read book-wide, every Section's comments; one that cannot be
 * read costs the letter that evidence, never the letter.
 */
export async function letterEvidence(
  chats: readonly ChatRecord[],
  chat: ChatRecord,
  catalog: readonly SourceDescriptor[],
  comments: Comments | undefined,
): Promise<string> {
  const sections = catalog.flatMap((one) =>
    one.kind === "manuscript" && one.nodeId !== undefined ? [one.nodeId] : [],
  );
  const margin =
    comments && sections.length > 0
      ? await comments.threadsOf(sections).catch(() => [])
      : [];
  return [
    roomEvidence(chats, chat, titlesOf(catalog), margin),
    chat.plan && chat.plan.items.length > 0 ? planEvidence(chat.plan) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
