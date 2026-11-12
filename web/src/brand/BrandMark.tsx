// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useId } from "react";
import {
  FIGURE_PATH,
  MARK_HEIGHT,
  MARK_WIDTH,
  SPARK_AT,
  SPARK_PATH,
} from "./mark";
import { HOLE_PATH } from "./mark";

interface BrandMarkProps {
  /** The mark's height in pixels; its width follows the traced frame. */
  size?: number;
  /** False draws the figure alone, for the splash that lights it. */
  spark?: boolean;
  /**
   * The spark dims and goes out, and leaves its core as a hole in the chest:
   * the mark of a page where something broke.
   */
  out?: boolean;
}

/**
 * The brand's figure with the spark at its chest. No theme paints
 * it. Its two colours come from `.brand-mark` in `webapp.css`, which picks a
 * night or day pair from the page's colour scheme alone, so the figure stays
 * readable on either ground.
 */
export function BrandMark({
  size = 32,
  spark = true,
  out = false,
}: BrandMarkProps) {
  // One mask per mark: two broken marks on a page must not share a cut.
  const hole = `brand-mark-hole-${useId()}`;
  const at = `translate(${SPARK_AT[0]} ${SPARK_AT[1]})`;

  return (
    <svg
      className={out ? "brand-mark brand-mark-out" : "brand-mark"}
      viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
      width={(size * MARK_WIDTH) / MARK_HEIGHT}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {out && (
        <defs>
          <mask
            id={hole}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={MARK_WIDTH}
            height={MARK_HEIGHT}
          >
            <rect width={MARK_WIDTH} height={MARK_HEIGHT} fill="white" />
            {/* A group carries the placement, so the animation's own
                transform on the path scales it in place. */}
            <g transform={at}>
              <path
                className="brand-mark-hole"
                fillRule="evenodd"
                fill="black"
                d={HOLE_PATH}
              />
            </g>
          </mask>
        </defs>
      )}
      <path
        className="brand-mark-figure"
        fillRule="evenodd"
        d={FIGURE_PATH}
        mask={out ? `url(#${hole})` : undefined}
      />
      {(spark || out) && (
        <path
          className="brand-mark-spark"
          fillRule="evenodd"
          transform={at}
          d={SPARK_PATH}
        />
      )}
    </svg>
  );
}
