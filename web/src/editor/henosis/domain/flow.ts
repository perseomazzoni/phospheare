// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The Henosis flow. Henosis mode takes the room away slowly while the writer
// writes, and gives it back the moment they stop. Its whole behaviour is this
// pure state machine; `useHenosis.ts` only listens, keeps one timer and
// writes one attribute.
//
//   off ──type──▶ warming ──Y of writing──▶ fading ──X──▶ full
//    ▲                │                        │              │
//    └────── a pause longer than P, a hand, Escape, a stand-down
//
// - Three numbers belong to the writer: Y (`afterMs`), how long they
//   write before the fade begins; X (`fadeMs`), how long the fade takes; P
//   (`pauseMs`), how long a pause in the writing ends the mode. Each is whole
//   seconds from 0 to 10. 0 for Y means the fade begins with the first
//   keystroke.
// - The pause has a floor of one second (`PAUSE_FLOOR_MS`). A pause of 0
//   would end the mode between any two keystrokes, and with it the continuous
//   writing Y counts. A second is the gap between two words, not a stop, so
//   P = 0 reads as "as soon as I stop".
// - Continuous writing means no gap longer than the pause. A keystroke after
//   a longer gap starts a new burst, even when the timer that should have
//   ended the old one is late, as a backgrounded tab throttles timers to a
//   second or more.
// - X (`fadeMs`) runs from the moment the threshold is crossed to `full`,
//   where the dimmed things are gone and the prose widens. The fade itself is
//   the stylesheet's; the flow only knows when it ends. At 0 the room goes at
//   once.
// - The clock crosses the threshold, not a keystroke. A writer who pauses for
//   a breath as Y comes round has not stopped, and still crosses it; the
//   deadline exists for that.

export type HenosisState = "off" | "warming" | "fading" | "full";

/**
 * What can happen to the flow:
 * - `type`: a keystroke in the prose.
 * - `deadline`: the hook's one timer fired.
 * - `wake`: the writer reached for something: a hand on the mouse, Escape,
 *   focus leaving the prose.
 * - `standDown`: the editor opened something Henosis must not hide (find, a
 *   dialog, a running answer, a comparison).
 */
export type HenosisEvent = "type" | "deadline" | "wake" | "standDown";

export interface HenosisTiming {
  /** Y: writing this long starts the dim. */
  afterMs: number;
  /** X: how long the fade takes to reach full. */
  fadeMs: number;
  /** P: a pause this long ends the mode; `PAUSE_FLOOR_MS` is its floor. */
  pauseMs: number;
}

export interface HenosisFlow {
  state: HenosisState;
  /** When the current burst of writing began; null while off. */
  burstStart: number | null;
  /** The last keystroke; null while off. */
  lastType: number | null;
  /** When the fade began; null before it has. */
  fadeStart: number | null;
}

/** The shortest pause that ends the mode, whatever P says. */
export const PAUSE_FLOOR_MS = 1000;

/** How long a gap in the writing is before it is a stop. */
const pauseOf = (timing: HenosisTiming) =>
  Math.max(timing.pauseMs, PAUSE_FLOOR_MS);

export const HENOSIS_OFF: HenosisFlow = {
  state: "off",
  burstStart: null,
  lastType: null,
  fadeStart: null,
};

/** A fresh burst, begun by a keystroke at `now`. */
const burst = (now: number): HenosisFlow => ({
  state: "warming",
  burstStart: now,
  lastType: now,
  fadeStart: null,
});

/** The next state of the flow; every event is answered in every state. */
export function step(
  flow: HenosisFlow,
  event: HenosisEvent,
  now: number,
  timing: HenosisTiming,
): HenosisFlow {
  if (event === "wake" || event === "standDown") return HENOSIS_OFF;
  const { afterMs, fadeMs } = timing;
  const pause = pauseOf(timing);

  if (event === "type") {
    if (flow.state === "off" || flow.lastType === null) return burst(now);
    // A gap longer than the pause was a stop, even if the timer fired late.
    if (now - flow.lastType > pause) return burst(now);
    return { ...flow, lastType: now };
  }

  // The deadline. Whichever of the flow's clocks has run out answers it; a
  // timer that fires early, or for a deadline that has since moved, changes
  // nothing.
  if (flow.state === "off" || flow.lastType === null) return flow;
  if (now - flow.lastType >= pause) return HENOSIS_OFF;
  if (
    flow.state === "warming" &&
    flow.burstStart !== null &&
    now - flow.burstStart >= afterMs
  )
    return { ...flow, state: "fading", fadeStart: now };
  if (
    flow.state === "fading" &&
    flow.fadeStart !== null &&
    now - flow.fadeStart >= fadeMs
  )
    return { ...flow, state: "full" };
  return flow;
}

/**
 * When the flow next changes on its own, or null when it waits for the writer.
 * The hook keeps one timer, set to this after every step.
 */
export function deadlineOf(
  flow: HenosisFlow,
  timing: HenosisTiming,
): number | null {
  if (flow.state === "off" || flow.lastType === null) return null;
  const pause = flow.lastType + pauseOf(timing);
  if (flow.state === "warming" && flow.burstStart !== null)
    return Math.min(pause, flow.burstStart + timing.afterMs);
  if (flow.state === "fading" && flow.fadeStart !== null)
    return Math.min(pause, flow.fadeStart + timing.fadeMs);
  return pause;
}
