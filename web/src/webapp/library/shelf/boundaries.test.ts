// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../../../testing/moduleImports.fixture";

// Holds the shelf's pieces apart:
//
//   domain   the pure rules: no React, no i18n, and at run time only the
//            pure helpers listed in DOMAIN_RUNTIME; types may come from
//            anywhere
//   modules  the plain classes beside it (`syncMarks.ts`, `shelf.ts`):
//            storage and the profile as they are, but never React or i18n;
//            the hook reads them through `subscribe` and `snapshot`
//
// No file here imports the hook, `useProjects.ts`: the hook imports the
// shelf, never the reverse.

const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(([path]) => !isTest(path));

const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const MODULES = import.meta.glob("./*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const EVERY = import.meta.glob("./**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/**
 * Every module a file imports at run time, in any form `moduleImports` reads;
 * an import or re-export of types alone is left out.
 */
function runtimeImports(source: string): string[] {
  return moduleImports(source)
    .filter((found) => !found.typeOnly)
    .map((found) => found.specifier);
}

const DOMAIN_RUNTIME = [
  /^\.\/[\w]+$/,
  /\/profile\/library$/,
  /\/project\/refIdentity$/,
  /\/storage\/types$/,
];

describe("the shelf's boundaries", () => {
  it("can tell a runtime import from a type import", () => {
    expect(runtimeImports(`import type { A } from "react";`)).toEqual([]);
    expect(runtimeImports(`export type { A } from "react";`)).toEqual([]);
    expect(
      runtimeImports(`import {\n  a,\n  type B,\n} from "../x/library";`),
    ).toEqual(["../x/library"]);
    expect(runtimeImports(`const m = await import("react");`)).toEqual([
      "react",
    ]);
    expect(runtimeImports(`const m = require("i18next");`)).toEqual([
      "i18next",
    ]);
    expect(runtimeImports(`import "react-dom";`)).toEqual(["react-dom"]);
    expect(runtimeImports(`// import { a } from "react";`)).toEqual([]);
  });

  it("finds every layer's files, so no rule passes over an empty glob", () => {
    expect(raw(DOMAIN).length).toBeGreaterThan(0);
    expect(raw(MODULES).length).toBeGreaterThan(0);
  });

  it("keeps the plain modules away from React and i18n", () => {
    const offenders = raw(MODULES).flatMap(([path, source]) =>
      runtimeImports(source)
        .filter((spec) =>
          /^(?:react(?:-dom)?|react-i18next|i18next)(?:\/|$)/.test(spec),
        )
        .map((spec) => `${path} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the domain on pure helpers alone", () => {
    const offenders = raw(DOMAIN).flatMap(([path, source]) =>
      runtimeImports(source)
        .filter((spec) => !DOMAIN_RUNTIME.some((allowed) => allowed.test(spec)))
        .map((spec) => `${path} -> ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  it("never reaches back into the hook", () => {
    const offenders = raw(EVERY).flatMap(([path, source]) =>
      moduleImports(source)
        .filter(({ specifier }) => /useProjects$/.test(specifier))
        .map(({ specifier }) => `${path} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});
