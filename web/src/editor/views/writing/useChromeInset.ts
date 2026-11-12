// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useEffect, useState } from "react";

import { chromeFromSpans, type StationChrome } from "./station";

// Measures the chrome for the station, which stays pure arithmetic, as
// `useKeyboardInset` hands it the keyboard. The read runs on a resize, never
// on a scroll or a keystroke.

/**
 * How many frames to wait for the chrome to finish mounting before measuring
 * whatever is there; two seconds at 60fps. The wait must end, or a part that
 * never arrives leaves a `requestAnimationFrame` chain running for the life
 * of the editor.
 */
const ATTACH_FRAMES = 120;

/**
 * The pieces of the floating chrome, read unscoped with
 * `document.querySelector`. A second `.titlebar` or `.bar-row` anywhere on
 * the page (a modal's own titlebar) would skew the station silently.
 */
const CHROME_PARTS = [".titlebar", ".bar-row"] as const;

function measure(surface: HTMLElement | null): StationChrome | null {
  if (!surface) return null;
  const box = surface.getBoundingClientRect();
  // A surface with no height has not been laid out: the answer is "no
  // measurement", not "no chrome", so the plane's declared fallback stands.
  if (box.height <= 0) return null;
  return chromeFromSpans(
    box,
    window.innerHeight,
    CHROME_PARTS.map((sel) =>
      document.querySelector(sel)?.getBoundingClientRect(),
    ),
  );
}

/**
 * The chrome covering `surface`, re-measured when anything about it changes
 * size, or `null` until there is a measurement, which tells the caller to
 * keep its plane's declared default.
 *
 * `surface` is a getter because the core reaches it through the editable's
 * `parentElement`, which is not stable across the first commit.
 */
export function useChromeInset(
  surface: () => HTMLElement | null,
): StationChrome | null {
  const [chrome, setChrome] = useState<StationChrome | null>(null);

  useEffect(() => {
    // No `ResizeObserver` means jsdom, with no layout to read; the caller
    // keeps its plane's declared chrome, which the unit tests measure against.
    if (typeof ResizeObserver === "undefined") return;

    let frame = 0;
    // Coalesced through a frame and set only when the numbers change: a
    // rotation fires the observer for every part on the same tick.
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure(surface());
        if (!next) return;
        setChrome((prev) =>
          prev && prev.top === next.top && prev.bottom === next.bottom
            ? prev
            : next,
        );
      });
    };

    const observer = new ResizeObserver(read);
    let attach = 0;
    let waited = 0;

    // The core can mount before the chrome does, and an observer attached to
    // part of the stack reports a chrome missing the rest, so attachment
    // waits for the whole stack. Presence, not height, is the condition: both
    // parts exist on both planes (the phone collapses its titlebar to zero),
    // so a null query means "not yet".
    const tryAttach = () => {
      const parts: (Element | null)[] = CHROME_PARTS.map((sel) =>
        document.querySelector(sel),
      );
      const ready = parts.filter((el): el is Element => el !== null);
      if (ready.length < parts.length && waited++ < ATTACH_FRAMES) {
        attach = requestAnimationFrame(tryAttach);
        return;
      }
      for (const el of ready) observer.observe(el);
      read();
    };

    // The insets are relative to the surface, so a surface that moves changes
    // both numbers without any piece of chrome changing.
    const el = surface();
    if (el) observer.observe(el);
    // The window resizes without resizing any observed box when only the
    // visual viewport moves.
    window.addEventListener("resize", read);
    tryAttach();

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(attach);
      observer.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [surface]);

  return chrome;
}
