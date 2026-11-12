// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef } from "react";

// Dismiss on looking away: the gesture every popover shares. A menu, a
// disclosure panel, anything open but not modal is dismissed by pressing
// somewhere that is not it. Three details carry the behaviour.
//
// `pointerdown`, not `click`: a popover must be gone before whatever sits
// underneath reacts. On `click` the press lands on the element behind, the
// popover closes afterwards, and the writer has pressed something they were
// aiming past.
//
// Registered a frame late: the `pointerdown` that opened the popover is still
// travelling when this effect runs, so a listener added synchronously catches
// that press and closes what it just opened.
//
// In the capture phase: a dismissal that listens on the way up can be
// switched off by any `stopPropagation()` between the target and the
// document (the structure panel's `.dt-actions` stops the press), and a
// second row's `⋯` would then open a second menu beside the first.
//
// A hook rather than inlined twice, because a second copy is where one of the
// three details goes missing.

/**
 * Close when a pointer goes down outside every one of `within`.
 *
 * Nulls are ignored, so a caller can pass elements that have not attached yet,
 * the common case on first render. The list is re-read when the event fires
 * rather than captured when the listener is installed: captured, it would pin
 * the elements as they were when the popover opened, and a panel that renders
 * its contents afterwards would look empty to the listener.
 */
export function useDismissOnPointerAway(
  open: boolean,
  within: readonly (HTMLElement | null | undefined)[],
  onClose: () => void,
): void {
  const latest = useRef(within);
  latest.current = within;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (latest.current.some((el) => el?.contains(target ?? null) ?? false))
        return;
      onClose();
    };
    const timer = window.setTimeout(
      () => document.addEventListener("pointerdown", away, true),
      0,
    );
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", away, true);
    };
  }, [open, onClose]);
}
