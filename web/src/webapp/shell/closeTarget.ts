// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Where closing the settings sheet goes. The sheet is a route, so closing it
// is a navigation, and two different situations look identical from inside
// the component.
//
// Opened from the Library, there is history behind: going back keeps the
// writer's Back button and the sheet's close button in agreement and leaves
// no phantom entry in the stack.
//
// Reached by a deep link, a bookmark or a fresh tab, there is nothing behind.
// Going back would leave the writer on whatever page came before, or on a
// blank tab, so closing takes them to the shelf.
//
// Pure and its own module, because the wrong branch strands somebody.

export type CloseTarget = { back: true } | { to: string };

/**
 * `state` is react-router's location state, which is `unknown`: it survives a
 * reload through the history entry and can hold anything an earlier build of
 * the app put there.
 */
export function closeTarget(state: unknown): CloseTarget {
  const from = state as { fromLibrary?: unknown } | null | undefined;
  return from?.fromLibrary === true ? { back: true } : { to: "/app" };
}
