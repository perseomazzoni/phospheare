// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";
import { FOCUSABLE, nextFocusIndex } from "./focusOrder";
import {
  backdropCloses,
  escapeTarget,
  isTop,
  push,
  remove,
  setDismissible,
  trapsFocus,
  type Layer,
  type LayerRole,
} from "./layerStack";

// The overlay hook: everything a modal must do that a plain `<div>` does not.
// It moves focus in, keeps it in, puts the rest of the app out of reach, and
// gives focus back on the way out.
//
// Every decision, such as what Escape closes and where Tab goes next, is made
// in `layerStack.ts` and `focusOrder.ts`, which are pure and tested. This file
// holds only what needs a browser.
//
// One `keydown` listener serves the whole app, owned by this module rather
// than by each layer: per-layer listeners fire in registration order, which
// differs from stacking order once anything closes out of turn.

let stack: readonly Layer[] = [];
const listeners = new Set<() => void>();

function setStack(next: readonly Layer[]): void {
  stack = next;
  for (const l of listeners) l();
}

/** The element each open layer wants focus trapped inside. */
const containers = new Map<string, HTMLElement>();
const closers = new Map<string, () => void>();

/**
 * How many open layers hold each element inert. Layers share one background,
 * so a dialog stacked on a sheet closing must leave it inert for the sheet.
 */
const inertHolds = new Map<HTMLElement, number>();

function holdInert(target: HTMLElement): void {
  inertHolds.set(target, (inertHolds.get(target) ?? 0) + 1);
  target.inert = true;
}

function releaseInert(target: HTMLElement): void {
  const left = (inertHolds.get(target) ?? 1) - 1;
  if (left > 0) {
    inertHolds.set(target, left);
    return;
  }
  inertHolds.delete(target);
  target.inert = false;
}

function focusablesIn(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // `offsetParent` misses `position: fixed`, which every sheet uses.
    (n) => n.getClientRects().length > 0,
  );
}

function onKeyDown(event: KeyboardEvent): void {
  if (stack.length === 0) return;

  // An Escape while an IME is composing cancels the candidate. It belongs to
  // the field, so no layer closes and the field's own handler still hears it.
  if (event.key === "Escape" && !event.isComposing) {
    const id = escapeTarget(stack);
    // Spent either way, so it stops here. `preventDefault` alone cancels only
    // the browser's default; the key still travels to the target and back up
    // to the window, where a panel underneath would answer it too, closing a
    // dialog over the revision rail and discarding the walk in one keystroke.
    // Stopping propagation enforces `layerStack`'s rule that Escape closes
    // the innermost layer only.
    event.stopPropagation();
    if (!id) {
      // A layer that refuses Escape swallows it rather than letting it reach
      // whatever is underneath.
      if (stack.length > 0) event.preventDefault();
      return;
    }
    event.preventDefault();
    closers.get(id)?.();
    return;
  }

  if (event.key !== "Tab") return;

  const topLayer = stack[stack.length - 1];
  // A popover is on the stack for Escape's sake, not the tab order's, as
  // `trapsFocus` says.
  if (!trapsFocus(topLayer)) return;

  const container = containers.get(topLayer.id);
  if (!container) return;

  const items = focusablesIn(container);
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = nextFocusIndex(items.length, at, event.shiftKey);
  if (next < 0) {
    // Nothing focusable inside. Hold focus on the container rather than let
    // Tab walk out into a page that is meant to be unreachable.
    event.preventDefault();
    container.focus();
    return;
  }
  event.preventDefault();
  items[next].focus();
}

// Capture phase, so a layer sees Escape before anything inside it does.
// Guarded because components whose logic is tested in Node import this
// module, and Node has no document to listen on.
if (typeof document !== "undefined") {
  document.addEventListener("keydown", onKeyDown, true);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export interface UseOverlayOptions {
  role?: LayerRole;
  /** False for a job in flight or a choice that must be deliberate. */
  dismissible?: boolean;
  /** Called when Escape or the backdrop asks this layer to close. */
  onClose: () => void;
  /**
   * Where focus should land on open. Defaults to the first focusable thing.
   * An alert passes its Cancel, so a stray Enter cannot delete a novel.
   */
  initialFocus?: () => HTMLElement | null;
  /**
   * Whether opening should move focus at all. False for a menu, which is opened
   * by a pointer as often as by a key: the trigger keeps focus, and the first
   * arrow press is what steps into the list. Focus still returns to the trigger
   * on close, because by then it may have been moved inside.
   */
  moveFocusIn?: boolean;
  /**
   * Siblings of the overlay to put out of reach while it is open. Anything not
   * listed stays reachable: the toast host is left out, because an undo must
   * remain clickable behind a sheet.
   */
  inertTargets?: () => HTMLElement[];
}

export interface Overlay {
  /** Put on the element focus should be trapped inside. */
  ref: (el: HTMLElement | null) => void;
  isTop: boolean;
  /** Call from the backdrop's click handler; it decides whether to close. */
  onBackdropClick: (event: {
    target: EventTarget | null;
    currentTarget: EventTarget | null;
  }) => void;
}

export function useOverlay(open: boolean, options: UseOverlayOptions): Overlay {
  const id = useId();
  const el = useRef<HTMLElement | null>(null);
  const opts = useRef(options);
  opts.current = options;

  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const node = el.current;
    if (!node) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    containers.set(id, node);
    closers.set(id, () => opts.current.onClose());
    setStack(
      push(stack, {
        id,
        role: opts.current.role ?? "dialog",
        dismissible: opts.current.dismissible ?? true,
      }),
    );

    const inert = opts.current.inertTargets?.() ?? [];
    for (const target of inert) holdInert(target);

    // Let the layer paint before reaching into it: an `initialFocus` that
    // names a control rendered this tick is not in the DOM until after this
    // effect.
    const focusTimer =
      opts.current.moveFocusIn === false
        ? 0
        : window.setTimeout(() => {
            const wanted =
              opts.current.initialFocus?.() ?? focusablesIn(node)[0] ?? node;
            if (
              !wanted.hasAttribute("tabindex") &&
              focusablesIn(node).length === 0
            ) {
              wanted.setAttribute("tabindex", "-1");
            }
            wanted.focus();
          }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      for (const target of inert) releaseInert(target);
      containers.delete(id);
      closers.delete(id);
      setStack(remove(stack, id));

      // Only if it is still there. A trigger inside a list that re-rendered
      // while the dialog was open is gone, and focusing it throws.
      const back = restoreTo.current;
      restoreTo.current = null;
      if (back && back.isConnected) back.focus();
      else document.body.focus();
    };
  }, [open, id]);

  // The flag follows the prop while the layer is open rather than being read
  // once at push, for the reason `setDismissible` gives.
  const dismissible = options.dismissible ?? true;
  useEffect(() => {
    if (!open) return;
    const next = setDismissible(stack, id, dismissible);
    if (next !== stack) setStack(next);
  }, [open, id, dismissible]);

  // The stack is module state shared by every layer, so a component cannot see
  // it change through its own props. Subscribing keeps `isTop` current rather
  // than frozen at the render that opened this layer.
  const onTop = useSyncExternalStore(
    subscribe,
    () => isTop(stack, id),
    () => false,
  );

  const ref = useCallback((node: HTMLElement | null) => {
    el.current = node;
  }, []);

  const onBackdropClick = useCallback(
    (event: {
      target: EventTarget | null;
      currentTarget: EventTarget | null;
    }) => {
      if (event.target !== event.currentTarget) return;
      if (!backdropCloses(stack, id)) return;
      opts.current.onClose();
    },
    [id],
  );

  return { ref, isTop: onTop, onBackdropClick };
}

/**
 * Test seam: the module-level stack is shared, and suites must not inherit it.
 *
 * Leaves the subscriber set alone: those belong to mounted components, and
 * dropping them would leave a live overlay unable to hear the stack change.
 */
export function __resetOverlays(): void {
  containers.clear();
  closers.clear();
  setStack([]);
}
