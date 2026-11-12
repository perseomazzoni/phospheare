// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
// Read through Vite rather than the filesystem, as `theme/contract.test.ts`
// does: this app has no Node types.
import BASE_CSS from "./base.css?raw";
import { EDITOR_CSS } from "../editor/editorSheets.fixture";
import WEBAPP_CSS from "../webapp/webapp.css?raw";

// The motion vocabulary is closed. Every animation answers a gesture within
// four durations and three curves, set out in the `:root` motion block of
// `base.css`; these rows keep that from being only prose. A literal `180ms`
// in one file and `200ms` in another is two guesses, and the result is an
// interface whose parts almost agree.
//
// The rule: a transition, and any animation that plays once, takes both its
// duration and its easing from a token.
//
// The exception: a loop and a linear fill state a literal rate. A caret
// blinks at the rate a caret blinks and a progress bar advances at the rate
// the work advances; their period is not a gesture's answer, unlike the 200ms
// a control takes to answer a press. So loops (`infinite`) and mechanical
// easings (`linear`, `steps()`) may carry numbers; nothing else may.
//
// A text scan rather than a parse. A walk of the CSS object model would need
// a real parser in the test environment and would still have to reason about
// shorthands; the failure guarded against is a typed number, which a text
// scan finds.

const SHEETS = [
  ["base.css", BASE_CSS],
  ["editor.css", EDITOR_CSS],
  ["webapp.css", WEBAPP_CSS],
] as const;

/** A declaration, with the line it sits on. */
interface Declaration {
  property: string;
  value: string;
  line: number;
}

/**
 * Every `transition*` / `animation*` declaration outside a `@keyframes` block.
 *
 * Keyframes are excluded because their percentages and their `from`/`to` are
 * not timings at all, and a `0%` inside one would otherwise read as a literal
 * duration.
 */
function timingDeclarations(css: string): Declaration[] {
  const out: Declaration[] = [];
  let inKeyframes = 0;
  let depth = 0;

  // Block comments go first, newlines kept so the reported line numbers still
  // point at the offending rule. A comment that mentions `200ms` would
  // otherwise fail the scan.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );

  source.split("\n").forEach((line, index) => {
    if (/@keyframes\b/.test(line)) inKeyframes = depth + 1;

    const match = line.match(
      /\b(transition|animation)(-[\w-]+)?\s*:\s*([^;}]+)/,
    );
    if (match && inKeyframes === 0) {
      out.push({
        property: match[1] + (match[2] ?? ""),
        value: match[3].trim(),
        line: index + 1,
      });
    }

    for (const char of line) {
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (inKeyframes > depth) inKeyframes = 0;
      }
    }
  });

  return out;
}

/** A literal duration: `200ms`, `1.4s`, `.3s`. Zero is not a timing choice. */
const DURATION = /(?:^|[\s,(])(?!0m?s\b)(\d*\.?\d+m?s)\b/;

/**
 * A delay is phase, not gesture. `.ui-dots` staggers its three dots by an
 * eighth and a quarter of its own loop; there is no design token for "a
 * quarter of the way round", and inventing one would be worse than the literal.
 * A delay may never carry a curve; the curve check still applies.
 */
const DELAY = /-delay$/;

/** A literal curve. `linear` and `steps()` are mechanical and stay legal. */
const CURVE =
  /\b(cubic-bezier\s*\(|ease-in-out|ease-out|ease-in|(?<!\w-)ease\b)/;

/** A loop states its own rate. */
const LOOPS = /\binfinite\b/;
const MECHANICAL = /\b(linear|steps\s*\()/;

describe("the motion vocabulary is closed", () => {
  it.each(SHEETS)("%s takes every duration from a token", (_name, css) => {
    const offenders = timingDeclarations(css)
      .filter(
        (d) =>
          !LOOPS.test(d.value) &&
          !MECHANICAL.test(d.value) &&
          !DELAY.test(d.property),
      )
      .filter((d) => DURATION.test(d.value))
      .map((d) => `${d.line}: ${d.property}: ${d.value}`);

    expect(offenders).toEqual([]);
  });

  it.each(SHEETS)("%s takes every easing from a token", (_name, css) => {
    const offenders = timingDeclarations(css)
      .filter((d) => !LOOPS.test(d.value) && !MECHANICAL.test(d.value))
      .filter((d) => CURVE.test(d.value))
      .map((d) => `${d.line}: ${d.property}: ${d.value}`);

    expect(offenders).toEqual([]);
  });

  // The bare curves exist as tokens because `--t` and its siblings carry a
  // duration and a curve, so pairing one with `--e-out` produces two timing
  // functions and the browser drops the whole shorthand. Nothing fails,
  // nothing warns, and the animation never runs.
  it.each(SHEETS)(
    "%s never pairs a --t token with a bare curve",
    (_name, css) => {
      const offenders = timingDeclarations(css)
        .filter(
          (d) =>
            /var\(--t[-\w]*\)/.test(d.value) &&
            /var\(--e-[\w-]+\)/.test(d.value),
        )
        .map((d) => `${d.line}: ${d.property}: ${d.value}`);

      expect(offenders).toEqual([]);
    },
  );

  // The same trap the other way round: `--d-stagger` is a delay and carries
  // no curve, so it is the one token that may sit beside `--t-tap`, but never
  // beside a second easing.
  it.each(SHEETS)("%s never gives a delay token a curve", (_name, css) => {
    const offenders = timingDeclarations(css)
      .filter((d) => /var\(--d-[\w-]+\)\s+var\(--e-/.test(d.value))
      .map((d) => `${d.line}: ${d.property}: ${d.value}`);

    expect(offenders).toEqual([]);
  });
});
