// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { parseFrontmatter, requireField } from "./frontmatter";

// The craft lenses: one Markdown file per craft concept under `craft/`, read
// at build time the way `personas/` and `skills/` are. A lens is the depth
// behind an obsession. `obsessions.md` says in a line what a persona notices;
// the lens says what the thing is, why a reader feels it, how it fails and
// what an intended use looks like, so a model judging a candidate has the
// reasoning, not only the rule.
//
// Lenses are written for this app in its own words, from concepts that belong
// to the craft as a whole, with no book's text and no single teacher's
// system. They are English, like every instruction a model reads.
//
// A lens reaches a prompt only when an active obsession names it, and only
// the first `LENS_LIMIT` of those: lenses are the longest thing a persona
// carries, and a local model's window is the budget they spend.

const RAW = import.meta.glob<string>("./craft/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface CraftLens {
  /** The file's stem: `arc` for `craft/arc.md`. What an obsession names. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** How many lenses one prompt carries at most. */
export const LENS_LIMIT = 2;

const STEM = /^[a-z]+(?:-[a-z]+)*$/;

/** One lens file, read strictly; a malformed one throws, naming itself. */
export function parseLens(path: string, text: string): CraftLens {
  const id = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  if (!STEM.test(id)) throw new Error(`${path}: a lens is named in kebab-case`);
  const parsed = parseFrontmatter(path, text);
  return { id, title: requireField(path, parsed, "title"), body: parsed.body };
}

export const LENSES: ReadonlyMap<string, CraftLens> = new Map(
  Object.entries(RAW)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, text]) => {
      const lens = parseLens(path, text);
      return [lens.id, lens] as const;
    }),
);

/**
 * The lenses a set of obsessions names, first-named first, each once, at most
 * `limit` of them. Unknown ids are impossible by construction — the catalogue
 * refuses a lens with no file — and are skipped rather than trusted here.
 */
export function lensesFor(
  ids: readonly (string | undefined)[],
  limit = LENS_LIMIT,
  lenses: ReadonlyMap<string, CraftLens> = LENSES,
): CraftLens[] {
  const out: CraftLens[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const lens = id ? lenses.get(id) : undefined;
    if (lens && !out.includes(lens)) out.push(lens);
  }
  return out;
}
