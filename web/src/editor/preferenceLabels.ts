// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The one name for each preference value. The control labels the choice with
// it and the "for this project only" toast names what the writer chose, so
// one source keeps the two from disagreeing. The settings sheet's editor pane
// and the project's panel on the tree both draw these rows.
//
// The module is pure, with no engine and no React, and the webapp imports it
// as a leaf, which keeps the lazy half out of the shell's bundle. Do not move
// it to `project/` or a new shared folder.

import type { FocusMode, ProseSize } from "../project/types";

/** Focus modes as locale keys, not words. */
export const FOCUS_LABEL: Record<FocusMode, string> = {
  off: "tree.focusOff",
  line: "tree.focusLine",
  paragraph: "tree.focusParagraph",
};

/** Small, Medium or Large as a locale key, never the pixel count. */
export function proseSizeLabel(size: ProseSize): string {
  return size === 17
    ? "tree.proseSizeSmall"
    : size === 19
      ? "tree.proseSizeMedium"
      : "tree.proseSizeLarge";
}

/** Already translated, unlike the two above: it interpolates a number. */
export function delayLabel(delay: number, t: (key: string) => string): string {
  return delay < 60
    ? `${delay} ${t("tree.autosaveSec")}`
    : `${delay / 60} ${t("tree.autosaveMin")}`;
}
