// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  FIGURE_PATH,
  MARK_HEIGHT,
  MARK_WIDTH,
  SPARK_AT,
  SPARK_PATH,
} from "./mark";
import { HOLE_PATH } from "./mark";

// `BrandMark` with its spark going out, for a page drawn before React runs:
// the same elements and classes, so `webapp.css` paints and animates both
// alike. Built from DOM calls, because Trusted Types refuse markup
// handed to `innerHTML`.

const SVG = "http://www.w3.org/2000/svg";

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, String(value));
  return element;
}

/** The broken figure at `size` pixels high, hidden from assistive tech. */
export function brokenMarkElement(size: number): SVGSVGElement {
  const hole = "brand-mark-hole-boot";
  const at = `translate(${SPARK_AT[0]} ${SPARK_AT[1]})`;

  const svg = node("svg", {
    class: "brand-mark brand-mark-out",
    viewBox: `0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`,
    width: (size * MARK_WIDTH) / MARK_HEIGHT,
    height: size,
    "aria-hidden": "true",
    focusable: "false",
  });

  const mask = node("mask", {
    id: hole,
    maskUnits: "userSpaceOnUse",
    x: 0,
    y: 0,
    width: MARK_WIDTH,
    height: MARK_HEIGHT,
  });
  const placed = node("g", { transform: at });
  placed.append(
    node("path", {
      class: "brand-mark-hole",
      "fill-rule": "evenodd",
      fill: "black",
      d: HOLE_PATH,
    }),
  );
  mask.append(
    node("rect", { width: MARK_WIDTH, height: MARK_HEIGHT, fill: "white" }),
    placed,
  );
  const defs = node("defs", {});
  defs.append(mask);

  svg.append(
    defs,
    node("path", {
      class: "brand-mark-figure",
      "fill-rule": "evenodd",
      d: FIGURE_PATH,
      mask: `url(#${hole})`,
    }),
    node("path", {
      class: "brand-mark-spark",
      "fill-rule": "evenodd",
      transform: at,
      d: SPARK_PATH,
    }),
  );
  return svg;
}
