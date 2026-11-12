// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";

// The on-screen keyboard, as a number. The phone layout puts the chrome on the
// bottom edge, which is where the keyboard arrives.
//
// The keyboard does not resize the page. Both engines default to
// `interactive-widget: resizes-visual`, so the layout viewport keeps its full
// height (`100dvh`, `position: fixed; bottom: 0` and `window.innerHeight` all
// carry on unchanged) while the visual viewport, what the eye can see, shrinks
// to the band above the keys. A bar pinned to the bottom of the layout
// viewport is therefore pinned under the keyboard.
//
// `visualViewport` alone reports the difference, and identically on both
// engines, so no `interactive-widget` declaration is added: one mechanism and
// one code path, exercised on every device rather than an iOS branch nobody
// runs.

/**
 * Below this, it is not a keyboard. `visualViewport` moves for things that
 * are not the keyboard: a URL bar collapsing on scroll, a pinch-zoom, an
 * iPadOS floating toolbar. The smallest phone keyboard is over 200px even in
 * landscape, and browser chrome shifts stay well under 100, so a floor
 * separates the two without asking which engine is running.
 */
const KEYBOARD_FLOOR = 120;

/**
 * How much of the layout viewport is hidden along its bottom edge: the
 * keyboard's height in CSS pixels, or 0 when there is no keyboard.
 *
 * `offsetTop` is part of it: when the browser scrolls the visual viewport to
 * keep a focused field above the keys, the band moves down inside the layout
 * viewport, and only `height + offsetTop` says where its bottom edge is.
 */
export function keyboardInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const hidden = window.innerHeight - (vv.height + vv.offsetTop);
  return hidden > KEYBOARD_FLOOR ? Math.round(hidden) : 0;
}

/**
 * `keyboardInset()` as React state, updated as the keyboard opens and closes.
 *
 * Answers 0 where `visualViewport` is missing: a desktop browser old enough
 * to lack it has no on-screen keyboard either.
 *
 * Coalesced through one animation frame, and set only when the number
 * changes. The keyboard's opening animation fires a `resize` per frame and
 * the browser fires `scroll` alongside it, so without this the writing
 * surface re-renders thirty times for one keypress.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    // A boolean rather than the frame handle. The assignment
    // `frame = requestAnimationFrame(...)` lands after the callback if the
    // frame runs synchronously, so a handle-based guard would stay armed and
    // the keyboard closing would never be reported. Set before scheduling and
    // cleared inside, the guard holds either way.
    let queued = false;
    const read = () => {
      setInset((was) => {
        const now = keyboardInset();
        return now === was ? was : now;
      });
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      frame = requestAnimationFrame(() => {
        queued = false;
        read();
      });
    };
    // Read on mount: a keyboard can already be up, as on a phone reloading the
    // page with a field focused, and a listener reports only what happens
    // next.
    read();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    };
  }, []);

  return inset;
}
