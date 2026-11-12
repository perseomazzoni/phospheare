// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Scrollbars shown while scrolling ─────────────────────────────────────────
//
// Under a theme whose scrollbars stand only while their area moves, each
// scroll shows the bar and holds it for `REVEAL_HOLD_MS` past the last scroll
// event, so a long scroll keeps one bar on the screen and a still area shows
// none. The reveal is keyed by the scroller, so two areas scrolled together
// each keep their own hold.

export const REVEAL_HOLD_MS = 1000;

/** The timers the reveal runs on: `setTimeout` in the page, fakes in a test. */
export interface RevealClock<Id> {
  set(run: () => void, ms: number): Id;
  clear(id: Id): void;
}

export interface Reveal<Target> {
  /** Shows `target`'s bar, or extends its hold when it is already shown. */
  touch(target: Target): void;
  /** Hides every bar still shown and cancels every hold. */
  dispose(): void;
}

/** `show` is called once when a bar appears and once when it goes. */
export function createReveal<Target, Id>(
  show: (target: Target, on: boolean) => void,
  clock: RevealClock<Id>,
  holdMs = REVEAL_HOLD_MS,
): Reveal<Target> {
  const holds = new Map<Target, Id>();
  return {
    touch(target) {
      const held = holds.get(target);
      if (held === undefined) show(target, true);
      else clock.clear(held);
      holds.set(
        target,
        clock.set(() => {
          holds.delete(target);
          show(target, false);
        }, holdMs),
      );
    },
    dispose() {
      for (const [target, id] of holds) {
        clock.clear(id);
        show(target, false);
      }
      holds.clear();
    },
  };
}
