// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { matchesShortcut } from "../views/shortcuts";
import { holdCaretLine } from "./caretAnchor";
import {
  HENOSIS_OFF,
  deadlineOf,
  step,
  type HenosisEvent,
  type HenosisState,
} from "./domain/flow";

// Henosis mode, the writer's opt-in: after Y seconds of writing, everything
// around the page fades out over X seconds, and once it has gone the prose
// widens into the room it left. The rules are the pure flow's
// (`domain/flow.ts`); this hook listens for what feeds it, keeps one timer for
// its next deadline, and publishes its state on the editor shell as
// `data-henosis`, which `editor.css` answers under every theme.
//
// What brings the room back:
//
//   · the hand: a pointer moved more than a few pixels. Not the first event
//     after typing, which a trackpad can send with no one touching it, and
//     not a wheel, which is reading;
//   · Escape, the key that means "out";
//   · focus leaving the prose for a control in the shell, or a dialog;
//   · a pause longer than P, a stop rather than a breath.
//
// A shortcut does not wake it. A chord pressed in the prose (the guillemet
// and dash inserts, bold, undo) is writing and keeps the burst going like a
// keystroke. Save is the one chord that is not writing: it neither extends
// the burst nor ends it, so a save never carries the writer into the fade.
// What a shortcut opens is still answered: find, the palette, the shortcut
// sheet, a comparison and the history walk are stand-downs, and anything that
// takes focus wakes it.
//
// The attribute is written to the DOM, never through React state: it changes
// during a burst of writing, and a state change in `EditorRoute` would redraw
// the whole editor under the writer's fingers to flip one attribute.
//
// The attribute's values:
//   absent     nothing to show: never written, or settled after a return
//   warming    writing, not yet for Y; nothing is dimmed (a hook for tests)
//   fading     the chrome fading out over `--henosis-fade`
//   full       the chrome gone (hidden, out of the Tab order), the prose wide
//   "0"        on the way back: the chrome fading in from wherever it had got
//              to (`--henosis-from`), and the prose narrowing; cleared once
//              that is over, so a later dock or panel move eases at its own
//              speed rather than Henosis's
//
// A return from `warming` goes straight to absent: nothing had dimmed, and a
// wake animation would flash chrome that never left.

/** How far the pointer travels before it counts as a hand on the mouse. */
const MOVE_PX = 6;

/**
 * How long the prose takes to widen or narrow, in ms. Must match `--t-slow`
 * in `base.css`, which the stylesheet's rule uses, because the caret's line
 * is held for as long as the column moves.
 */
const WIDTH_MS = 420;

/** How long `"0"` stays before the attribute is cleared: past the wake's fade
 * and the narrowing, with a frame to spare. */
const SETTLE_MS = WIDTH_MS + 100;

const PROSE = ".editor";

/** A modifier pressed alone, before the chord it belongs to. */
const MODIFIERS = new Set(["Control", "Meta", "Alt", "Shift", "AltGraph"]);

export interface HenosisOptions {
  /** The writer's switch; off, nothing listens and nothing is written. */
  enabled: boolean;
  /** Y, in seconds: writing this long starts the fade. */
  afterS: number;
  /** X, in seconds: how long the fade takes. */
  fadeS: number;
  /** P, in seconds: a pause in the writing this long ends the mode. */
  pauseS: number;
  /**
   * Something is open that Henosis must not hide: find, a sheet, the
   * palette, a running answer, a comparison. It never begins while this is
   * true, and ends the moment it becomes true.
   */
  standDown: boolean;
  /** Hold the caret's line while the column changes width (the scroll view). */
  holdCaret: boolean;
  /** What a screen reader hears when the room goes, and when it comes back. */
  said: { full: string; back: string };
}

export function useHenosis(
  shell: RefObject<HTMLElement | null>,
  options: HenosisOptions,
): void {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const send = useRef<((event: HenosisEvent) => void) | null>(null);
  const { enabled, afterS, fadeS, pauseS, standDown } = options;

  useEffect(() => {
    const el = shell.current;
    if (!el || !enabled) return;
    const timing = {
      afterMs: afterS * 1000,
      fadeMs: fadeS * 1000,
      pauseMs: pauseS * 1000,
    };
    el.style.setProperty("--henosis-fade", `${timing.fadeMs}ms`);
    let flow = HENOSIS_OFF;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let release = () => {};
    // Where the pointer was first seen since the writing began; movement is
    // measured from there rather than from wherever it was before typing.
    let origin: { x: number; y: number } | null = null;

    const draw = (from: HenosisState, to: HenosisState) => {
      if (from === to) return;
      clearTimeout(settle);
      if (to !== "off") {
        el.setAttribute("data-henosis", to);
      } else if (from === "warming") {
        el.removeAttribute("data-henosis");
      } else {
        // The way back starts from wherever the fade had got to, with one
        // style read per return, so a writer who stops half-way through the
        // fade sees the chrome rise from there rather than blink out first.
        const chrome = el.querySelector(".chrome");
        el.style.setProperty(
          "--henosis-from",
          chrome ? getComputedStyle(chrome).opacity : "0",
        );
        el.setAttribute("data-henosis", "0");
        settle = setTimeout(
          () => el.removeAttribute("data-henosis"),
          SETTLE_MS,
        );
      }
      if (to !== "full" && from !== "full") return;
      // The column changes width on the way into full and on the way out.
      release();
      const surface = el.querySelector<HTMLElement>(".editor-surface");
      release =
        latest.current.holdCaret && surface
          ? holdCaretLine(surface, WIDTH_MS)
          : () => {};
      const region = el.querySelector("[data-henosis-live]");
      if (region)
        region.textContent =
          to === "full" ? latest.current.said.full : latest.current.said.back;
    };

    const go = (event: HenosisEvent) => {
      const from = flow.state;
      flow = step(flow, event, performance.now(), timing);
      draw(from, flow.state);
      if (flow.state === "off") origin = null;
      // One timer, always re-armed: a deadline that fires a moment early
      // changes nothing, and must still leave a timer behind it.
      clearTimeout(timer);
      const due = deadlineOf(flow, timing);
      if (due !== null)
        timer = setTimeout(
          () => go("deadline"),
          Math.max(0, due - performance.now()),
        );
    };
    send.current = go;

    const inProse = (target: EventTarget | null) =>
      target instanceof Element && target.closest(PROSE) !== null;

    // `beforeinput`, not `input`: the engine takes the edit itself and
    // cancels the browser's, and a cancelled `beforeinput` fires no `input`.
    const onBeforeInput = (e: Event) => {
      if (!inProse(e.target) || latest.current.standDown) return;
      go("type");
    };
    const onPointerMove = (e: PointerEvent) => {
      if (flow.state === "off") return;
      if (!origin) {
        origin = { x: e.clientX, y: e.clientY };
        return;
      }
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > MOVE_PX)
        go("wake");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (flow.state === "off") return;
      if (e.key === "Escape") return go("wake");
      // A chord in the prose is part of the writing; the modifier pressed on
      // its own is not a keystroke yet, and save is not writing.
      if (
        (e.ctrlKey || e.metaKey || e.altKey) &&
        !MODIFIERS.has(e.key) &&
        !matchesShortcut("save", e) &&
        inProse(e.target)
      )
        go("type");
    };
    const onFocusIn = (e: FocusEvent) => {
      if (flow.state !== "off" && !inProse(e.target)) go("wake");
    };

    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("focusin", onFocusIn);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      send.current = null;
      clearTimeout(timer);
      clearTimeout(settle);
      release();
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown, true);
      el.removeAttribute("data-henosis");
      el.style.removeProperty("--henosis-fade");
      el.style.removeProperty("--henosis-from");
    };
  }, [shell, enabled, afterS, fadeS, pauseS]);

  // A stand-down ends the mode the moment it arrives; while it lasts, the
  // keystroke listener above declines to start it again.
  useEffect(() => {
    if (standDown) send.current?.("standDown");
  }, [standDown]);
}
