// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { importedModules } from "../testing/moduleImports.fixture";

// `App.tsx` is the one file that knows both halves exist. The web application
// (landing page, Library, settings) loads up front, and the editor is lazy,
// because a visitor reading the homepage has no use for an engine and a
// document tree. One static import of the editor from the shelf undoes that
// silently: the build still passes, and the shelf gets heavier.
//
// The web application may name two editor modules, which carry nothing of the
// editor with them: `editor/path` (a link builder) and
// `editor/preferenceLabels` (words). It reaches anything larger only through
// the lazy entry points in `editorChunk.ts`: the editor itself, the export
// window a Library card opens, and the import window. A dynamic `import()` in
// the web application would be an unreviewed second entry point, so it is
// refused too.

const WEBAPP = import.meta.glob("./**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const ALLOWED = new Set(["editor/path", "editor/preferenceLabels"]);

/**
 * Every module a source reaches the editor through, in any form
 * `moduleImports` reads: an import, a re-export, a side-effect import, a
 * dynamic `import()` or a `require`.
 */
function editorImports(source: string): string[] {
  return importedModules(source)
    .filter((spec) => /^(?:\.\.?\/)+editor(?:\/.*)?$/.test(spec))
    .map((spec) => spec.replace(/^(?:\.\.?\/)+/, ""))
    .filter((target) => !ALLOWED.has(target));
}

const raw = Object.entries(WEBAPP).filter(
  ([path]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"),
);

describe("the web application's boundary with the editor", () => {
  it("can tell an entry point from a reach", () => {
    expect(
      editorImports(`import { projectPath } from "../../editor/path";`),
    ).toEqual([]);
    expect(editorImports(`import x from "../../editor/export";`)).toEqual([
      "editor/export",
    ]);
    expect(editorImports(`import Editor from "../editor";`)).toEqual([
      "editor",
    ]);
    expect(editorImports(`const m = import("../../editor/export");`)).toEqual([
      "editor/export",
    ]);
    // The lazy entry points live outside the editor, so naming them is allowed.
    expect(
      editorImports(`import { loadExport } from "../../editorChunk";`),
    ).toEqual([]);
    expect(
      editorImports(`import { loadImport } from "../../editorChunk";`),
    ).toEqual([]);
    expect(editorImports(`import x from "../../editor/import";`)).toEqual([
      "editor/import",
    ]);
    // A require, a side-effect import and a re-export reach it as surely; a
    // commented-out import does not.
    expect(editorImports(`const m = require("../../editor/export");`)).toEqual([
      "editor/export",
    ]);
    expect(editorImports(`import "../../editor/register";`)).toEqual([
      "editor/register",
    ]);
    expect(editorImports(`export { x } from "../../editor/export";`)).toEqual([
      "editor/export",
    ]);
    expect(editorImports(`// import x from "../../editor/export";`)).toEqual(
      [],
    );
  });

  it("finds the web application's files, so the rule never passes over nothing", () => {
    expect(raw.length).toBeGreaterThan(20);
  });

  it("reaches the editor only through its link builder, its words and the lazy entry points", () => {
    const offenders = raw.flatMap(([path, source]) =>
      editorImports(source).map((target) => `${path} → ${target}`),
    );
    expect(offenders).toEqual([]);
  });
});
