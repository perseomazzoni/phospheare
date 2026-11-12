// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, type RefObject } from "react";
import { createReveal } from "./reveal";

/**
 * Marks each scroller inside `root` with `data-scrolling` while it scrolls,
 * for the stylesheet to show its bar. One listener in the capture phase,
 * since a scroll event does not bubble; nothing is attached while `on` is
 * false.
 */
export function useScrollReveal(
  root: RefObject<HTMLElement | null>,
  on: boolean,
): void {
  useEffect(() => {
    const host = root.current;
    if (!on || !host) return;
    const reveal = createReveal<Element, ReturnType<typeof setTimeout>>(
      (el, shown) => {
        if (shown) el.setAttribute("data-scrolling", "1");
        else el.removeAttribute("data-scrolling");
      },
      {
        set: (run, ms) => setTimeout(run, ms),
        clear: (id) => clearTimeout(id),
      },
    );
    const onScroll = (event: Event) => {
      if (event.target instanceof Element) reveal.touch(event.target);
    };
    host.addEventListener("scroll", onScroll, true);
    return () => {
      host.removeEventListener("scroll", onScroll, true);
      reveal.dispose();
    };
  }, [root, on]);
}
