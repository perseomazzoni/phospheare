// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDismissOnPointerAway } from "../ui/overlay/useDismissOnPointerAway";

// ── The fold behaviour ───────────────────────────────────────────────────────
//
// The command bar's folds share one behaviour. A declared control opens when
// the pointer reaches it or a keyboard focuses it, and stays open while the
// pointer is anywhere in the bar; everything collapses on bar exit. A control
// declares itself with a `data-fold` name, and the hook drives its
// `data-open`, always written so the stylesheet keys off it directly.
//
// ── The tap on touch screens ─────────────────────────────────────────────────
//
// Hover-opening works on a desk because every control in the bar is also a
// shortcut. On a tablet the folds are `pointer-events: none` until
// `:focus-within` or `data-open`, and the fallback is a modifier a soft
// keyboard cannot produce. A tap fires `pointerover`, which opens the fold,
// and the lifting finger fires `pointerleave`, which shuts it, so hover alone
// makes the fold flash.
//
// The tap is a third source of open, held in its own single-valued state:
//
//   · A mouse never takes the tap path: the guard is `pointerType`, the
//     gesture made, not a media query, so a touch laptop used with a mouse
//     behaves like a mouse.
//   · One fold at a time: a single value cannot hold two. Hovering two folds
//     on a desk still opens both; that is the latch.
//   · It survives `shut()`, so it is not a member of `hovered`: the lifting
//     finger is a `pointerleave`, and a fold that closes as the finger that
//     opened it lifts has not opened.
//
// The first tap on a folded control opens it rather than acting, because the
// fold's resting face is the current answer.
//
// The bar's engagement, the pointer in the bar or one of its controls
// focused, is tracked apart from any fold and drives the z-index lift
// (`engaged`).

/** The hover-intent delays: a fold opens 80ms after the pointer reaches it,
 *  and the bar shuts 200ms after the pointer leaves, so fast travel across
 *  the bar opens and closes nothing. */
export const FOLD_INTENT_OPEN_MS = 80;
export const FOLD_INTENT_CLOSE_MS = 200;

/**
 * The bar's engagement state machine.
 *
 * The bar is engaged while the pointer is inside it or any of its controls
 * holds focus, so keyboard users keep the folds open as long as mouse users
 * do. `hovered` only grows during an engagement (the latch: a set that only
 * grows until the bar exit empties it), so no control flickers when the
 * pointer crosses the gap between two.
 *
 * A bar subpanel (find, the character keys, anything below the bar declaring
 * `data-bar-panel`) holds the bar's state while it is open: the open folds
 * stay open and the bar stays lifted, so bar and panels read as one unit. It
 * opens nothing itself, so a panel never inflates the bar, and the writer can
 * still reach a fold while the panel is up.
 */
export function useFoldBehaviour(
  /** Per-fold hover delays, in ms, for folds that do not open on the shared
   *  80ms intent, such as the autosave reveal (`AUTOSAVE_REVEAL_MS` in
   *  `EditorBar`). Keyboard focus is never delayed: a tabber has already said
   *  which control they want. */
  delays: Readonly<Record<string, number>> = {},
) {
  const barRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<ReadonlySet<string>>(new Set());
  const [heldOpen, setHeldOpen] = useState(false);
  /** The fold a finger opened, if any. One value: one fold at a time. */
  const [tapped, setTapped] = useState<string | null>(null);
  /**
   * The pointer that made the last press. A `click` is not guaranteed to be a
   * `PointerEvent` across engines, so `pointerdown`, which always arrives
   * first and always says, records it.
   */
  const lastPointer = useRef<string>("mouse");

  // The two sources of engagement, as refs: each event only asks whether the
  // other source is still engaged, and the render reads `active`.
  const pointerIn = useRef(false);
  const focusIn = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // A press outside the bar closes a tapped fold, the exit a desk gets from
  // `pointerleave`. The shared hook acts on `pointerdown`, so the fold is gone
  // before whatever is underneath reacts; registers a frame late, so it cannot
  // hear the tap that opened it; and listens in capture, so nothing between
  // the target and the document can swallow the press.
  //
  // The press closes a hover as well, and any hover still on its way. A touch
  // screen's emulated mouse stays where the finger lifted, so the row the tap
  // opened grows under it and reports a mouse `pointerover`: its open, landing
  // after the press, would bring the fold back, and that mouse never moves
  // again to take it away.
  const closeTapped = useCallback(() => {
    openTimers.current.forEach((t) => clearTimeout(t));
    openTimers.current.clear();
    setHovered(new Set());
    setTapped(null);
  }, []);
  useDismissOnPointerAway(tapped !== null, [barRef.current], closeTapped);
  // `EditorBar` passes `delays` as an inline literal whose identity changes
  // every render. A ref keeps the listeners subscribed once while honouring
  // the latest delays; depending on the param would resubscribe every render.
  const delaysRef = useRef(delays);
  delaysRef.current = delays;
  // `tapped` is state because the render needs it, and a ref because the
  // listeners subscribe once.
  const tappedRef = useRef(tapped);
  tappedRef.current = tapped;

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    // A panel that held the bar open closed while the pointer was out. Nothing
    // else fires to shut the bar, so it shuts as the effect comes up.
    if (!heldOpen && !pointerIn.current && !focusIn.current) {
      pointerIn.current = false;
      focusIn.current = false;
      setActive(false);
      setHovered(new Set());
      setFocused(new Set());
    }

    // ── The bar's subpanels ──────────────────────────────────────────────────
    // Anything in the bar-stack that declares `data-bar-panel` and is open
    // (`data-open="1"`) holds the bar. Watched as an attribute, so a new
    // panel needs nothing but the declaration.
    const stack = bar.closest(".bar-stack");
    const refreshHeld = () => {
      const next = stack
        ? stack.querySelector('[data-bar-panel][data-open="1"]') !== null
        : false;
      if (next !== heldOpen) setHeldOpen(next);
    };
    let mo: MutationObserver | null = null;
    if (stack && typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(refreshHeld);
      // `subtree`: the panels' `data-open` lives on the drops, descendants of
      // the stack; without it only the stack's own attributes are watched.
      mo.observe(stack, {
        attributes: true,
        attributeFilter: ["data-open"],
        subtree: true,
      });
    }
    refreshHeld();

    const clearClose = () => {
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
    const clearOpenTimers = () => {
      openTimers.current.forEach((t) => clearTimeout(t));
      openTimers.current.clear();
    };
    const shut = () => {
      // An open panel holds the bar; nothing shuts it while the panel is up.
      if (heldOpen) return;
      clearOpenTimers();
      pointerIn.current = false;
      focusIn.current = false;
      setActive(false);
      setHovered(new Set());
      setFocused(new Set());
    };
    const scheduleShut = () => {
      clearClose();
      if (heldOpen) return;
      closeTimer.current = setTimeout(shut, FOLD_INTENT_CLOSE_MS);
    };

    const closestFold = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const el = target.closest("[data-fold]");
      return el?.getAttribute("data-fold") || null;
    };
    const addHover = (name: string) => {
      setHovered((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    };
    const addFocus = (name: string) => {
      setFocused((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    };
    const dropFocus = (name: string) => {
      setFocused((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    };

    const onPointerEnter = () => {
      clearClose();
      pointerIn.current = true;
      setActive(true);
    };
    const onPointerLeave = () => {
      pointerIn.current = false;
      // Focus keeps the bar engaged: a keyboard user who tabbed into the bar
      // must not have it collapse because the pointer left.
      if (focusIn.current) return;
      scheduleShut();
    };
    const onPointerOver = (e: PointerEvent) => {
      const name = closestFold(e.target);
      if (!name) return;
      // Re-reaching the same fold restarts its open timer, so a fold only
      // opens when the pointer has rested on it.
      const existing = openTimers.current.get(name);
      if (existing !== undefined) clearTimeout(existing);
      openTimers.current.set(
        name,
        setTimeout(
          () => addHover(name),
          delaysRef.current[name] ?? FOLD_INTENT_OPEN_MS,
        ),
      );
    };
    const onPointerOut = (e: PointerEvent) => {
      // Leaving a fold mid-intent cancels its open, but not when the pointer
      // crosses from one cell of the same fold to another.
      const leaving = closestFold(e.target);
      const next = closestFold(e.relatedTarget);
      if (!leaving || leaving === next) return;
      const existing = openTimers.current.get(leaving);
      if (existing !== undefined) {
        clearTimeout(existing);
        openTimers.current.delete(leaving);
      }
    };
    // ── The tap ──────────────────────────────────────────────────────────────
    //
    // On `click`, not `pointerdown`: the bar scrolls sideways on a narrow
    // window, and a fold must not open at the start of every scroll. A click
    // does not survive a finger that moved.
    const notePointer = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
    };
    const onClick = (e: MouseEvent) => {
      // A mouse never takes the tap path.
      if (lastPointer.current === "mouse") return;
      const name = closestFold(e.target);
      if (name === null) {
        // Elsewhere in the bar (Bold, Save, the palette): their own handlers
        // run, and the open fold closes.
        setTapped(null);
        return;
      }
      // Any tap inside the open fold closes it. A press on a cell chose a
      // face, which the cell's own button applies, and the fold gets out of
      // the way like an answered menu; a press on the fold's own box is a
      // second tap on the control. A folded row is `pointer-events: none`, so
      // a press cannot reach a cell before the row is open.
      if (tappedRef.current === name) {
        setTapped(null);
        return;
      }
      // A different fold, or the first. `hovered` is cleared with it: a tap
      // fires `pointerover` too, so otherwise the fold just left stays open on
      // hover until `shut()` runs, and one fold at a time holds only
      // eventually.
      setHovered(new Set());
      setTapped(name);
    };
    // Escape spends itself on the fold and goes no further, so one press
    // never closes two layers. It acts only while a fold is
    // tap-open, so on a desk it does nothing.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || tappedRef.current === null) return;
      e.stopPropagation();
      setTapped(null);
    };

    const onFocusIn = (e: FocusEvent) => {
      clearClose();
      focusIn.current = true;
      setActive(true);
      const name = closestFold(e.target);
      if (name) addFocus(name);
    };
    const onFocusOut = (e: FocusEvent) => {
      const leaving = closestFold(e.target);
      const next = closestFold(e.relatedTarget);
      if (leaving && leaving !== next) dropFocus(leaving);
      if (bar.contains(e.relatedTarget as Node | null)) return;
      focusIn.current = false;
      if (pointerIn.current) return;
      scheduleShut();
    };

    bar.addEventListener("pointerdown", notePointer);
    bar.addEventListener("click", onClick);
    bar.addEventListener("keydown", onKeyDown);
    bar.addEventListener("pointerenter", onPointerEnter);
    bar.addEventListener("pointerleave", onPointerLeave);
    bar.addEventListener("pointerover", onPointerOver);
    bar.addEventListener("pointerout", onPointerOut);
    bar.addEventListener("focusin", onFocusIn);
    bar.addEventListener("focusout", onFocusOut);
    return () => {
      mo?.disconnect();
      bar.removeEventListener("pointerdown", notePointer);
      bar.removeEventListener("click", onClick);
      bar.removeEventListener("keydown", onKeyDown);
      bar.removeEventListener("pointerenter", onPointerEnter);
      bar.removeEventListener("pointerleave", onPointerLeave);
      bar.removeEventListener("pointerover", onPointerOver);
      bar.removeEventListener("pointerout", onPointerOut);
      bar.removeEventListener("focusin", onFocusIn);
      bar.removeEventListener("focusout", onFocusOut);
      clearClose();
      clearOpenTimers();
    };
  }, [heldOpen]);

  /** Whether a declared control is open: by a reach, a focus or a tap, never
   *  by a subpanel. */
  const open = (name: string) =>
    hovered.has(name) || focused.has(name) || tapped === name;
  return {
    barRef,
    open,
    /** The pointer is inside the bar, one of its controls is focused, one of
     *  its subpanels is open, or a fold is tap-open. Drives the z-index lift:
     *  the bar and its panels lie over the dock the moment a writer reaches
     *  for them, before anything expands. */
    engaged: active || heldOpen || tapped !== null,
  };
}
