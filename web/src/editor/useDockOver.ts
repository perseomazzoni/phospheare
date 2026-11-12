// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";

// Whether the open Dock covers the measure, for the themes to select on as
// `data-dock-over`. `editor.css` works it out (`--dock-over`) from the same
// arithmetic that places the measure, so this hook measures nothing: it reads
// the resolved length back whenever that arithmetic's inputs move, the
// window's size, the shell's attributes and inline widths, and the page's
// theme and comment form.
//
// The answer holds while the Dock is closed, where `--dock-over` reads 0px,
// so a Dock fading out keeps the face it had. `settled` turns true two
// frames after the Dock opens, once its first face has been drawn: a theme
// eases the switch between faces only then, so a Dock that opens over the
// measure appears in its face rather than easing into it.

/** The shell's attributes and inline widths `--dock-over` is computed from. */
const INPUTS = [
  "data-dock",
  "data-henosis",
  "data-margin",
  "data-narrow",
  "data-rail",
  "data-timeline",
  "style",
];

/** The page's attributes that change the measure: a theme, the notes. */
const PAGE_INPUTS = ["data-theme", "data-comments"];

export function useDockOver(shell: React.RefObject<HTMLElement | null>): {
  over: boolean;
  settled: boolean;
} {
  const [over, setOver] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    let open = false;
    let frame = 0;
    const read = () => {
      const now = el.dataset.dock === "1";
      if (now)
        setOver(
          parseFloat(getComputedStyle(el).getPropertyValue("--dock-over")) >
            0.5,
        );
      if (now === open) return;
      open = now;
      cancelAnimationFrame(frame);
      setSettled(false);
      if (now)
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => setSettled(true));
        });
    };
    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(read)
        : null;
    mo?.observe(el, { attributes: true, attributeFilter: INPUTS });
    mo?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: PAGE_INPUTS,
    });
    window.addEventListener("resize", read);
    read();
    return () => {
      mo?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", read);
    };
  }, [shell]);

  return { over, settled };
}
