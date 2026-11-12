// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins a cleared banner in the stylesheet text, because jsdom runs no CSS.
// A failed answer whose key is ready again flips in place: the strip
// turns `quiet` and its button turns `soft`, so the writer sees they can go
// ahead without reading the sentence. The strip's colours are pinned here;
// that the strip and its button keep their size as they flip is measured in
// a browser (`e2e/kit-states.spec.ts`).

import { describe, expect, it } from "vitest";
import BASE from "./base.css?raw";
import SHARED from "../theme/themes/shared.css?raw";
import MATTE from "../theme/themes/matte/theme.css?raw";

const flat = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
/**
 * A rule as Matte wears it: the frame's declarations, then the shared paint,
 * then Matte's own.
 */
const rule = (selector: string) =>
  [BASE, SHARED, MATTE]
    .map(
      (css) =>
        new RegExp(
          `(?:^|\\}) ?${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`,
        ).exec(flat(css))?.[1] ?? "",
    )
    .join(" ");

describe("a banner whose condition has cleared", () => {
  it("drops every colour and keeps the box", () => {
    const quiet = rule(".ui-banner-quiet");
    // The hairline is the box, not a colour: the tone leaves the neutral
    // border of `.ui-banner` alone. Blanked to transparent, the strip has no
    // edge.
    expect(quiet).not.toContain("border-color");
    expect(rule(".ui-banner")).toContain("border: 1px solid;");
    expect(rule(".ui-banner")).toContain("border-color: var(--hair)");
    expect(quiet).toContain("background: transparent");
    expect(quiet).toContain("color: var(--ink-3)");
    // Padding and border width belong to `.ui-banner` alone: a tone that set
    // its own would move the strip as it flipped.
    expect(quiet).not.toMatch(/padding|border-width|border:/);
  });
});
