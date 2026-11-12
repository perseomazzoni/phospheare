// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useCallback, useEffect, useRef, useState } from "react";

// ── What the landing page has reached ────────────────────────────────────────
//
// One IntersectionObserver per hook, never a scroll listener: the page's
// motion is class toggles on tokens (`webapp.css`, the landing page), so
// scrolling runs no script. Without an observer (a test, an old browser)
// everything counts as reached, so nothing is left hidden.

/**
 * A ref for an element, and whether it has come into view. `once` keeps it
 * reached after it leaves, for a reveal; without it the answer follows the
 * element in and out, for a loop that runs only while it is seen. `initially`
 * is the answer before the observer's first report, for an element that is
 * on screen when the page opens.
 */
export function useInView<T extends Element>({
  once = true,
  margin = "0px 0px -12% 0px",
  initially = false,
} = {}): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [seen, setSeen] = useState(
    () => initially || typeof IntersectionObserver === "undefined",
  );
  const done = useRef(false);

  useEffect(() => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (done.current) return;
        setSeen(entry.isIntersecting);
        if (once && entry.isIntersecting) {
          done.current = true;
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, once, margin]);

  return [useCallback((next: T | null) => setNode(next), []), seen];
}

/** The attribute the stylesheet reveals on: present once reached. */
export function shown(seen: boolean): { "data-shown"?: "" } {
  return seen ? { "data-shown": "" } : {};
}
