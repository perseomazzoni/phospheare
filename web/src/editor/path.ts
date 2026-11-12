// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ProjectRef } from "../storage";

// Where a project is edited: the editor's second entry point. The workspace
// builds links into the editor without loading it; importing from `../editor`
// would put the route, its components and its stylesheet into the bundle
// every visitor downloads.
//
// So this file has no imports but a type and no side effects. Anything
// heavier belongs behind `../editor`.

/**
 * The address of one project: its own id, and nothing else.
 *
 * The id is `document.id` from the project's `document-properties.json`, a
 * `crypto.randomUUID()` minted when the book is created, carried on the
 * library row's card, and stable across every move, rename and re-pairing.
 * Where the bytes live stays out of the URL, so moving a book between this
 * device and a remote does not break a bookmark.
 *
 * Encoded although a uuid needs no encoding: the id is read from a JSON file a
 * writer can hand-edit, and an unencoded one could emit a path separator.
 */
export function projectPath(projectId: string): string {
  return `/app/project/${encodeURIComponent(projectId)}`;
}

/**
 * What the project's spine is called during a view transition.
 *
 * The shelf draws it on a card and the editor in the panel's head; naming both
 * makes the browser move that shape between the screens instead of
 * cross-fading two pages, because one project is what is being opened.
 *
 * It lives here for the same reason as `projectPath`: both halves need it, and
 * neither may import the other. Sanitised because a `view-transition-name` is
 * a CSS identifier and a ref's key is a folder name.
 */
export function spineName(ref: Pick<ProjectRef, "providerId" | "key">): string {
  return `spine-${`${ref.providerId}-${ref.key}`.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}
