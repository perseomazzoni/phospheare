// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../../testing/moduleImports.fixture";

// Holds the workspace's pieces apart from the shell they came out of:
//
//   domain    the pure rules: the project's domain and nothing else, so no
//             storage, the editor's components, React or i18n, and none of
//             the workspace's own outer files
//   modules   the plain files beside the hooks (`draftKeeper.ts`): storage
//             through its port, but never React or i18n
//   hooks     the `use*` files, which wire the rest to React
//   views     the `.tsx` components the shell renders
//
// No file here imports the shell, `EditorRoute.tsx`: the shell imports the
// workspace, never the reverse.
//
// Every rule reads a file's imports through `moduleImports`, so an import, a
// re-export, a dynamic `import()`, a `require` and a side-effect import all
// count, and a pattern matches the module's whole specifier.

const host = (name: string) => new RegExp(`^(?:.*\\/)?${name}(?:\\/.*)?$`);
/** A folder of the editor itself, reached only by climbing out of here. */
const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.\\/)+(?:${names.join("|")})(?:\\/.*)?$`);

const REACT = /^(?:react(?:-dom)?(?:\/.*)?|react-i18next)$/;
const I18N = /^i18next$/;
/** One step up and no further: a workspace file beside `domain/`. */
const WORKSPACE_OUTER = /^\.\.\/(?!\.\.\/)/;

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(([path]) => !isTest(path));

const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const OUTER = import.meta.glob("./*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const MODULES = Object.fromEntries(
  Object.entries(OUTER).filter(
    ([path]) => path.endsWith(".ts") && !/^\.\/use[A-Z]/.test(path),
  ),
);
const EVERY = { ...DOMAIN, ...OUTER };

const DOMAIN_FORBIDDEN = [
  host("storage"),
  host("auth"),
  host("webapp"),
  host("engine"),
  host("views"),
  layer("components", "tree", "reference"),
  host("services"),
  WORKSPACE_OUTER,
  REACT,
  I18N,
];
const MODULE_FORBIDDEN = [REACT, I18N];
const SHELL = host("EditorRoute");

/** Each import in `files` whose module one of `patterns` names. */
const offenders = (files: Record<string, string>, patterns: RegExp[]) =>
  raw(files).flatMap(([path, source]) =>
    moduleImports(source)
      .filter(({ specifier }) => patterns.some((p) => p.test(specifier)))
      .map(({ specifier, line }) => `${path}:${line} imports ${specifier}`),
  );
const reaches = (source: string, ...patterns: RegExp[]) =>
  offenders({ "sample.ts": source }, patterns).length > 0;

describe("the workspace's boundaries", () => {
  it("can tell an outward import from an inward one", () => {
    expect(
      reaches(`import { x } from "../draftKeeper";`, WORKSPACE_OUTER),
    ).toBe(true);
    expect(
      reaches(`import { x } from "../../../project/naming";`, WORKSPACE_OUTER),
    ).toBe(false);
    expect(
      reaches(
        `import { x } from "../reference/referenceWrite";`,
        layer("components", "tree", "reference"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../tree/DocumentTree";`,
        layer("components", "tree", "reference"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../project/reference";`,
        layer("components", "tree", "reference"),
      ),
    ).toBe(false);
    expect(reaches(`import { Workspace } from "../EditorRoute";`, SHELL)).toBe(
      true,
    );
    expect(reaches(`import { useState } from "react";`, REACT)).toBe(true);
    // A dynamic import and a require reach as surely as a static import.
    expect(reaches(`const m = await import("../EditorRoute");`, SHELL)).toBe(
      true,
    );
    expect(reaches(`const m = require("react");`, ...MODULE_FORBIDDEN)).toBe(
      true,
    );
    expect(reaches(`// import "react";`, ...MODULE_FORBIDDEN)).toBe(false);
  });

  it("finds every layer's files, so no rule passes over an empty glob", () => {
    for (const files of [DOMAIN, MODULES, OUTER])
      expect(raw(files).length).toBeGreaterThan(0);
  });

  it("keeps the domain on the project's rules alone", () => {
    expect(offenders(DOMAIN, DOMAIN_FORBIDDEN)).toEqual([]);
  });

  it("keeps the plain modules away from React", () => {
    expect(offenders(MODULES, MODULE_FORBIDDEN)).toEqual([]);
  });

  it("never reaches back into the shell", () => {
    expect(offenders(EVERY, [SHELL])).toEqual([]);
  });
});
