// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../../testing/moduleImports.fixture";

// Holds Henosis's hexagon apart, with the same gate the export keeps
// (`export/boundaries.test.ts`) at Henosis's size:
//
//   domain        pure: the flow and its deadlines; no DOM, no timers, no
//                 React, nothing outside itself
//   caretAnchor   the DOM it has to touch (the caret's line), never React
//   useHenosis    the hook: it listens, keeps the timer and writes the
//                 attribute, and as the module's composition root it may
//                 reach the caret's anchor directly, with no host between
//
// The import rules read a file's imports through `moduleImports`, so an
// import, a re-export, a dynamic `import()`, a `require` and a side-effect
// import all count, and each pattern matches the module's specifier. The
// self-check proves each pattern bites, because a pattern that never
// matches passes every file vacuously.

const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.?\\/)+(?:${names.join("|")})(?:\\/.*)?$`);
const REACT = /^(?:react(?:-dom)?(?:\/.*)?|react-i18next)$/;
/** Anything that leaves the module: a path climbing two levels or more. */
const OUTSIDE = /^(?:\.\.\/){2,}/;
/** A browser global, or the clock: neither belongs in a pure flow. */
const IMPURE =
  /\b(document|window|setTimeout|requestAnimationFrame|performance|Date\.now)\b/;

const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(
    ([path]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"),
  );

const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const CARET = import.meta.glob("./caretAnchor.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const HOOK = import.meta.glob("./useHenosis.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** Strip comments, so the prose explaining a rule is not its first offender. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Each import whose module one of `imports` names, and each file whose code
 * one of `codes` matches.
 */
const offenders = (
  files: Record<string, string>,
  imports: RegExp[],
  codes: RegExp[] = [],
) =>
  raw(files).flatMap(([path, source]) => [
    ...moduleImports(source)
      .filter(({ specifier }) => imports.some((p) => p.test(specifier)))
      .map(({ specifier, line }) => `${path}:${line} imports ${specifier}`),
    ...(codes.some((p) => p.test(code(source))) ? [path] : []),
  ]);
const reaches = (source: string, ...imports: RegExp[]) =>
  offenders({ "sample.ts": source }, imports).length > 0;

describe("Henosis's hexagonal boundary", () => {
  it("can tell an outward import from an inward one", () => {
    expect(
      reaches(
        `import { x } from "../caretAnchor";`,
        layer("caretAnchor", "useHenosis"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "./domain/flow";`,
        layer("caretAnchor", "useHenosis"),
      ),
    ).toBe(false);
    expect(reaches(`import { x } from "../../views/engine";`, OUTSIDE)).toBe(
      true,
    );
    expect(reaches(`import { x } from "./flow";`, OUTSIDE)).toBe(false);
    expect(reaches(`import { useRef } from "react";`, REACT)).toBe(true);
    expect(`const now = performance.now();`).toMatch(IMPURE);
    expect(`const deadline = 5;`).not.toMatch(IMPURE);
    // A dynamic import and a require reach as surely as a static import.
    expect(
      reaches(`const m = await import("../useHenosis");`, layer("useHenosis")),
    ).toBe(true);
    expect(reaches(`const m = require("react-dom");`, REACT)).toBe(true);
  });

  it("finds every layer's files, so no rule passes over an empty glob", () => {
    for (const files of [DOMAIN, CARET, HOOK])
      expect(raw(files).length).toBeGreaterThan(0);
  });

  it("keeps the domain pure: nothing outward, no React, no DOM, no clock", () => {
    expect(
      offenders(
        DOMAIN,
        [layer("caretAnchor", "useHenosis"), OUTSIDE, REACT],
        [IMPURE],
      ),
    ).toEqual([]);
  });

  it("keeps the caret's anchor off React and out of the hook", () => {
    expect(offenders(CARET, [layer("useHenosis"), REACT])).toEqual([]);
  });
});
