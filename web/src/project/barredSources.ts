// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// `assistant/barred-sources.json`: the writer's standing "never let the
// assistant read this" list. It belongs to the book, not to one chat: on a
// chat, a new chat would silently expose the source again, and a privacy rule
// must not fail open. Manuscript nodes are never in it: the manuscript is what
// the assistant is for, and showing less of the book is a reader's per-chat
// scope.
//
// It is its own file, not a block of `document-properties.json`, because the
// sync never compares the properties file: a bar kept there would stay on the
// device that set it, and a paired copy would let the assistant read the
// source. Under `assistant/` the file travels and conflicts like the chats.
//
// A source id is an address the AI adapter mints, so it is a free string
// here. An id naming something not in the project is inert, and a document
// restored from the recycle bin comes back still barred, as the writer meant.

/** No file yet: nothing barred. */
export const NO_BARS: readonly string[] = [];

/**
 * The ids in `raw`, or `null` for a damaged file: text that is not JSON, or
 * no `sourceIds` list. A damaged file is never read as nothing barred, since
 * that would open every source it bars. Inside a list, an entry that is not
 * a non-empty string is dropped: it can name no source.
 */
export function parseBarred(raw: string): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const ids = (data as Record<string, unknown>).sourceIds;
  if (!Array.isArray(ids)) return null;
  return [
    ...new Set(
      ids.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

export function serializeBarred(ids: readonly string[]): string {
  // Trailing newline and two-space indent: the file lives in the writer's
  // folder and may end up in their git history.
  return `${JSON.stringify({ sourceIds: ids }, null, 2)}\n`;
}

/** Bars a source, or lets it back in. */
export function withBarred(
  ids: readonly string[],
  sourceId: string,
  barred: boolean,
): readonly string[] {
  const without = ids.filter((id) => id !== sourceId);
  return barred ? [...without, sourceId] : without;
}
