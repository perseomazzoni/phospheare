// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Routes every `beforeinput` shape into the engine. Cut and paste are not
// here: `clipboardDispatch.ts` owns them, because it reads the full
// `text/html` and `text/plain` flavors that the `insertFromPaste` event's
// `dataTransfer` does not carry.
//
// An input family with no case is dropped silently, so the default warns in
// development. A non-cancelable unhandled `inputType` in production has no
// other signal: `EditorCore`'s `preventDefault` is inert on it.

import type { EditorEngine } from "./engine";
import { domPointToLogical } from "./writing/dom";
import { syncSelectionFromDom, type InputFlags } from "./selectionSync";

export interface BeforeInputFlags extends InputFlags {
  /**
   * This composition has already committed a step, so the next one folds into
   * it rather than opening another. Reset on `compositionstart`.
   *
   * It cannot be derived from `composing`, which is already true when the
   * first composition event arrives, because `compositionstart` fires first
   * (`e2e/ime-trace.spec.ts`). Folding on that one would swallow the
   * composition into whatever the writer did before it.
   */
  composed: { current: boolean };
}

/**
 * The span an input event says it is replacing, in the engine's coordinates,
 * or null when the browser reports none or it cannot be mapped; the caller
 * then does not guess a span.
 *
 * `getTargetRanges()` is the only trustworthy source during a composition,
 * where the caret is inside the IME's working text. Measuring it against the
 * DOM is valid because every composition event is applied to the model as it
 * arrives, so a DOM offset is a model offset.
 */
function targetRange(el: HTMLElement, e: InputEvent) {
  const range = e.getTargetRanges?.()[0];
  if (!range) return null;
  const anchor = domPointToLogical(el, range.startContainer, range.startOffset);
  const focus = domPointToLogical(el, range.endContainer, range.endOffset);
  if (!anchor || !focus) return null;
  return { anchor, focus };
}

/**
 * Route a `beforeinput` event to the engine. The caller has already cancelled
 * the event where the browser allows it.
 *
 * Reveals a hidden caret before the engine commits, except while composing:
 * the IME candidate window is anchored to the caret, and moving the page
 * mid-composition pulls it from under the writer's eye.
 */
export function dispatchBeforeInput(
  el: HTMLElement,
  engine: EditorEngine,
  e: InputEvent,
  flags: BeforeInputFlags,
  revealCaretIfHidden: (el: HTMLElement) => void,
): void {
  if (!flags.composing.current) revealCaretIfHidden(el);

  // Skipped during a composition: the DOM's caret sits inside the IME's
  // working text, and the composition names its own span instead.
  syncSelectionFromDom(el, engine, flags);

  switch (e.inputType) {
    case "insertText":
      if (e.data) engine.type(e.data);
      break;
    // A spellcheck or autocorrect replacement. The browser has already moved
    // the selection onto the replaced range; the stated span is preferred, as
    // for a composition.
    case "insertReplacementText": {
      if (e.data === null) break;
      const range = targetRange(el, e);
      if (range) engine.replaceRange(range, e.data);
      else engine.type(e.data);
      break;
    }
    // Both composition events are non-cancelable (`e2e/ime-trace.spec.ts`):
    // the browser writes the composed text regardless. So the model mirrors
    // each event, keeping it character-identical to the DOM for the whole
    // window. `fold` makes the run one undo step, or a swipe-typed word would
    // spend the journal's 2000-step budget one keystroke at a time.
    //
    // There is no reconciliation against the DOM at `compositionend`. In the
    // comparison modes the DOM shows the merged document, so reading it back
    // would write the compared file's prose into the manuscript. Adding a
    // reconcile needs a security review.
    case "insertCompositionText":
    case "deleteCompositionText": {
      const range = targetRange(el, e);
      // No range means no ingest: the composed text stays on screen but never
      // reaches the model, and the composition is lost silently.
      if (!range) break;
      if (
        engine.replaceRange(range, e.data ?? "", {
          fold: flags.composed.current,
        })
      )
        flags.composed.current = true;
      break;
    }
    // Safari commits a composition as `deleteCompositionText` followed by a
    // cancelable `insertFromComposition` carrying the final text, which the
    // core's `preventDefault` stops the browser writing.
    case "insertFromComposition": {
      if (!e.data) break;
      const range = targetRange(el, e);
      if (range) {
        engine.replaceRange(range, e.data, { fold: flags.composed.current });
      } else engine.type(e.data);
      break;
    }
    case "deleteContentBackward":
      engine.backspace();
      break;
    case "deleteContentForward":
      engine.del();
      break;
    // Ctrl+Backspace, Ctrl+Delete and Cmd+Backspace need their own cases:
    // `EditorCore` calls `preventDefault()` on every cancelable beforeinput
    // before this dispatch runs, so an unhandled one does nothing at all.
    case "deleteWordBackward":
      engine.deleteWordBackward();
      break;
    case "deleteWordForward":
      engine.deleteWordForward();
      break;
    case "deleteSoftLineBackward":
      engine.deleteSoftLineBackward();
      break;
    case "insertParagraph":
    case "insertLineBreak":
      engine.enter();
      break;
    case "historyUndo":
      engine.undo();
      break;
    case "historyRedo":
      engine.redo();
      break;
    // Do not handle `insertFromDrop`: it would carry arbitrary HTML from any
    // page or app past `parseHtmlAllowlist`, the one hardened HTML-to-model
    // boundary. It is cancelable, so the core's `preventDefault` stops it.
    default:
      if (import.meta.env.DEV) {
        console.warn(
          `beforeInputDispatch: unhandled inputType "${e.inputType}" fell through to the default (cancelable=${e.cancelable})`,
        );
      }
      break;
  }
}
