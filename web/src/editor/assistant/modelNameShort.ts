// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useRef, useState } from "react";

// When the chat bar's model button gives up the model's name for the word
// "model". A fixed width cannot know how long the name is: a long id leaves
// the bar no room at a width where a short one fits. So the switch is
// measured. The name goes the moment the bar overflows or a reading's meter
// is cut with the name showing, and comes back only once the bar is as wide
// as it was then plus what it lacked, so the button never flickers at the
// edge. The bar's 400px container query in `editor.css` stays as the floor
// below which no name is shown.

/**
 * Whether the bar shows the short spelling for `name`. Keyed on the name, so a
 * chat that changes model starts from its full name and measures again.
 */
export function useModelNameShort(
  bar: HTMLElement | null,
  name: string,
): boolean {
  const [shortFor, setShortFor] = useState<string | null>(null);
  // The bar width the full name needs, once it has been taken away.
  const needed = useRef<{ name: string; width: number } | null>(null);

  useEffect(() => {
    if (!bar || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const held = needed.current?.name === name ? needed.current : null;
      if (held) {
        if (bar.clientWidth >= held.width) {
          needed.current = null;
          setShortFor(null);
        }
        return;
      }
      const facts = bar.querySelector(".ai-chatbar-facts");
      const lack = Math.max(
        bar.scrollWidth - bar.clientWidth,
        facts ? facts.scrollWidth - facts.clientWidth : 0,
      );
      if (lack <= 0) return;
      needed.current = { name, width: bar.clientWidth + lack + 1 };
      setShortFor(name);
    };
    // The bar's box follows the dock; its parts change size as a reading
    // arrives or loses its words, which the bar's own box does not show.
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    for (const part of bar.children) ro.observe(part);
    measure();
    return () => ro.disconnect();
  }, [bar, name]);

  return shortFor === name;
}
