// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../ui";
import type { EditorEngine } from "../views/engine";
import { LineRatchet } from "../views/writing/ratchet";
import { matchesShortcut } from "../views/shortcuts";
import {
  markerPosition,
  measureRail,
  railGeometry,
  wheelSteps,
  type RailMeasure,
} from "./railMath";
import { railStamp, railStampFormatters } from "./railStamp";
import { usePhone } from "../useNarrow";

// ── The revision rail ────────────────────────────────────────────────────────
//
// The timeline's face: a hairline in the paper's left margin, oldest at the
// top and Now at the tip, with the wheel as the platen. It is drawn only when
// the writer asks for the walk (Ctrl+Shift+H).
//
// One wheel notch is one step: up walks older, down walks back toward Now,
// with the typewriter platen's accumulator (`railMath.ts`). The walk is a
// preview: the engine re-renders the merged doc (`walkHistory`), and the file
// on disk and the buffer never move. The chip at the foot holds the two
// actions: "Revert to here" applies the walked state as one undoable step,
// Cancel closes without changes. The walk only looks back; a wheel-down at
// Now does nothing.
//
// While open, the rail owns the wheel and the paper: capture-phase listeners
// take wheel, touch and pointer events before the editor's handlers, so the
// page never scrolls, the station never hears the writer take the page, and
// a click never positions the caret. Esc, touching the paper or Cancel closes
// without changes; typing commits, since the keystroke lands in the editor at
// any depth and ends the walk. ↑ walks older and ↓ toward Now, in capture, so
// focus stays in the paper and the caret never travels.

interface Props {
  engine: EditorEngine;
  /**
   * The open file. A switch closes the rail, whose timeline belongs to the
   * file that closed.
   */
  activeFile: string | null;
  /** The `.editor-shell`, which carries the `data-timeline` state attribute. */
  shellRef: React.RefObject<HTMLElement | null>;
  /**
   * The rail's state lives in the shell, because the bar's history button is a
   * sibling and must show the same state.
   */
  open: boolean;
  /** The toggle itself: the bar button and Ctrl+Shift+H land here. */
  onToggle: () => void;
  /**
   * Every exit that is not a toggle: Esc, the latch that closes under a
   * snapshot comparison, the file-switch and typing exits.
   */
  onClose: () => void;
}

export default function RevisionRail({
  engine,
  activeFile,
  shellRef,
  open,
  onToggle,
  onClose,
}: Props) {
  const { t, i18n } = useTranslation();
  // The walk's chrome is placed against the prose column on the desktop and
  // against the screen on a phone. Read with the other hooks, above the early
  // return.
  const phone = usePhone();
  const [measure, setMeasure] = useState<RailMeasure | null>(null);
  // The foot column's CSS-constructed height, seeding the first paint so it
  // does not flash: the 10px "Now" label with 4px padding ×2, the 7px gap, and
  // the 27px step pair (the row's in-flow height; the exits chip is absolutely
  // positioned off it). The measure corrects it once the foot is in the DOM;
  // fonts settle before a gesture can open the rail, so the seed is right on
  // the first paint.
  const [footH, setFootH] = useState(52);
  const [, setTick] = useState(0);
  const [announce, setAnnounce] = useState<string | null>(null);
  const ratchet = useRef(new LineRatchet());
  const footRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const lastFile = useRef(activeFile);
  // `t` is stable in production (react-i18next), but the tests mock it to a
  // fresh function per render. A callback closing over it would change
  // identity every render, and the measure effect depends on `cancel`, so it
  // would re-measure and re-render forever. Mirrored as in `EditorCore`: the
  // callback reads the ref and keeps a stable identity.
  const tRef = useRef(t);
  tRef.current = t;
  // The step-stamp formatters, built once per locale, since the rail
  // re-renders on every wheel notch.
  const stampFmt = useMemo(
    () => railStampFormatters(i18n.language),
    [i18n.language],
  );

  /**
   * Esc, paper touches and the chip's Cancel: close without changes. A walk
   * left at a depth announces its return; a close at Now is silent. The
   * announcement survives the close, because the live region renders while
   * the rail is shut.
   */
  const cancel = useCallback(() => {
    if (engine.historyWalkDepth > 0)
      setAnnounce(tRef.current("history.returnedToNow"));
    onClose();
  }, [engine, onClose]);

  /**
   * The chip's Revert: the walked state becomes one undoable step. The
   * engine exits the walk itself (the commit gate) and the rail closes after
   * it, so the mode and the button move together. The announcement rides the
   * same live region as the return, so a screen reader hears the revert.
   */
  const revert = useCallback(() => {
    engine.revertToHistory(tRef.current("history.revert"));
    setAnnounce(tRef.current("history.reverted"));
    onClose();
  }, [engine, onClose]);

  // The mode and the rail are one: the rail opens the history walk (the
  // merged diff against the newest state) and ends it when it closes. The
  // dock's snapshot comparison is mutually exclusive: while it is up the rail
  // closes, so its wheel never walks the timeline under the merged view.
  // `engine.inSnapshotDiff` is a dependency so a comparison entering or
  // leaving re-runs this latch, or a rail left open behind an exited
  // comparison would walk unguarded.
  useEffect(() => {
    if (engine.inSnapshotDiff) {
      onClose();
      return;
    }
    if (open) engine.enterHistoryDiff();
    else engine.exitHistoryDiff();
  }, [open, engine, engine.inSnapshotDiff, onClose]);

  // The step count, spoken once per opening (the effect runs on the
  // transition).
  useEffect(() => {
    if (open)
      setAnnounce(t("history.railSteps", { count: engine.undoDepth() }));
  }, [open, engine, t]);

  /**
   * One wheel notch or arrow press is one walk step in the engine's preview:
   * negative is older, positive toward Now. The engine clamps, never past Now
   * or the oldest step. Each step that lands announces the new depth.
   */
  const step = useCallback(
    (steps: number) => {
      const before = engine.historyWalkDepth;
      engine.walkHistory(steps);
      const depth = engine.historyWalkDepth;
      if (depth !== before && depth > 0)
        setAnnounce(tRef.current("history.stepsBack", { count: depth }));
    },
    [engine],
  );

  // ── State attribute and file switch ────────────────────────────────────────
  useEffect(() => {
    const shell = shellRef.current;
    if (shell) {
      if (open) shell.setAttribute("data-timeline", "1");
      else shell.removeAttribute("data-timeline");
    }
    return () => {
      shell?.removeAttribute("data-timeline");
    };
  }, [open, shellRef]);

  useEffect(() => {
    if (activeFile !== lastFile.current) {
      lastFile.current = activeFile;
      onClose();
    }
  }, [activeFile, onClose]);

  // ── The keyboard ───────────────────────────────────────────────────────────
  //
  // Toggle, Esc, the arrows and the typing exit.
  useEffect(() => {
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (!openRef.current) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const target = e.target;
        // The walk's arrows belong to the paper's contenteditable. An arrow in
        // any other field (the tree's search, a rename input) moves that
        // field's caret, and swallowing it would freeze the caret there.
        // A target that is not an element (the window itself)
        // counts as the paper, and walks.
        if (target instanceof Element && !target.closest(".editor")) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        step(e.key === "ArrowUp" ? -1 : 1);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut("rail", e)) {
        e.preventDefault();
        onToggle();
        return;
      }
      if (!openRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        return;
      }
      // A printable keystroke with no modifiers is typing: the rail only lets
      // go, since the editor's handler commits it and the engine's gate ends
      // the walk. Shortcuts (Ctrl+Z, Ctrl+S, the mod+digit inserts) stay
      // live; the engine refuses Ctrl+Z while the rail is up.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDownCapture, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, {
        capture: true,
      });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cancel, onClose, engine, t, onToggle, step]);

  // The stable measure: re-read the shell, the surface and the editor, and
  // record the foot's real height once it is in the DOM, correcting the seed.
  // It reads refs, not state, so its identity is stable and the open effect
  // and the history-tick effect share it.
  const measureNow = useCallback(() => {
    const shell = shellRef.current;
    const surface = shell?.querySelector(".editor-surface");
    const editor = shell?.querySelector(".editor");
    if (
      shell &&
      surface instanceof HTMLElement &&
      editor instanceof HTMLElement
    ) {
      const style = getComputedStyle(surface);
      const length = (name: string) =>
        parseFloat(style.getPropertyValue(name)) || 0;
      setMeasure(
        measureRail(shell, surface, editor, {
          top: length("--rail-inset-top"),
          bottom: length("--rail-inset-bottom"),
        }),
      );
      const h = footRef.current?.offsetHeight;
      if (h && h > 0) setFootH(h);
    }
  }, [shellRef]);

  // The foot's ref and the seed's correction: the callback fires when the
  // foot mounts, in the commit phase before paint, so the first paint already
  // has the browser's height and never jumps a frame later.
  const footSeat = useCallback((node: HTMLDivElement | null) => {
    footRef.current = node;
    if (node && node.offsetHeight > 0) setFootH(node.offsetHeight);
  }, []);

  // ── The wheel and the paper ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const surface = shellRef.current?.querySelector(".editor-surface");
    if (!(surface instanceof HTMLElement)) return;
    // The ratchet is a stable ref; the copy is for the cleanup's closure, so
    // the lint rule can see the reset never races a re-render.
    const ratchetRef = ratchet.current;

    measureNow();
    surface.addEventListener("scroll", measureNow, { passive: true });
    window.addEventListener("resize", measureNow);
    // The measure slides on `translate` when the rail opens and the margin's
    // notes are put away, so the open read lands mid-slide; the rail and its
    // foot are read again where the measure comes to rest.
    const onSettle = (e: TransitionEvent) => {
      if (
        e.target instanceof Element &&
        e.target.matches(".editor, .editor-surface")
      )
        measureNow();
    };
    surface.addEventListener("transitionend", onSettle);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      step(wheelSteps(ratchetRef, e.deltaY, e.deltaMode));
    };
    // A touch drag feeds the same accumulator with the travel between
    // touches, so it steps once per line of drag.
    const lastTouchY: { current: number | null } = { current: null };
    const onTouch = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (lastTouchY.current === null) lastTouchY.current = touch.clientY;
      const delta = lastTouchY.current - touch.clientY;
      lastTouchY.current = touch.clientY;
      if (delta === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      step(wheelSteps(ratchetRef, delta, 0));
    };
    const resetTouch = () => {
      lastTouchY.current = null;
    };
    const onPointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
    };
    surface.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    surface.addEventListener("touchmove", onTouch, {
      capture: true,
      passive: false,
    });
    surface.addEventListener("touchstart", resetTouch, { capture: true });
    surface.addEventListener("touchend", resetTouch, { capture: true });
    surface.addEventListener("touchcancel", resetTouch, { capture: true });
    surface.addEventListener("pointerdown", onPointerDown, {
      capture: true,
    });
    return () => {
      surface.removeEventListener("scroll", measureNow);
      window.removeEventListener("resize", measureNow);
      surface.removeEventListener("transitionend", onSettle);
      surface.removeEventListener("wheel", onWheel, { capture: true });
      surface.removeEventListener("touchmove", onTouch, { capture: true });
      surface.removeEventListener("touchstart", resetTouch, { capture: true });
      surface.removeEventListener("touchend", resetTouch, { capture: true });
      surface.removeEventListener("touchcancel", resetTouch, { capture: true });
      surface.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      ratchetRef.reset();
    };
  }, [open, shellRef, step, cancel, measureNow]);

  // ── Live markers ───────────────────────────────────────────────────────────
  //
  // The engine's history event re-reads depth and labels. A "doc" event (the
  // diff modes' notification) bumps the same tick, so a comparison entering
  // or leaving straight from the engine re-renders the rail and the
  // exclusivity latch re-runs. The same tick re-measures, so the foot is
  // measured, never assumed, even if its height changes mid-walk.
  //
  // Closed, the rail draws only its live region, so it re-renders only when a
  // comparison enters or leaves, and never measures inside the input handler
  // on every keystroke.
  useEffect(() => {
    let comparing = engine.inSnapshotDiff;
    return engine.subscribe((reason) => {
      if (reason !== "history" && reason !== "doc") return;
      if (!open) {
        if (engine.inSnapshotDiff === comparing) return;
        comparing = engine.inSnapshotDiff;
        setTick((n) => n + 1);
        return;
      }
      setTick((n) => n + 1);
      measureNow();
    });
  }, [engine, measureNow, open]);

  // The rail paints nothing until the first measure lands, or it would flash
  // at the shell's top-left and then jump. The live region stays mounted
  // either way: a walk's exit announcement lands in the same render as the
  // close, and a region unmounted with the rail would never voice it.
  if (!open || measure === null) {
    return (
      <span className="rev-live" role="status" aria-live="polite">
        {announce ?? ""}
      </span>
    );
  }

  const undoDepth = engine.undoDepth();
  const walkDepth = engine.historyWalkDepth;
  // The walked step's stamp: only off Now, where the foot's "Now" label says
  // it, and only when the store carried one, so a journal without timestamps
  // shows no label and never breaks the walk.
  const stamp =
    walkDepth > 0 && engine.historyWalkTimestamp !== null
      ? railStamp(stampFmt, engine.historyWalkTimestamp)
      : null;
  const markerRatio = markerPosition(walkDepth, undoDepth);
  // The parked-sibling fork tick marks where the parked future reconnects:
  // the head's parent, one step back from Now on the marker's scale (root at
  // the top, Now at the bottom). It is `markerPosition(1, undoDepth)`, so the
  // fork and the marker agree on where depth 1 is.
  const forkRatio = undoDepth > 0 ? markerPosition(1, undoDepth) : null;
  const hasFork = forkRatio !== null && engine.hasParkedSiblings;
  const undoLabel = engine.nextUndoLabel();
  const undoTitle = undoLabel
    ? t("history.undoTooltip", { label: undoLabel })
    : t("history.undoDefault");
  // The foot band: the rail ends 7px above the chrome and the chip
  // rests 7px above the surface's bottom edge, so the at-Now marker and the
  // chip never share an axis segment and the walk spans the whole rail.
  // `footH` is the measured column height ("Now" label and chip, seeded for
  // the first paint); `railGeometry` settles the span and the foot's seat as
  // pure arithmetic.
  const { railHeight, footTop } = railGeometry(measure, footH);
  const markerPx = railHeight * markerRatio;
  const forkPx = forkRatio !== null ? railHeight * forkRatio : 0;
  const left = measure.left;
  const top = measure.top;

  return (
    <>
      <div className="rev-rail" style={{ left, top, height: railHeight }}>
        {/* Decorative: the hairline path. The state is carried by the dimmed
            paper, the hollow caret and the chip, never by the line alone
            (WCAG 1.4.1). */}
        <div className="rev-rail-path" aria-hidden="true" />
        <div
          className={
            walkDepth > 0
              ? "rev-rail-head rev-rail-head-walking"
              : "rev-rail-head"
          }
          style={{ top: markerPx }}
          title={undoTitle}
        />
        {hasFork && (
          <div
            className="rev-rail-fork"
            style={{ top: forkPx }}
            title={t("history.parkedTooltip")}
          />
        )}
        {stamp !== null && (
          <div
            className="rev-rail-time"
            style={{ top: markerPx }}
            aria-hidden="true"
          >
            {stamp}
          </div>
        )}
      </div>
      {/* The rail foot: "Now" at the tip with the chip under it, chrome
          floating over the paper on the plane of the bar and the panels.
          Cancel is always there; Revert joins it when the walk leaves Now,
          since there is nothing to revert at Now. */}
      {/* The foot centres on the rail line, which on the desktop stands in
          the paper's left margin. The phone has no margin: the rail lands at
          x≈0, and a cluster centred on it would hang half off the screen.
          There it centres on the screen. Omitting the inline
          `left` lets the stylesheet do so without `!important`. */}
      <div
        className="rev-foot"
        ref={footSeat}
        style={{ left: phone ? undefined : left, top: footTop }}
      >
        <span className="rev-now">{t("history.now")}</span>
        <div className="rev-row">
          {/* The step pair, two buttons on the left, apart from the exits
              chip: ↑ older, ↓ toward Now, through the same `step` as the
              wheel and the arrows, so the announcement and the engine's
              clamp apply. Disabled at the walk's bounds. Each button has its
              own accessible name. */}
          <span className="rev-steps">
            <button
              className="rev-step rev-step-up"
              onClick={() => step(-1)}
              disabled={walkDepth >= undoDepth}
              aria-label={t("history.stepOlder")}
            >
              <Icon name="chevron" size={12} />
            </button>
            <button
              className="rev-step"
              onClick={() => step(1)}
              disabled={walkDepth === 0}
              aria-label={t("history.stepTowardNow")}
            >
              <Icon name="chevron" size={12} />
            </button>
          </span>
          {/* The exits chip floats to the pair's right, its left edge pinned
              to it, so when Revert joins, the chip grows rightward and the
              step pair never moves. */}
          <div className="rev-chip" role="group">
            <button
              className="rev-chip-cancel"
              onClick={cancel}
              aria-label={t("confirm.cancel")}
            >
              {t("confirm.cancel")}
            </button>
            {walkDepth > 0 && (
              <button
                className="rev-chip-revert"
                onClick={revert}
                aria-label={t("history.revert")}
              >
                {t("history.revert")}
              </button>
            )}
          </div>
        </div>
      </div>
      <span className="rev-live" role="status" aria-live="polite">
        {announce ?? ""}
      </span>
    </>
  );
}
