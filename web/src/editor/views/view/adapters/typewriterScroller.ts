// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The typewriter scroll strategy: the station machine's face to the port. A
// singleton because the station is one: one editor at a time.

import { station } from "../../writing/station";
import type { CaretPos, Scroller } from "../scrollStrategy";

export const typewriterScroller: Scroller = {
  /** The writing line goes back to the station, whatever the state. */
  hold(pos: CaretPos, surface: HTMLElement): boolean {
    return station.dock(surface, pos);
  },

  onCaretMove(pos: CaretPos | null, surface: HTMLElement): boolean {
    if (!pos) {
      station.release();
      return false;
    }
    return station.dock(surface, pos);
  },

  /** Released or off-station, the writer put the page where it is. */
  reflow(pos: CaretPos, surface: HTMLElement): boolean {
    return station.state === "docked" && station.dock(surface, pos);
  },

  noteScroll(): void {
    station.noteScroll();
  },

  noteWheel(): void {
    station.noteWheel();
  },

  /**
   * Never a free run, which would leave the caret bar floating over text it
   * does not belong to.
   */
  wheelPolicy(): "ratchet" {
    return "ratchet";
  },
};
