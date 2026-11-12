// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { WritingViewProps } from "./port";

/** The pixels a view draws the prose at: the scale's for the step, or the step. */
export function prosePixels(
  props: Pick<WritingViewProps, "proseSize" | "proseScale">,
): number {
  return props.proseScale?.[props.proseSize] ?? props.proseSize;
}
