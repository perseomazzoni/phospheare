// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The editor's chunk: the one place that knows how to fetch the other half,
// so `App.tsx` stays the only file that knows the editor exists as a set of
// components.
//
// The dynamic import creates the chunk boundary: the editor is much larger
// than the web application around it, and a visitor reading the homepage has
// no use for an engine and a document tree. Nothing here is imported
// statically, so this module costs one function.
//
// It is a module rather than inline in `App.tsx` because two callers need the
// same promise: `lazy()`, which renders it, and the shelf's cards, which warm
// it on hover and focus. A second `import()` returns the module registry's
// copy, so warming and rendering cannot race or double-fetch.

export const loadEditor = () => import("./editor");

/**
 * A signed-in writer's project route. Its own loader, so the account, sync and
 * provider modules it brings are fetched by the full program's project route
 * and reached by nothing else.
 */
export const loadProjectRoute = () => import("./editor/ProjectRoute");

/**
 * The export window, for a Library card. A loader of its own rather
 * than a member of the editor's chunk: the shelf needs the window, not the
 * engine and the document tree around it. The window's own weight, eight
 * writers each behind its own import, is paid by a writer who asks to export,
 * never by one who came to open a book.
 */
export const loadExport = () => import("./editor/export");

/**
 * The import window, behind a loader of its own for the export's reason: its
 * readers are paid for by a writer who imports, never by one who came to
 * write.
 */
export const loadImport = () => import("./editor/import");

/**
 * Start fetching the editor, and ignore the result.
 *
 * For a pointer or focus that has reached a project before a click. A
 * failure is swallowed: the work is speculative, and a network blip while
 * hovering must not surface an error for something the writer never asked
 * for. The real navigation asks again and reports its own failure.
 */
export function warmEditor(): void {
  void loadEditor().catch(() => {});
}
