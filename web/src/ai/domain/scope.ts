// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  REVIEW_REFERENCES_MAX,
  REVIEW_REFERENCE_ID_MAX,
  SCOPE_KINDS,
  type ReviewScope,
  type ScopeKind,
} from "./types";

// The scope words, held once. They are what the parser accepts, in
// both languages, whatever language the interface is in, so they live here
// rather than in the locale files, which hold only what the words mean. A
// second copy in a locale file would be a word the ghost shows that the
// parser does not take; `locales.test.ts` fails if one appears there.

/** Each scope's word in each interface language. */
export const SCOPE_WORDS: Readonly<
  Record<ScopeKind, { readonly en: string; readonly it: string }>
> = {
  section: { en: "section", it: "sezione" },
  part: { en: "part", it: "parte" },
  structure: { en: "structure", it: "struttura" },
};

/**
 * The quote a command at `scope` reads, if any: only the nearest scope
 * (`current`) reads the attached passage; every wider one, `section`
 * included, reads the whole of its scope and leaves the quote where it is.
 * One rule serves the typed line and the edited one, so the same
 * words never read a passage when typed and the whole Section when edited.
 */
export function passageFor<Q>(scope: ReviewScope, quote: Q): Q | undefined {
  return scope.kind === "current" ? quote : undefined;
}

/**
 * The comparison form of a typed word or a title: case, surrounding space and
 * runs of space do not tell two of them apart; letters and punctuation do.
 * Exact after that: a prefix or a near miss is not a match, because a
 * sentence that begins like a title must stay a question.
 */
export function normaliseTyped(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/** The scope a typed word names, in either language, or `null`. */
export function scopeKindOf(word: string): ScopeKind | null {
  const typed = normaliseTyped(word);
  return (
    SCOPE_KINDS.find((kind) =>
      Object.values(SCOPE_WORDS[kind]).some((one) => one === typed),
    ) ?? null
  );
}

/**
 * Whether `scope` is one a wide plan is made for: the whole Structure, or a
 * `node` (which the run checks names a Part). `part` is resolved to its
 * `node` before it is planned, so a stored `part` is never one.
 */
export function wideScope(
  scope: ReviewScope,
): scope is { kind: "structure" } | { kind: "node"; nodeId: string } {
  return scope.kind === "structure" || scope.kind === "node";
}

/** A node id is a path segment the port minted, never prose. */
const NODE_ID_MAX = 200;

/**
 * Whether a value read back from a chat file or a review checkpoint is a
 * scope this app can run. The files live in a folder that can be shared, and
 * the scope decides how much of the manuscript a run reads.
 */
export function isReviewScope(value: unknown): value is ReviewScope {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "current") return true;
  if (kind === "node") {
    const nodeId = (value as { nodeId?: unknown }).nodeId;
    return (
      typeof nodeId === "string" &&
      nodeId.length > 0 &&
      nodeId.length <= NODE_ID_MAX
    );
  }
  return (SCOPE_KINDS as readonly unknown[]).includes(kind);
}

/**
 * Whether `value` is a set of named reference ids a chat file or a plan may
 * carry: a bounded, non-empty list of distinct `reference:` ids.
 * Absent means every read, so `[]` says nothing and is refused. Which of them
 * the review may still name is the run's question, asked of the live
 * catalogue; this checks only the shape.
 */
export function isReviewReferences(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= REVIEW_REFERENCES_MAX &&
    new Set(value).size === value.length &&
    value.every(
      (id) =>
        typeof id === "string" &&
        id.startsWith("reference:") &&
        id.length > "reference:".length &&
        id.length <= REVIEW_REFERENCE_ID_MAX,
    )
  );
}
