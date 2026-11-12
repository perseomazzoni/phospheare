// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../../testing/moduleImports.fixture";

// Holds the frame's decorations apart, as `henosis/boundaries.test.ts` does:
//
//   domain        pure: the reveal's holds, the running head, the spine's
//                 rules; no DOM, no timers of its own, no React, nothing
//                 outside itself but the book's own model
//                 (`project/structure`, `project/types`) and the spine's
//                 drawing (`ui/spineLayout`), both pure
//   presentation  the hook and the marks: it listens, runs the clock and
//                 writes the attribute; the running head, the folio and the
//                 spine's rules
//
// Neither reads the theme: `EditorRoute` asks the theme's port for the
// decorations and hands the answer down.
//
// The import rules read a file's imports through `moduleImports`, so an
// import, a re-export, a dynamic `import()`, a `require` and a side-effect
// import all count, and each pattern matches the module's specifier.

const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(([path]) => !/\.test\.tsx?$/.test(path));

const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const PRESENTATION = import.meta.glob("./presentation/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const REACT = /^react(?:-dom)?$/;
const OUTSIDE = /^(?:\.\.\/){2,}/;
/** Outside, but for the book's model and the spine's drawing, which are pure. */
const BEYOND_THE_BOOK =
  /^(?:\.\.\/){2,}(?!\.\.\/)(?!(?:project\/(?:structure|types)|ui\/spineLayout)$)/;
const PRESENTATION_IMPORT = /^\.\.\/presentation/;
const THEME = /theme\//;
/** Code, not an import: a browser global or the clock. */
const IMPURE =
  /\b(document|window|setTimeout|requestAnimationFrame|performance|Date\.now)\b/;

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

describe("Vision's editor pieces", () => {
  it("can tell each forbidden import when it sees one", () => {
    expect(reaches(`import { useEffect } from "react";`, REACT)).toBe(true);
    expect(reaches(`import { x } from "../../useNarrow";`, OUTSIDE)).toBe(true);
    expect(`setTimeout(run, 10)`).toMatch(IMPURE);
    expect(
      reaches(`import { x } from "../../../project/sync";`, BEYOND_THE_BOOK),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../project/structure";`,
        BEYOND_THE_BOOK,
      ),
    ).toBe(false);
    expect(
      reaches(`import { x } from "../../../ui/spineLayout";`, BEYOND_THE_BOOK),
    ).toBe(false);
    expect(
      reaches(`import { x } from "../../../ui/SpineGlyph";`, BEYOND_THE_BOOK),
    ).toBe(true);
    expect(reaches(`import { x } from "../../../theme/editor";`, THEME)).toBe(
      true,
    );
    // A dynamic import and a require reach as surely as a static import.
    expect(reaches(`const m = await import("react");`, REACT)).toBe(true);
    expect(reaches(`const m = require("../../../theme/editor");`, THEME)).toBe(
      true,
    );
    expect(reaches(`// import { x } from "../../useNarrow";`, OUTSIDE)).toBe(
      false,
    );
  });

  it("keeps the domain pure and inside itself", () => {
    expect(raw(DOMAIN).length).toBeGreaterThan(0);
    expect(
      offenders(
        DOMAIN,
        [REACT, BEYOND_THE_BOOK, PRESENTATION_IMPORT],
        [IMPURE],
      ),
    ).toEqual([]);
  });

  it("lets presentation reach only the domain, and never the theme", () => {
    expect(raw(PRESENTATION).length).toBeGreaterThan(0);
    expect(offenders(PRESENTATION, [OUTSIDE, THEME])).toEqual([]);
  });
});
