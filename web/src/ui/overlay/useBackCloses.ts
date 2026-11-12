// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef } from "react";

// The back gesture closes the layer, not the project. On Android, back is the
// universal dismiss: it is how a sheet, a menu and a keyboard all go away, and
// there is no other gesture for it. Unanswered, back with the structure sheet
// open over a manuscript would leave the project, so the writer's way out of a
// panel would also be the way out of the editor.
//
// Each open layer holds one history entry. Opening pushes an entry whose URL
// is the one already showing, so the router sees no navigation and re-renders
// nothing; back pops it and the layer closes instead of the route. Closing any
// other way (Escape, the backdrop, the close button) pops that entry back off,
// so the writer is never left with a back step that appears to do nothing.
//
// iOS Safari's edge swipe is the browser's history, which this makes behave
// the same way, so the contract is the same on both platforms.
//
// Layers stack, so the bookkeeping is module-wide rather than per hook. With a
// `popstate` listener per layer, closing the writing-preferences sheet over
// the structure sheet with its own Done button runs a teardown
// `history.back()`, and the outer layer hears that pop and closes as well: one
// press, two layers. So this module keeps the stack (only the innermost layer
// answers a pop) and a count of the pops it caused itself (which answer to
// nobody).

/** Marks this module's entries, so a pop can be told from the router's. */
// Neutral, like everything the browser keeps.
const MARK = "layer";

interface Marked {
  [MARK]?: true;
}

/** The open layers that answer back, innermost last. */
const layers: Array<() => void> = [];

/**
 * Pops this module caused itself, by popping the entry of a layer that closed
 * some other way. They reach no layer: the one they belong to has gone, and
 * the one beneath it stays open.
 *
 * Every `history.back()` this module calls adds one, and the `popstate`
 * listener stays until each has arrived, even with no layer left open. Two
 * layers closing in one commit both pop after the last teardown; a listener
 * removed with the last layer would miss those pops, and the count left
 * standing would eat the next layer's first real back press.
 */
let selfPops = 0;

/** Pops a closed layer's entry; its `popstate` reaches no layer. */
function popOwn(): void {
  selfPops += 1;
  window.history.back();
}

/** Stops listening once no layer is open and no own pop is still due. */
function settle(): void {
  if (layers.length === 0 && selfPops === 0)
    window.removeEventListener("popstate", onPop);
}

/**
 * True between "the last open layer just closed" and either a same-tick
 * replacement claiming its entry or the microtask below popping it.
 *
 * A command that closes one layer to open another (the board's buttons:
 * `CommandBoard.run` calls `onClose()` then `command.run()`) closes and opens
 * in the same commit, and React runs every effect's cleanup before any
 * effect's setup, so the closing layer's teardown runs first. A
 * `history.back()` there queues a navigation the browser processes only after
 * the commit and the new layer's `pushState` have finished, so the pop would
 * land on the new entry and close the layer that just opened
 * (`useBackCloses.test.tsx` pins it).
 *
 * So the teardown offers its entry instead of popping it. A layer whose setup
 * runs before the offer expires reuses the entry rather than pushing a second
 * one, and the offer expires on the next microtask, by which point every
 * effect in this commit has run: a microtask never fires until the current
 * synchronous block of cleanups and setups has finished.
 */
let handoff = false;

function onPop(): void {
  if (selfPops > 0) selfPops -= 1;
  else layers[layers.length - 1]?.();
  settle();
}

/**
 * While `open`, the platform's back gesture calls `close` instead of leaving
 * the page.
 *
 * `open` is the only dependency. A caller passing an inline arrow for `close`
 * would otherwise tear down and re-run this on every render, and the teardown
 * calls `history.back()`, navigating the writer backwards once per render.
 * The current `close` is read through a ref, so a fresh arrow costs nothing
 * and the handler is never stale.
 */
export function useBackCloses(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    if (handoff) {
      // Another layer's teardown offered its entry in this commit: a second
      // push would give the pending back-check, now cancelled, an entry to
      // pop wrongly.
      handoff = false;
    } else {
      // Same URL: `pushState` with no `url` argument keeps the current one,
      // so the router's location never changes and nothing re-renders on
      // the way in or out.
      window.history.pushState({ [MARK]: true } satisfies Marked, "");
    }

    let popped = false;
    const layer = () => {
      popped = true;
      closeRef.current();
    };
    layers.push(layer);
    // Adding the same listener twice is a no-op, so one still waiting on an
    // own pop is kept rather than doubled.
    window.addEventListener("popstate", onPop);

    return () => {
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
      // Closed some other way, so the layer's entry is still on top and would
      // be a back step that does nothing visible. Only when the entry is still
      // marked: a real navigation while the layer was open has replaced it,
      // and going back then would undo the writer's own move.
      const state: Marked | null = window.history.state;
      const restore = !popped && state?.[MARK] === true;
      if (!restore) {
        settle();
        return;
      }
      if (layers.length > 0) {
        // A layer is already stacked beneath, so no handoff is possible and
        // the pop runs at once.
        popOwn();
        return;
      }
      // Nothing left open: offer the entry, as `handoff` says. The listener
      // stays meanwhile: a replacement needs it, and so does the pop.
      handoff = true;
      queueMicrotask(() => {
        if (!handoff) return;
        handoff = false;
        popOwn();
      });
    };
  }, [open]);
}
