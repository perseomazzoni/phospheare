// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Whether the page holds still: the writer asked for less motion. Every theme
// moves the same way, so the operating system's setting is the one question
// a surface that moves something by script asks, at the moment it would move
// it.

export function motionIsStill(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
