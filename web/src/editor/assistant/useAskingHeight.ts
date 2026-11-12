// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * The height of the asking block, written onto the stage it floats over.
 *
 * The asking stack lies over the transcript, so the transcript is told how
 * much of its foot is covered. Otherwise the last message can never be
 * scrolled clear of the composer, and the jump button parks behind it. The
 * height is not a constant: the composer grows with the question, the
 * suggestions wrap at a narrow dock, and the quoted selection, every
 * refusal and every hint row come and go.
 *
 * Written onto the node, not through state: routing a box measurement
 * through React would re-render the whole transcript on every keystroke.
 * The stylesheet carries a resting fallback for first paint and for
 * environments with no `ResizeObserver`.
 *
 * Called by the component that renders the composer, or one above it: a
 * child's layout effect (the composer setting its own height) runs before
 * this one.
 *
 * `observeKey` restarts the observer when the block can have remounted.
 */
export function useAskingHeight(observeKey: unknown) {
  const stageRef = useRef<HTMLDivElement>(null);
  const askingRef = useRef<HTMLDivElement>(null);
  const measureAsking = useCallback(() => {
    const stage = stageRef.current;
    const asking = askingRef.current;
    if (stage && asking)
      stage.style.setProperty("--ai-asking-h", `${asking.offsetHeight}px`);
  }, []);

  // No dependency list. Nearly a dozen things change this height (the open
  // chat, the draft, the quote, the problem and hint rows, the persona's
  // name, every suggestion chip), and a list of them goes stale silently,
  // leaving a scroller that cannot reach its own last message. The rule is to
  // measure whatever just rendered; the read is one `offsetHeight` on a panel
  // that already re-renders per keystroke. A layout effect, because it must
  // land in the frame of the render that changed it.
  useLayoutEffect(measureAsking);

  // An observer covers the changes no render of this panel causes: the
  // writer narrowing the dock until the suggestions rewrap, or a webfont
  // landing after first paint.
  useEffect(() => {
    const asking = askingRef.current;
    // Guarded because jsdom has none and an unguarded construction throws.
    if (!asking || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureAsking);
    observer.observe(asking);
    return () => observer.disconnect();
  }, [observeKey, measureAsking]);

  return { stageRef, askingRef };
}
