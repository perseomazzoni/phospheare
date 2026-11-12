// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The shared writing core ──────────────────────────────────────────────────
//
// `EditorCore` is the half every writing view shares: rendering, input
// routing, marks, the fake caret and the focus dim. The shell picks the named
// view, one adapter per name (`registry.ts`).
//
// The one knob between the two halves is the `Scroller`
// (`scrollStrategy.ts`): where the writing line is held. Do not add a
// `typewriter` boolean here: the typewriter is a strategy, not a mode flag
// every branch of the shared component must remember to check.
//
// The `guide` (the typewriter's chevrons) is written from the rAF measure
// loop that moves the fake caret, so its ref is passed in; no guide, no guide
// work.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { dispatchShortcutKey } from "../shortcutDispatch";
import { syncSelectionFromDom } from "../selectionSync";
import { dispatchBeforeInput } from "../beforeInputDispatch";
import { dispatchCopy, dispatchCut, dispatchPaste } from "../clipboardDispatch";
import { patchChanged, patchDocument } from "./patchDocument";
import {
  getParagraphs,
  saveDomSelection,
  restoreDomSelection,
  calculateFlatPosition,
  domPointToLogical,
  logicalToDomPoint,
} from "../writing/dom";
import { applyDiffMarks, paintHighlights } from "../writing/highlights";
import { measuringCaret, getFakeCursorRect } from "../writing/caret";
import {
  station,
  stationY,
  withKeyboard,
  DESKTOP_CHROME,
  PHONE_CHROME,
} from "../writing/station";
import { deltaToPixels, LineRatchet } from "../writing/ratchet";
import {
  cancelScrollGlide,
  glideScrollTo,
  motionIsStill,
  SCROLL_GLIDE_MS,
} from "../writing/scrollGlide";
import { paintStationProbe } from "../writing/stationProbe";
import { useChromeInset } from "../writing/useChromeInset";
import {
  lineAt,
  paragraphAt,
  type TextUnit,
  type TopOf,
} from "../writing/focusUnit";
import TypeGuide from "./TypeGuide";
import DiffAcceptLayer from "./DiffAcceptLayer";
import { revealCaretDelta, type Scroller } from "./scrollStrategy";
import type { WritingViewHandle, WritingViewProps } from "./port";

// ── Focus painting: the Custom Highlight API ─────────────────────────────────
//
// One persistent Highlight, cleared and re-added on every caret move, never a
// `<span>` wrapped around prose, which would hand the DOM patcher a rebuild
// on every keystroke and every arrow key. Painting is a style invalidation
// and nothing else.
//
// TypeScript's DOM lib models `Highlight` and `HighlightRegistry` with only
// `forEach`, without the Set-like `add`, `delete` and `clear` and the
// Map-like `set` that browsers implement. These two local shapes fill only
// what the ambient types are missing.
interface LiveHighlight {
  add(range: AbstractRange): void;
  delete(range: AbstractRange): void;
  clear(): void;
}
interface LiveHighlightRegistry {
  set(name: string, highlight: LiveHighlight): void;
}

const supportsHighlight =
  typeof Highlight !== "undefined" &&
  typeof CSS !== "undefined" &&
  "highlights" in CSS;

/**
 * The type guide, as the core needs it: only its ref. The guide carries no
 * callbacks across the boundary; typing brings the writer back to the line.
 */
export interface EditorGuide {
  el: React.RefObject<HTMLDivElement | null>;
}

export interface EditorCoreProps extends WritingViewProps {
  /** Where the writing line is held: the one difference between views. */
  scroller: Scroller;
  /**
   * Dock the caret on mount. Only the typewriter adapter sets it: a project
   * opened with the preference already on has no toggle to watch, but its
   * caret must still arrive at the station. The scroll view does not settle
   * on mount, so opening a project does not jump.
   */
  settleOnMount?: boolean;
  /** The typewriter's station drawn; absent for every other view. */
  guide?: EditorGuide;
}

// How long the caret's typing spring stays armed after a character lands:
// the `--t-bounce` spring is 200ms, and a little slack keeps a second
// keystroke from being treated as a non-typing reposition mid-bounce.
const CARET_BOUNCE_MS = 260;

/**
 * Whether an element wants focus for its own text: find, rename, the AI
 * composer. The editor re-claims focus from everything else, but never from
 * a field the writer is typing into.
 */
function isTextEntry(el: HTMLElement): boolean {
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.closest("[contenteditable]") !== null
  );
}

/**
 * The shared half. The `.editor-surface` that hosts it belongs to the
 * adapter, so every surface access here goes through
 * `editorRef.current.parentElement`, never a prop.
 */
export const EditorCore = forwardRef<WritingViewHandle, EditorCoreProps>(
  function EditorCore(
    {
      engine,
      host,
      scroller,
      settleOnMount,
      guide,
      focus,
      smoothCaret,
      search,
      selection,
      searchOpen,
      onClearHighlights,
      gutter,
    },
    handle,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    // Stable across renders: `useChromeInset` keys its observer on this, and
    // a fresh closure every render would tear the observer down and rebuild
    // it on every keystroke.
    const surfaceOf = useCallback(
      () => editorRef.current?.parentElement ?? null,
      [],
    );
    const caretDiv = useRef<HTMLDivElement>(null);
    const caretBounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Owned by the instance and cleared on unmount: shared timers would race
    // under StrictMode's double-mounting, or with two editors mounted.
    const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const strikeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(
      () => () => {
        if (caretBounceTimer.current) clearTimeout(caretBounceTimer.current);
        if (blinkTimer.current) clearTimeout(blinkTimer.current);
        if (strikeTimer.current) clearTimeout(strikeTimer.current);
        cancelScrollGlide();
      },
      [],
    );
    // The gutter is a render prop that gets the real editor and surface after
    // commit; a post-mount flip re-renders so its first paint never sees
    // nulls.
    const [, setMounted] = useState(false);
    useEffect(() => {
      setMounted(true);
    }, []);
    // The station's chrome follows the plane, which can change under a
    // mounted editor: a rotation, a desktop window dragged narrow.
    const { phone, setHtml, guideMark } = host;
    // The soft keyboard is the rest of the chrome, on both planes: a tablet at
    // 900px gets one too, and its chrome is the desk's plus the keys.
    const keyboard = host.keyboardInset;
    // The chrome is measured (`useChromeInset`); the two per-plane constants
    // are the fallback for the frames before there is a surface to measure.
    // On a touch tablet the desk's declared 86 is really 104, which puts the
    // station 9px high.
    const measured = useChromeInset(surfaceOf);
    const measuredBefore = useRef(measured);
    useEffect(() => {
      station.chrome = withKeyboard(
        measured ?? (phone ? PHONE_CHROME : DESKTOP_CHROME),
        keyboard,
      );
      // The measurement lands frames after the arrival dock, which docked
      // against the plane's declared chrome; without a re-hold the station
      // sits half the difference away from the caret until the next caret
      // move. No strike: the writing line has not changed.
      const remeasured = measuredBefore.current !== measured;
      measuredBefore.current = measured;
      const surface = editorRef.current?.parentElement;
      if (!remeasured || !guide || searchOpen || !surface) return;
      if (station.state !== "docked") return;
      const pos = getFakeCursorRect();
      if (pos && scroller.hold(pos, surface)) updateFakeCaretRef.current();
    }, [phone, keyboard, measured, guide, scroller, searchOpen]);
    // Suppresses selectionchange during the core's own DOM mutations.
    const rendering = useRef(false);
    // A selectionchange the guard above turned away. The window is held for
    // two frames after a patch, so a writer's selection made inside it is
    // real, and selectionchange fires once, so nothing else would hand it to
    // the engine. The page would show one selection while the engine holds
    // another, and a comment on it is refused without a word. Read when the
    // window closes (`settleRendering`).
    const missedSelection = useRef(false);
    /**
     * Close the rendering window, and hand the engine any selection made
     * while it was open. Only when the page's selection differs from the
     * engine's: re-running the selection handler after every keystroke would
     * move the station for nothing.
     */
    const settleRendering = useCallback(
      (el: HTMLElement) => {
        rendering.current = false;
        if (!missedSelection.current) return;
        missedSelection.current = false;
        const dom = saveDomSelection(el);
        const held = engine.selection;
        if (
          dom &&
          (dom.anchor.para !== held.anchor.para ||
            dom.anchor.offset !== held.anchor.offset ||
            dom.focus.para !== held.focus.para ||
            dom.focus.offset !== held.focus.offset)
        )
          document.dispatchEvent(new Event("selectionchange"));
      },
      [engine],
    );
    // An IME candidate window is anchored to the caret, so the station freezes
    // rather than moving the page out from under it.
    const composing = useRef(false);
    // Whether this composition has already put a step in the history, so the
    // next event folds into it. Separate from `composing`, which is already
    // true when the first composition event arrives.
    const composed = useRef(false);
    // Whether the next paste should strip formatting. Set by the keydown of
    // Ctrl+Shift+V (mod+shift+v), read by the paste event, which carries no
    // modifier of its own. Self-corrects on the next Ctrl+V.
    const plainPasteRef = useRef(false);
    // Accumulates wheel and touch deltas into whole-line steps, one per
    // surface.
    const ratchet = useRef(new LineRatchet());
    // The line height the accumulator's carried fraction was measured in. A
    // prose-size change redefines what one line is, so the fraction must be
    // dropped rather than judged against the new unit.
    const stepHeight = useRef(0);
    // Touch events carry no delta of their own.
    const lastTouchY = useRef<number | null>(null);
    // Whether the pointer is down in the editor; while it is, a collapsed
    // caret is not docked (the deferred click dock).
    const pointing = useRef(false);
    const clickDockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { t } = useTranslation();

    const focusRef = useRef(focus);
    focusRef.current = focus;

    const smoothCaretRef = useRef(smoothCaret);
    smoothCaretRef.current = smoothCaret;

    // Refs for values used inside the `engine.subscribe` callback, so a change
    // to them does not re-run the subscription effect and re-set innerHTML.
    const selectionRef = useRef(selection);
    const searchRef = useRef(search);
    selectionRef.current = selection;
    searchRef.current = search;

    useImperativeHandle(
      handle,
      () => ({
        surface: () => editorRef.current?.parentElement ?? null,
        focus: () => {
          editorRef.current?.focus();
        },
      }),
      [],
    );

    // ── Focus painting and the type guide ────────────────────────────────────

    // Registered on mount, not at import, so instances do not race under
    // StrictMode. Each instance registers under the one `focus` name; the
    // registry keeps the last, which is correct because only one editor is
    // visible.
    const focusHighlight = useRef<LiveHighlight | null>(
      supportsHighlight ? (new Highlight() as unknown as LiveHighlight) : null,
    );
    useEffect(() => {
      if (focusHighlight.current) {
        (CSS.highlights as unknown as LiveHighlightRegistry).set(
          "focus",
          focusHighlight.current,
        );
      }
    }, []);

    function clearFocusDim(editorEl: HTMLElement | null) {
      if (editorEl) editorEl.classList.remove("focus-dim");
      focusHighlight.current?.clear();
    }

    /**
     * One character-boundary rect read, scoped to a single paragraph: the
     * `topOf` that `lineAt`'s binary search asks of layout.
     */
    function makeTopOf(editorEl: HTMLElement, para: number): TopOf {
      return (k: number) => {
        const a = logicalToDomPoint(editorEl, { para, offset: k });
        const b = logicalToDomPoint(editorEl, { para, offset: k + 1 });
        if (!a || !b) return null;
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        const rects = r.getClientRects();
        return rects.length ? Math.round(rects[0].top) : null;
      };
    }

    /**
     * Light one unit back to full ink through the shared highlight, and dim
     * the rest. The null guard exists for the type-checker; it clears the dim
     * so an impossible null cannot leave a stale highlight.
     */
    function paintFocusUnit(
      editorEl: HTMLElement,
      para: number,
      unit: TextUnit,
    ) {
      const highlight = focusHighlight.current;
      if (highlight === null) return clearFocusDim(editorEl);
      const startPt = logicalToDomPoint(editorEl, { para, offset: unit.start });
      const endPt = logicalToDomPoint(editorEl, { para, offset: unit.end });
      if (!startPt || !endPt) return clearFocusDim(editorEl);
      const hlRange = document.createRange();
      hlRange.setStart(startPt.node, startPt.offset);
      hlRange.setEnd(endPt.node, endPt.offset);
      highlight.clear();
      highlight.add(hlRange);
      editorEl.classList.add("focus-dim");
    }

    /**
     * Paint the caret's line or paragraph back to full ink and dim the rest.
     * Blur is not handled here: the last-painted dim survives it and repaints
     * on the next focused caret move.
     */
    function updateFocusDim(editorEl: HTMLElement) {
      if (focusRef.current === "off" || !focusHighlight.current) {
        clearFocusDim(editorEl);
        return;
      }

      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) {
        clearFocusDim(editorEl);
        return;
      }

      const range = sel.getRangeAt(0);
      const logical = domPointToLogical(
        editorEl,
        range.startContainer,
        range.startOffset,
      );
      const p = logical ? getParagraphs(editorEl)[logical.para] : undefined;
      if (!logical || !p) {
        clearFocusDim(editorEl);
        return;
      }

      const text = p.textContent ?? "";
      const unit =
        focusRef.current === "line"
          ? lineAt(text, logical.offset, makeTopOf(editorEl, logical.para))
          : paragraphAt(text.length);

      paintFocusUnit(editorEl, logical.para, unit);
    }

    /** Position and state the type guide. Its height is the station's. */
    function updateGuide(editorEl: HTMLElement | null) {
      const guideDiv = guide?.el.current;
      if (!guideDiv) return;

      if (!editorEl) {
        guideDiv.hidden = true;
        return;
      }
      const surface = editorEl.parentElement;
      if (!surface) return;

      const surfaceBox = surface.getBoundingClientRect();
      const editorBox = editorEl.getBoundingClientRect();
      guideDiv.style.top = `${stationY(surfaceBox, station.chrome)}px`;
      // Pinned to the measure's own edges, never to the ragged text edge,
      // which would move the right-hand chevron on every character typed. The
      // offsets put the chevron's centre (the 22px glyph's midpoint) 52px
      // outside the measure.
      guideDiv.style.setProperty("--guide-left-x", `${editorBox.left - 63}px`);
      guideDiv.style.setProperty(
        "--guide-right-x",
        `${editorBox.right + 41}px`,
      );
      guideDiv.hidden = false;
      guideDiv.dataset.state = station.state;
    }

    /**
     * The writing line changed under a docked caret: pulse the guide, then
     * settle back to whatever state applies.
     */
    function strikeGuide() {
      const guideDiv = guide?.el.current;
      if (!guideDiv || guideDiv.hidden) return;
      guideDiv.dataset.state = "struck";
      if (strikeTimer.current) clearTimeout(strikeTimer.current);
      strikeTimer.current = setTimeout(
        () => updateGuide(editorRef.current),
        130,
      );
    }

    /** Hold the caret through the scroller; pulse the guide if it moved. */
    function holdAndMaybeStrike(surface: HTMLElement) {
      const pos = getFakeCursorRect();
      if (pos && scroller.hold(pos, surface)) strikeGuide();
    }

    /**
     * If the caret has scrolled outside the visible band, snap the page so
     * its line is visible again, before the incoming input commits: the
     * keep-in-band settle runs only after the character is typed. The snap is
     * instant, not the 300ms glide, which would keep the character hidden for
     * its whole duration.
     */
    function revealCaretIfHidden(editorEl: HTMLElement): void {
      const surface = editorEl.parentElement;
      if (!surface) return;
      const pos = getFakeCursorRect();
      if (!pos) return;
      const delta = revealCaretDelta(pos, surface);
      if (delta !== 0) surface.scrollTop += delta;
    }

    /**
     * The size of one ratchet step in px: one full visual line. Not the caret
     * rect: a collapsed range's rect is the font box, not the line box, so at
     * `--leading: 1.92` every step would land half a line short.
     */
    function lineHeightPx(): number {
      const editor = editorRef.current;
      if (editor) {
        const lh = parseFloat(getComputedStyle(editor).lineHeight);
        if (Number.isFinite(lh) && lh > 0) return lh;
      }
      const pos = getFakeCursorRect();
      if (pos && pos.h > 0) return pos.h;
      return 0;
    }

    /**
     * Move the page by whole lines only. Never reached by a scroll view, whose
     * wheel keeps its native meaning.
     */
    function stepSurface(
      surface: HTMLElement,
      deltaPx: number,
      lh: number,
    ): void {
      if (lh <= 0) return;
      if (stepHeight.current > 0 && stepHeight.current !== lh)
        ratchet.current.reset();
      stepHeight.current = lh;
      const steps = ratchet.current.feed(deltaPx, lh);
      if (steps !== 0) glideScrollTo(surface, surface.scrollTop + steps * lh);
    }

    function updateFakeCaret() {
      // A thunk, so the measure costs nothing while the probe is off.
      paintStationProbe(
        () => getFakeCursorRect(),
        editorRef.current?.parentElement ?? null,
      );

      const div = caretDiv.current;
      if (!div) return;

      // No keystroke lands in a comparing mode, so it shows no caret. The
      // stylesheet paints the same decision for the first frame (`data-diff`,
      // `data-timeline`); this gate keeps the div hidden on every later path.
      if (engine.isInDiff) {
        div.hidden = true;
        div.classList.remove("blinking");
        if (blinkTimer.current) clearTimeout(blinkTimer.current);
        return;
      }

      const editorEl = editorRef.current;
      const active = editorEl && document.activeElement === editorEl;

      if (!active) {
        // Focus went to a text field, another app or a dialog, so the caret
        // goes with it. Focus moved to chrome is re-claimed by the blur guard
        // and never reaches this branch.
        div.hidden = true;
        div.classList.remove("blinking");
        if (blinkTimer.current) clearTimeout(blinkTimer.current);
        // The guide's chevrons and the focus dim survive blur.
        return;
      }

      const pos = getFakeCursorRect();
      if (!pos) {
        div.hidden = true;
        // No fake-caret rect also means a non-collapsed selection: nothing is
        // being written, so nothing is held.
        const surface = editorRef.current?.parentElement;
        if (surface) scroller.onCaretMove(null, surface);
        clearFocusDim(editorEl);
        updateGuide(editorEl);
        return;
      }

      div.hidden = false;
      div.style.left = `${pos.x}px`;
      div.style.height = `${pos.h}px`;
      div.style.top = `${pos.y}px`;

      // Solid while moving; blinking resumes once movement stops.
      div.classList.remove("blinking");
      if (blinkTimer.current) clearTimeout(blinkTimer.current);
      blinkTimer.current = setTimeout(() => {
        div.classList.add("blinking");
      }, 300);

      if (editorEl) updateFocusDim(editorEl);
      updateGuide(editorEl);
    }

    // The listeners and effects below subscribe once and must see the latest
    // helpers; re-running them would re-arm document listeners on every
    // keystroke. So each helper is mirrored into a ref.
    const clearFocusDimRef = useRef(clearFocusDim);
    clearFocusDimRef.current = clearFocusDim;
    const updateFocusDimRef = useRef(updateFocusDim);
    updateFocusDimRef.current = updateFocusDim;
    const strikeGuideRef = useRef(strikeGuide);
    strikeGuideRef.current = strikeGuide;
    const holdAndMaybeStrikeRef = useRef(holdAndMaybeStrike);
    holdAndMaybeStrikeRef.current = holdAndMaybeStrike;
    const scrollerRef = useRef(scroller);
    scrollerRef.current = scroller;
    const updateFakeCaretRef = useRef(updateFakeCaret);
    updateFakeCaretRef.current = updateFakeCaret;
    // Mirrored like the helpers: a language change must not repaint the whole
    // document, and the tests mock `t` to a fresh function per render.
    const tRef = useRef(t);
    tRef.current = t;
    // The `openCount` this surface has already reset the scroll for. Starts at
    // the current value: the mount's own paint is handled by the effect body.
    const openSeen = useRef(engine.openCount);
    // The doc the editor's DOM was last drawn from, so a patch can find what
    // changed by reference (`patchChanged`). Null until the first paint and
    // from the end of a composition, which the browser draws itself, until the
    // first patch after it re-draws the page from the model.
    const drawnDoc = useRef<readonly unknown[] | null>(null);

    // ── The engine subscription ──────────────────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      // The scroll position is saved before the DOM is replaced, or the page
      // jumps to the top.
      const surface = el.parentElement;
      const savedScrollTop = !searchOpen && surface ? surface.scrollTop : null;
      setHtml(el, engine.html);
      drawnDoc.current = engine.displayedDoc;
      // `preventScroll`: the browser's own scroll into view would race the
      // station's scroll below and can win, leaving the caret at the bottom.
      if (!searchOpen) el.focus({ preventScroll: true });
      // `focus` alone leaves the native caret at the element boundary (the
      // `.editor` div, offset 0), where a collapsed range has no client rects
      // and no paragraph ancestor, so it cannot be measured until the first
      // real caret move. So the logical selection is restored here. Skipped
      // with `searchOpen`, as focus is: the panel is in charge of the caret.
      if (!searchOpen) restoreDomSelection(el, engine.selection);
      if (savedScrollTop !== null && surface) {
        surface.scrollTop = savedScrollTop;
      }

      if (settleOnMount && !searchOpen && surface) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            holdAndMaybeStrikeRef.current(surface);
            updateFakeCaretRef.current();
            settleRendering(el);
          });
        });
      }

      return engine.subscribe((reason) => {
        if (reason === "doc") {
          // The projection is suspended for the composition's window. The
          // composition range is anchored in the DOM, and `patchDocument`
          // replaces a changed paragraph wholesale (`replaceChild`); doing
          // that to the node the IME is composing in cancels the composition.
          // The model is still current: every composition event was applied as
          // it arrived.
          if (composing.current) return;
          rendering.current = true;
          // Patched, not rebuilt: untouched paragraphs keep their DOM nodes
          // and their native selection. The full reconciliation is the
          // fallback whenever the page cannot be vouched for.
          const shown = engine.displayedDoc;
          if (
            !patchChanged(
              el,
              drawnDoc.current,
              shown,
              (span) => engine.htmlOf(span as typeof shown),
              setHtml,
            )
          )
            patchDocument(el, engine.html, setHtml);
          drawnDoc.current = shown;

          // The contentEditable and `data-diff` sync lives in its own effect,
          // because it must also be right before the first paint.
          const comparing = engine.isInDiff;

          paintHighlights(
            el,
            selectionRef.current,
            searchRef.current,
            () => calculateFlatPosition(el, engine.selection.anchor),
            tRef.current("toolbar.repetitionTooltip"),
          );

          // Painted after the highlights, whose cleanup never touches the
          // `df-*` marks. The merged hunk spans wrap the marks in `.df-hunk`
          // elements for the Accept layer's hit regions.
          if (comparing)
            applyDiffMarks(el, engine.diffDecorations, engine.diffHunks);

          // ── Character fade-in ──────────────────────────────────────────────
          // Wrapped before `restoreDomSelection`, so the selection is restored
          // with the span already in the DOM and is not invalidated.
          if (
            engine.lastOp === "type" &&
            engine.typedText &&
            engine.cursorBefore
          ) {
            const { para, offset } = engine.cursorBefore;
            const paragraphs = getParagraphs(el);
            const pEl = paragraphs[para] as HTMLElement | undefined;
            if (pEl) {
              const textNodes: Text[] = [];
              const walk = (n: Node) => {
                if (n.nodeType === Node.TEXT_NODE) textNodes.push(n as Text);
                else n.childNodes.forEach(walk);
              };
              walk(pEl);

              let acc = 0;
              for (const tn of textNodes) {
                const len = tn.textContent?.length ?? 0;
                if (offset <= acc + len && len > 0) {
                  const start = offset - acc;
                  const end = start + engine.typedText.length;
                  if (start < len) {
                    try {
                      const range = document.createRange();
                      range.setStart(tn, start);
                      range.setEnd(tn, Math.min(end, len));
                      const span = document.createElement("span");
                      span.className = "char-fade-in";
                      range.surroundContents(span);
                    } catch {
                      // An invalid range is skipped.
                    }
                  }
                  break;
                }
                acc += len;
              }
            }
          }

          // ── The caret spring ───────────────────────────────────────────────
          // The class is added synchronously, while the caret still sits at
          // its old `left`; the deferred re-measure below moves it, and the
          // `.caret-bounce` transition animates that move. It stays on for one
          // bounce, so the next reposition (an arrow key, a scroll) is instant.
          if (smoothCaretRef.current && engine.lastOp === "type") {
            const caret = caretDiv.current;
            if (caret) {
              caret.classList.add("caret-bounce");
              if (caretBounceTimer.current)
                clearTimeout(caretBounceTimer.current);
              caretBounceTimer.current = setTimeout(
                () => caret.classList.remove("caret-bounce"),
                CARET_BOUNCE_MS,
              );
            }
          }

          restoreDomSelection(el, engine.selection);

          // A freshly opened file that starts on its first row starts at the
          // top of the page too. The surface outlives the file, so without this
          // the previous file's scroll carries over; only an open that asks for
          // the end ("Continue writing") may leave the page scrolled down.
          if (openSeen.current !== engine.openCount) {
            openSeen.current = engine.openCount;
            const sel = engine.selection;
            if (surface && sel.anchor.para === 0 && sel.anchor.offset === 0)
              surface.scrollTop = 0;
          }

          // The patch re-roots the previous paint's live `Range` onto the
          // editor root, a degenerate range that paints nothing, so the whole
          // column would sit dimmed until the deferred repaint below.
          // Repainting in the same task as the patch keeps the lit line on.
          if (!searchOpen) updateFocusDimRef.current(el);

          // ── Animation hints ────────────────────────────────────────────────
          engine.consumeAnimationHints();

          const surfaceEl = surface ?? el.parentElement;
          if (surfaceEl) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                holdAndMaybeStrikeRef.current(surfaceEl);
                updateFakeCaretRef.current();
                settleRendering(el);
              });
            });
          }
        }
      });
    }, [engine, searchOpen, settleOnMount, settleRendering, setHtml]);

    // ── Highlights on search and selection ───────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      const savedSelection = saveDomSelection(el);

      // Through the refs, like the doc handler: the dependency list below is
      // the per-field one, so a parent handing a fresh-but-equal state object
      // on every render does not repaint the whole surface.
      paintHighlights(
        el,
        selectionRef.current,
        searchRef.current,
        () => calculateFlatPosition(el, engine.selection.anchor),
        t("toolbar.repetitionTooltip"),
      );

      if (savedSelection) {
        restoreDomSelection(el, savedSelection);
      }

      // An arrival goes to the middle, instantly: a smooth scroll issued from
      // this effect does not survive the frame in a real browser, because the
      // surface's own scroll work cancels it and a match below the fold is
      // never reached. The find bar's step keeps the glide to the nearest
      // edge.
      if (search.query && search.currentIndex >= 0) {
        const currentMark = el.querySelector(
          "mark.hl-search-current, mark.hl-evidence",
        );
        if (currentMark) {
          currentMark.scrollIntoView(
            search.scrollTo === "center"
              ? { block: "center", behavior: "auto" }
              : {
                  block: "nearest",
                  behavior: motionIsStill() ? "auto" : "smooth",
                },
          );
        }
      }
    }, [
      engine,
      search.query,
      search.currentIndex,
      search.scrollTo,
      search.caseSensitive,
      search.wholeWord,
      search.hyphensJoinWords,
      search.mark,
      selection.text,
      selection.exactText,
      selection.showRepetitions,
      t,
    ]);

    // ── The comparing modes' read-only posture ───────────────────────────────
    // This effect must run after the mount's innerHTML paint (it sits below
    // the subscribe effect), so the marks survive the initial render.
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      const sync = () => {
        const comparing = engine.isInDiff;
        // The attribute, not the property: jsdom does not reflect the
        // contentEditable property onto the attribute, and the stylesheet
        // and the tests read the attribute.
        el.setAttribute("contenteditable", comparing ? "false" : "true");
        // On the surface, not the editor: the stylesheet's `[data-diff]` rules
        // reach the caret and the guide, which are the editor's siblings.
        const surface = el.parentElement;
        if (comparing) {
          surface?.setAttribute("data-diff", "1");
          applyDiffMarks(el, engine.diffDecorations, engine.diffHunks);
        } else {
          surface?.removeAttribute("data-diff");
          applyDiffMarks(el, []);
        }
      };
      sync();
      // Outside a comparison, and not just out of one, there is nothing to
      // set or clear; re-running on every keystroke would walk the editor
      // twice to change nothing.
      let comparing = engine.isInDiff;
      return engine.subscribe(() => {
        const now = engine.isInDiff;
        if (!now && !comparing) return;
        comparing = now;
        sync();
      });
    }, [engine]);

    // ── Selection from the DOM ───────────────────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      const onSelectionChange = () => {
        if (rendering.current || measuringCaret) {
          if (rendering.current) missedSelection.current = true;
          return;
        }
        missedSelection.current = false;
        syncSelectionFromDom(el, engine, { composing, rendering });

        // Beyond the doc path, this is the one place a plain caret move docks
        // or releases the station. Frozen during IME composition. A collapsed
        // caret is not held while the pointer is down; the pointer effect
        // decides on release whether the gesture was a click.
        if (!composing.current) {
          const surface = el.parentElement;
          if (surface) {
            const pos = getFakeCursorRect();
            if (
              !(pointing.current && pos) &&
              scroller.onCaretMove(pos, surface)
            )
              strikeGuideRef.current();
          }
        }

        updateFakeCaretRef.current();
      };

      document.addEventListener("selectionchange", onSelectionChange);
      return () =>
        document.removeEventListener("selectionchange", onSelectionChange);
    }, [engine, scroller]);

    // ── The deferred click dock ──────────────────────────────────────────────
    //
    // `selectionchange` fires at the press, before a click and the start of a
    // drag are distinguishable, and docking then fights the selection. On
    // release, a collapsed caret is a click and docks, even one that did not
    // move the caret. The dock is deferred so the next press of a double-click
    // can cancel it before the word-select begins.
    const CLICK_DOCK_DELAY_MS = 250;

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      const onPointerDown = () => {
        pointing.current = true;
        if (clickDockTimer.current) {
          clearTimeout(clickDockTimer.current);
          clickDockTimer.current = null;
        }
      };
      const onPointerUp = () => {
        if (!pointing.current) return;
        pointing.current = false;
        const surface = editorRef.current?.parentElement;
        if (!surface) return;
        // A click ends collapsed; a drag or a word-select ends with a
        // selection and nothing to hold.
        const pos = getFakeCursorRect();
        if (!pos) return;
        if (clickDockTimer.current) clearTimeout(clickDockTimer.current);
        clickDockTimer.current = setTimeout(() => {
          clickDockTimer.current = null;
          const s = editorRef.current?.parentElement;
          if (!s) return;
          const p = getFakeCursorRect();
          if (p && scroller.onCaretMove(p, s)) strikeGuideRef.current();
        }, CLICK_DOCK_DELAY_MS);
      };
      const onPointerCancel = () => {
        pointing.current = false;
      };

      el.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
      return () => {
        el.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        if (clickDockTimer.current) clearTimeout(clickDockTimer.current);
      };
    }, [scroller]);

    // ── The IME freeze ───────────────────────────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      const onStart = () => {
        composing.current = true;
        composed.current = false;
      };
      const onEnd = () => {
        composing.current = false;
        // The browser drew the composed text, so the doc last drawn does not
        // describe the page. An undo that restores that doc would compare
        // equal to it and repaint nothing, leaving the composed word on
        // screen after the model dropped it. The next patch reconciles the
        // whole page instead.
        drawnDoc.current = null;
        // A composed word can push the writing line off the station, and
        // nothing else re-docks it while the station is frozen.
        const surface = el.parentElement;
        if (surface) holdAndMaybeStrikeRef.current(surface);
        updateFakeCaretRef.current();
      };
      el.addEventListener("compositionstart", onStart);
      el.addEventListener("compositionend", onEnd);
      return () => {
        el.removeEventListener("compositionstart", onStart);
        el.removeEventListener("compositionend", onEnd);
      };
    }, []);

    // ── Scroll, wheel and touch ──────────────────────────────────────────────
    // The fake caret is in viewport coordinates, so it is updated on scroll.
    // Under `ratchet` the native scroll is stopped and the page steps one
    // visual line per notch. These listeners are non-passive because a
    // passive listener cannot call preventDefault.

    useEffect(() => {
      const surface = editorRef.current?.parentElement;
      if (!surface) return;
      const onScroll = () => {
        scroller.noteScroll();
        updateFakeCaretRef.current();
      };
      const onWheel = (e: WheelEvent) => {
        if (scroller.wheelPolicy() !== "ratchet") {
          scroller.noteWheel();
          return;
        }
        e.preventDefault();
        scroller.noteWheel();
        const lh = lineHeightPx();
        stepSurface(surface, deltaToPixels(e.deltaY, e.deltaMode, lh), lh);
      };
      const onTouchMove = (e: TouchEvent) => {
        if (scroller.wheelPolicy() !== "ratchet") {
          scroller.noteWheel();
          return;
        }
        const touch = e.touches[0];
        if (!touch) return;
        if (lastTouchY.current === null) lastTouchY.current = touch.clientY;
        const delta = lastTouchY.current - touch.clientY;
        lastTouchY.current = touch.clientY;
        if (delta === 0) return;
        e.preventDefault();
        scroller.noteWheel();
        const lh = lineHeightPx();
        stepSurface(surface, delta, lh);
      };
      const resetTouch = () => {
        lastTouchY.current = null;
      };
      surface.addEventListener("scroll", onScroll, { passive: true });
      surface.addEventListener("wheel", onWheel, { passive: false });
      surface.addEventListener("touchmove", onTouchMove, { passive: false });
      surface.addEventListener("touchstart", resetTouch, { passive: true });
      surface.addEventListener("touchend", resetTouch, { passive: true });
      surface.addEventListener("touchcancel", resetTouch, { passive: true });
      return () => {
        surface.removeEventListener("scroll", onScroll);
        surface.removeEventListener("wheel", onWheel);
        surface.removeEventListener("touchmove", onTouchMove);
        surface.removeEventListener("touchstart", resetTouch);
        surface.removeEventListener("touchend", resetTouch);
        surface.removeEventListener("touchcancel", resetTouch);
      };
    }, [scroller]);

    // ── Re-measuring on layout change ────────────────────────────────────────
    // A window resize or a panel toggle moves the surface, the station and the
    // editor box without a caret move or a scroll, so the caret and the
    // chevrons would sit at stale coordinates until the next keystroke:
    //
    // - A `ResizeObserver` on the surface catches the window resize and the
    //   rail toggle (a panel's width is surface padding).
    // - The dock, wide, moves the editor with a `translate`, which a
    //   ResizeObserver cannot see, so the shell's layout attributes are
    //   watched.
    // - Henosis resizes the editor and not the surface, so the same
    //   ResizeObserver watches the editor too.
    // - A late web font can move the lines without resizing any box, so a
    //   finished font load re-measures through the scroller's `reflow`, which
    //   leaves alone a page the writer has scrolled.
    //
    // The measure is deferred through a double rAF: a resize callback fires
    // while the browser is still reflowing, and a caret rect read mid-reflow
    // would dock by the wrong delta.
    useEffect(() => {
      const surface = editorRef.current?.parentElement;
      const editor = editorRef.current;
      if (!surface || !editor) return;
      // Only the surface's height and the measure's width move the writing
      // line up or down. A sideways-only change must not hold, or a page the
      // writer scrolled away would glide back to the caret whenever the panel
      // or the dock opens. Read from the boxes, never from the caret, so
      // neither scrolling nor typing counts as a change here.
      const shapeOf = () => ({
        height: surface.clientHeight,
        width: editor.clientWidth,
      });
      let shape = shapeOf();
      // While the measure is still easing to its new width the caret is only
      // painted; the line is held once, on the width it settles at.
      let widening = false;
      const remeasure = () => {
        // Hold only while the editor is focused: docking under a writer busy
        // elsewhere would move the page out from under them.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (widening) {
              updateFakeCaretRef.current();
              return;
            }
            const now = shapeOf();
            // A first measure taken before the editor was laid out (width 0)
            // is adopted rather than read as a reflow, or the first dock open
            // after a chapter opens would glide the page to the caret.
            const measured = shape.height > 0 && shape.width > 0;
            const vertical =
              measured &&
              (now.height !== shape.height || now.width !== shape.width);
            shape = now;
            const editorEl = editorRef.current;
            if (vertical && editorEl && document.activeElement === editorEl) {
              holdAndMaybeStrikeRef.current(surface);
            }
            updateFakeCaretRef.current();
          });
        });
      };

      const ro =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(remeasure)
          : null;
      ro?.observe(surface);
      ro?.observe(editor);

      const shell = surface.parentElement;
      const mo =
        shell && typeof MutationObserver !== "undefined"
          ? new MutationObserver(remeasure)
          : null;
      if (mo && shell) {
        mo.observe(shell, {
          attributes: true,
          attributeFilter: ["data-dock", "data-rail", "data-narrow"],
        });
      }

      // The dock moves the editor with the `translate` property, not
      // `transform`, so the event's `propertyName` is "translate". The
      // MutationObserver's remeasure reads the rect a couple of frames into
      // the transition, so the move is tracked frame by frame and settles on
      // the final rect when it ends. Henosis eases `max-width`, which re-wraps
      // every line, so its end is measured as a reflow.
      const moving = (e: TransitionEvent) =>
        e.target === editor &&
        (e.propertyName === "translate" || e.propertyName === "max-width");
      let tracking = false;
      let trackRaf = 0;
      let trackTimer: ReturnType<typeof setTimeout> | null = null;
      const stopTracking = () => {
        tracking = false;
        if (widening) {
          widening = false;
          remeasure();
        }
        if (trackRaf) cancelAnimationFrame(trackRaf);
        trackRaf = 0;
        if (trackTimer) clearTimeout(trackTimer);
        trackTimer = null;
      };
      const onTransformStart = (e: TransitionEvent) => {
        if (!moving(e)) return;
        if (e.propertyName === "max-width") widening = true;
        if (tracking) return;
        tracking = true;
        const paint = () => {
          if (!tracking) return;
          updateFakeCaretRef.current();
          trackRaf = requestAnimationFrame(paint);
        };
        trackRaf = requestAnimationFrame(paint);
        // `transitionend` can be skipped (an interrupted transition, or a
        // reduced-motion build where the move lands in one frame), so the loop
        // stops after a beat regardless.
        trackTimer = setTimeout(stopTracking, SCROLL_GLIDE_MS + 300);
      };
      const onTransformEnd = (e: TransitionEvent) => {
        if (!moving(e)) return;
        stopTracking();
        updateFakeCaretRef.current();
      };
      editor.addEventListener("transitionstart", onTransformStart);
      editor.addEventListener("transitionend", onTransformEnd);
      const onFonts = () =>
        requestAnimationFrame(() => {
          const editorEl = editorRef.current;
          const pos = getFakeCursorRect();
          if (editorEl && pos && document.activeElement === editorEl)
            scrollerRef.current.reflow(pos, surface);
          remeasure();
        });
      document.fonts?.addEventListener("loadingdone", onFonts);

      return () => {
        ro?.disconnect();
        mo?.disconnect();
        document.fonts?.removeEventListener("loadingdone", onFonts);
        editor.removeEventListener("transitionstart", onTransformStart);
        editor.removeEventListener("transitionend", onTransformEnd);
        widening = false;
        stopTracking();
      };
    }, []);

    // ── The focus preference ─────────────────────────────────────────────────

    useEffect(() => {
      updateFakeCaretRef.current();
      // `focus` changes while the editor is blurred (from the settings
      // panel), so the dim is cleared or painted here rather than waiting for
      // a focused caret move that may never come. `updateFocusDim` reads the
      // live DOM selection, which by then points into the field that took
      // focus, so the engine's last logical caret is restored first.
      if (focusRef.current === "off")
        clearFocusDimRef.current(editorRef.current);
      else {
        const el = editorRef.current;
        if (el) {
          restoreDomSelection(el, engine.selection);
          updateFocusDimRef.current(el);
        }
      }
    }, [focus, engine]);

    // ── Repetition highlights on scroll ──────────────────────────────────────
    // A scroll clears the repetition highlights after a short debounce. The
    // marks are unwrapped in place rather than through state, which would
    // re-render the editor on the most frequent event there is.

    useEffect(() => {
      const surface = editorRef.current?.parentElement;
      if (!surface) return;

      let scrollTimer: ReturnType<typeof setTimeout> | null = null;
      const onScroll = () => {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          const el = editorRef.current;
          if (!el) return;
          el.querySelectorAll("mark.hl-repetition").forEach((mark) => {
            const parent = mark.parentNode;
            if (!parent) return;
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            parent.removeChild(mark);
          });
          el.normalize();
        }, 100); // Not cleared mid-scroll.
      };

      surface.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        surface.removeEventListener("scroll", onScroll);
        if (scrollTimer) clearTimeout(scrollTimer);
      };
    }, []);

    // ── The repetition tooltip flip ──────────────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      const onMouseEnter = (e: MouseEvent) => {
        const mark = (e.target as HTMLElement).closest("mark.hl-repetition");
        if (!mark) return;
        const rect = mark.getBoundingClientRect();
        if (rect.top < 40) {
          mark.classList.add("flip-tooltip");
        } else {
          mark.classList.remove("flip-tooltip");
        }
      };

      el.addEventListener("mouseenter", onMouseEnter, true);
      return () => el.removeEventListener("mouseenter", onMouseEnter, true);
    }, []);

    // ── Focus and blur ───────────────────────────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      const onFocus = () => updateFakeCaretRef.current();

      // The re-claim below answers a click and never a Tab: applied to the
      // keyboard, Tab could never leave the writing surface, a keyboard trap
      // (WCAG 2.1.2, Level A). The flag is cleared on a timer rather than on
      // the next pointer event, because a blur can arrive without one, and a
      // latched Tab would disarm the click re-claim.
      let tabbing = false;
      let clearTab = 0;
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== "Tab") return;
        tabbing = true;
        clearTimeout(clearTab);
        clearTab = window.setTimeout(() => (tabbing = false), 0);
      };

      const onBlur = (e: FocusEvent) => {
        // A click on chrome re-claims focus the instant it tries to leave.
        // Exceptions:
        // - a text field needs focus of its own, or the keystroke goes to
        //   prose;
        // - the dock's controls answer keys once clicked; taken back, those
        //   keys would land in the prose;
        // - focus leaving the app entirely: fighting the browser for focus
        //   starts loops;
        // - a portalled overlay is outside the shell, and dialogs own their
        //   focus;
        // - the writer pressed Tab to leave.
        const next = e.relatedTarget as HTMLElement | null;
        let reclaimed = false;
        if (
          !tabbing &&
          next &&
          !el.contains(next) &&
          !isTextEntry(next) &&
          !next.closest(".ed-dock")
        ) {
          const shell = el.closest(".editor-shell");
          if (shell && shell.contains(next)) {
            el.focus({ preventScroll: true });
            reclaimed = true;
          }
        }
        if (!reclaimed && caretDiv.current) caretDiv.current.hidden = true;
        if (onClearHighlights) onClearHighlights();
      };
      el.addEventListener("focus", onFocus);
      el.addEventListener("blur", onBlur);
      // Capture, so the flag is set before the blur the same keypress causes.
      el.addEventListener("keydown", onKeyDown, true);
      return () => {
        clearTimeout(clearTab);
        el.removeEventListener("focus", onFocus);
        el.removeEventListener("blur", onBlur);
        el.removeEventListener("keydown", onKeyDown, true);
      };
    }, [onClearHighlights]);

    // ── Text input ───────────────────────────────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      const onBeforeInput = (e: InputEvent) => {
        // Whatever is cancelable is cancelled. The composition types are not
        // (the spec says so and `e2e/ime-trace.spec.ts` confirms it), so the
        // call is inert on them, and a non-cancelable `inputType` is still
        // routed rather than swallowed.
        if (e.cancelable) e.preventDefault();
        dispatchBeforeInput(
          el,
          engine,
          e,
          { composing, composed, rendering },
          revealCaretIfHidden,
        );
      };

      el.addEventListener("beforeinput", onBeforeInput);
      return () => el.removeEventListener("beforeinput", onBeforeInput);
    }, [engine]);

    // ── Keyboard shortcuts ───────────────────────────────────────────────────

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      const onKeyDown = (e: KeyboardEvent) => {
        // Ctrl+Shift+V is tracked ahead of the paste event, which cannot see
        // its own modifiers. Rich paste is the default; Shift makes it plain.
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
          plainPasteRef.current = e.shiftKey;
        }
        dispatchShortcutKey(el, engine, e);
      };

      el.addEventListener("keydown", onKeyDown);
      return () => el.removeEventListener("keydown", onKeyDown);
    }, [engine]);

    // ── Cut, copy and paste ──────────────────────────────────────────────────
    // The browser fires these ClipboardEvents for the keyboard, a native menu
    // and the mac Edit menu alike, so one listener set owns every trigger.
    // Each handler serializes from the engine model, not the DOM.

    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;

      const onCopy = (e: ClipboardEvent) => dispatchCopy(el, engine, e);
      const onCut = (e: ClipboardEvent) => dispatchCut(el, engine, e);
      const onPaste = (e: ClipboardEvent) =>
        dispatchPaste(el, engine, e, { plain: plainPasteRef.current });

      el.addEventListener("copy", onCopy);
      el.addEventListener("cut", onCut);
      el.addEventListener("paste", onPaste);
      return () => {
        el.removeEventListener("copy", onCopy);
        el.removeEventListener("cut", onCut);
        el.removeEventListener("paste", onPaste);
      };
    }, [engine]);

    return (
      <>
        <div
          ref={editorRef}
          className="editor"
          contentEditable
          suppressContentEditableWarning
          // The editor stays reachable by the keyboard in the read-only diff
          // mode: undo and redo keep working while a comparison is up, and a
          // `contenteditable=false` element is not focusable, so without the
          // tabindex, Mod+Z after an accept goes nowhere.
          tabIndex={0}
          // Spellcheck squiggles would fight the engine's own marks and the
          // fake caret; the writer proofreads, not the browser.
          spellCheck={false}
        />
        {gutter?.(editorRef.current, editorRef.current?.parentElement ?? null)}
        <DiffAcceptLayer engine={engine} />
        <div ref={caretDiv} className="fake-cursor" hidden />
        {guide && <TypeGuide guideRef={guide.el} mark={guideMark} />}
      </>
    );
  },
);
