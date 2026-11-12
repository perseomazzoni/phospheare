// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The layer stack: which overlay is on top, and what Escape closes.
//
// Pure and its own module, because "Escape closes the innermost layer only"
// is a decision rather than a DOM operation. Layers each installing a key
// listener and relying on their order would close two dialogs with one
// keypress; one listener asks this module instead. The part that can be got
// wrong is the part tested in Node, as with `dropTarget.ts` beside the
// document tree.

export type LayerRole = "dialog" | "alertdialog" | "menu";

export interface Layer {
  id: string;
  role: LayerRole;
  /**
   * Whether Escape and a backdrop click may close it. False for a job in
   * flight, such as a copy the writer would have to restart, and for an alert
   * whose choice must be deliberate; those offer an explicit Cancel instead.
   */
  dismissible: boolean;
}

/**
 * Add a layer, or update one already present. Idempotent by id, because
 * StrictMode mounts every effect twice, and a stack that grew on the second
 * mount would need two Escapes to clear one dialog.
 */
export function push(stack: readonly Layer[], layer: Layer): Layer[] {
  const without = stack.filter((l) => l.id !== layer.id);
  return [...without, layer];
}

/**
 * Change whether an open layer may be dismissed, in place: it keeps its
 * position on the stack. The same array comes back when nothing changes, so
 * a re-render that restates the flag notifies nobody.
 *
 * The flag is live, not read once at push: a dialog that opens dismissible
 * and then starts a job (the summary dialog choosing a model, then writing)
 * must stop being dismissible, or a backdrop click unmounts it and cancels
 * the job it holds.
 */
export function setDismissible(
  stack: readonly Layer[],
  id: string,
  dismissible: boolean,
): readonly Layer[] {
  const layer = stack.find((l) => l.id === id);
  if (!layer || layer.dismissible === dismissible) return stack;
  return stack.map((l) => (l.id === id ? { ...l, dismissible } : l));
}

/**
 * Remove a layer. Tolerates an absent id, for the same StrictMode reason
 * `push` is idempotent.
 */
export function remove(stack: readonly Layer[], id: string): Layer[] {
  return stack.filter((l) => l.id !== id);
}

/**
 * Whether this layer holds the tab order inside itself. A menu is on the
 * stack but is not a modal: it owns the arrow keys while open and must close
 * the innermost thing on Escape, which is why it is on the stack, but Tab is
 * how a writer leaves it. Trapping the tab order in a six-item popover
 * strands a keyboard user in it.
 */
export function trapsFocus(layer: Layer | null): boolean {
  return !!layer && layer.role !== "menu";
}

export function top(stack: readonly Layer[]): Layer | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function isTop(stack: readonly Layer[], id: string): boolean {
  return top(stack)?.id === id;
}

/**
 * What Escape closes, or null when it does nothing. Only the top layer: a
 * menu open over a dialog closes the menu and leaves the dialog standing. A
 * non-dismissible layer on top swallows the key rather than passing it down,
 * because reaching past it is what a modal exists to prevent.
 */
export function escapeTarget(stack: readonly Layer[]): string | null {
  const t = top(stack);
  if (!t) return null;
  return t.dismissible ? t.id : null;
}

/**
 * Whether a backdrop click on this layer closes it. The same rule as Escape,
 * plus one: only the top layer has a reachable backdrop, so a click arriving
 * for a buried layer is stale and ignored.
 */
export function backdropCloses(stack: readonly Layer[], id: string): boolean {
  const t = top(stack);
  return !!t && t.id === id && t.dismissible;
}
