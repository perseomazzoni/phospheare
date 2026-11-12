// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";
import { foldDurationMs } from "./domain/foldDuration";

/** Where the command bar stands while the writer works in it. */
export function useBarPin() {
  // A bar the pointer is working in lies over the panels it overlaps:
  // `data-fold-engaged` on the shell lifts the chrome layer above the
  // structure panel and the dock while the bar is engaged, pointer inside or
  // a control focused. The editor bar reports it through `onFoldEngaged`.
  const [foldEngaged, setFoldEngaged] = useState(false);

  // Where the bar stood when the writer reached for it, in its row's
  // coordinates, or null at rest. At rest the bar centres on the prose
  // (`.bar-stack`'s `translate` in `editor.css`); engaged, it holds still, so
  // a fold opening grows the bar rightwards instead of re-centring it and
  // sliding the controls out from under the pointer.
  //
  // The pin is taken the instant the pointer enters the stack, not when the
  // engagement arrives: a fold under an entering pointer starts widening on
  // its own `:hover` at once, while the engagement comes through an effect a
  // frame or more later, by which time the centring has already moved the
  // bar. The pin is the rest position itself, applied with no ease
  // (`.bar-stack[data-pinned]` drops the transition). The engagement still
  // pins on its own, for a keyboard or a subpanel, and a pin is never
  // re-measured while it holds. `--bar-pin` is set on the row and the stack
  // inherits it, so a theme that places the bar by the row's layout reads it
  // as well.
  //
  // Released in two beats: leaving the bar collapses the folds first, and
  // only once they have closed does the pin drop and the bar ease home; at
  // once, the bar shrinks at one end while sliding and reads as one lurch.
  // The wait is a fold's computed `transition-duration`, the same `--t` the
  // ease home runs on, so a theme or reduced motion, which zeroes it, moves
  // both beats together. Not the stack's own: pinned, it has none.
  const barStack = useRef<HTMLDivElement>(null);
  const [barPin, setBarPin] = useState<number | null>(null);
  const pinned = useRef(false);
  const barRelease = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinBar = useCallback(() => {
    if (barRelease.current !== null) {
      clearTimeout(barRelease.current);
      barRelease.current = null;
    }
    const stack = barStack.current;
    const row = stack?.parentElement;
    if (pinned.current || !stack || !row) return;
    pinned.current = true;
    setBarPin(
      stack.getBoundingClientRect().left - row.getBoundingClientRect().left,
    );
  }, []);
  const onFoldEngaged = useCallback(
    (engaged: boolean) => {
      setFoldEngaged(engaged);
      if (engaged) {
        pinBar();
        return;
      }
      if (barRelease.current !== null) clearTimeout(barRelease.current);
      const fold = barStack.current?.querySelector(".ed-fold");
      barRelease.current = setTimeout(
        () => {
          barRelease.current = null;
          pinned.current = false;
          setBarPin(null);
        },
        foldDurationMs(fold ? getComputedStyle(fold).transitionDuration : ""),
      );
    },
    [pinBar],
  );
  useEffect(
    () => () => {
      if (barRelease.current !== null) clearTimeout(barRelease.current);
    },
    [],
  );

  return { foldEngaged, barStack, barPin, pinBar, onFoldEngaged };
}
