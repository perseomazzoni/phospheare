// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  moduleImports,
  type ModuleImport,
} from "../../testing/moduleImports.fixture";

// Holds the open project's hexagon apart. Its domain is `src/project`, the
// structure, the properties and the pure rules over them, so the core may
// import that and nothing else outside itself:
//
//   application     the services and the store roles they declare
//                   (`application/stores.ts`): no storage, no React, no i18n
//   storageStores   the roles over a storage provider: only their types from
//                   the application, and never React or i18n
//
// The React provider that wires them, `ProjectContext.tsx`, stays where its
// consumers import it.
//
// Every rule reads a file's imports through `moduleImports`, so an import, a
// re-export, a dynamic `import()`, a `require` and a side-effect import all
// count, and a pattern matches the module's whole specifier.

const host = (name: string) => new RegExp(`^(?:.*\\/)?${name}(?:\\/.*)?$`);
const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.?\\/)+(?:${names.join("|")})(?:\\/.*)?$`);

const REACT = /^(?:react(?:-dom)?(?:\/.*)?|react-i18next)$/;
const I18N = /^i18next$/;

const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(([path]) => !path.endsWith(".test.ts"));

const APPLICATION = import.meta.glob("./application/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const STORES = import.meta.glob("./storageStores.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** A pattern over a module's specifier, or a test of the whole import. */
type Rule = RegExp | ((found: ModuleImport) => boolean);
const breaks = (rule: Rule, found: ModuleImport) =>
  rule instanceof RegExp ? rule.test(found.specifier) : rule(found);

/** A value import of a layer, where only its types may be taken. */
const valueImport = (name: string) => {
  const named = layer(name);
  return (found: ModuleImport) =>
    !found.typeOnly && named.test(found.specifier);
};

const CORE_FORBIDDEN: Rule[] = [
  host("storage"),
  host("auth"),
  host("webapp"),
  host("engine"),
  host("views"),
  layer("components", "tree", "reference"),
  host("(?:ai|assistant)"),
  layer("storageStores"),
  REACT,
  I18N,
];
const STORES_FORBIDDEN: Rule[] = [
  host("auth"),
  host("webapp"),
  host("(?:ai|assistant)"),
  valueImport("application"),
  REACT,
  I18N,
];

/** Each import in `files` that one of `rules` refuses. */
const offenders = (files: Record<string, string>, rules: Rule[]) =>
  raw(files).flatMap(([path, source]) =>
    moduleImports(source)
      .filter((found) => rules.some((rule) => breaks(rule, found)))
      .map(({ specifier, line }) => `${path}:${line} imports ${specifier}`),
  );
const reaches = (source: string, ...rules: Rule[]) =>
  offenders({ "sample.ts": source }, rules).length > 0;

describe("the open project's hexagonal boundary", () => {
  it("can tell an outward import from an inward one", () => {
    expect(
      reaches(
        `import type { ProjectRef } from "../../../storage";`,
        CORE_FORBIDDEN[0],
      ),
    ).toBe(true);
    expect(
      reaches(`import { x } from "../storageStores";`, CORE_FORBIDDEN[7]),
    ).toBe(true);
    expect(reaches(`import { useState } from "react";`, REACT)).toBe(true);
    expect(
      reaches(
        `import type { MetadataStore } from "./stores";`,
        CORE_FORBIDDEN[7],
      ),
    ).toBe(false);
    expect(
      reaches(
        `import type { MetadataStore } from "./application/stores";`,
        valueImport("application"),
      ),
    ).toBe(false);
    expect(
      reaches(
        `import { openProject } from "./application/projectOpener";`,
        valueImport("application"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import type { Snapshot } from "../../../project/types";`,
        CORE_FORBIDDEN[0],
      ),
    ).toBe(false);
    // A dynamic import and a require reach as surely as a static import.
    expect(
      reaches(`const m = await import("../../../storage");`, ...CORE_FORBIDDEN),
    ).toBe(true);
    expect(reaches(`const m = require("react");`, ...STORES_FORBIDDEN)).toBe(
      true,
    );
    expect(
      reaches(
        `const m = await import("./application/projectOpener");`,
        valueImport("application"),
      ),
    ).toBe(true);
  });

  it("finds every layer's files, so no rule passes over an empty glob", () => {
    for (const files of [APPLICATION, STORES])
      expect(raw(files).length).toBeGreaterThan(0);
  });

  it("keeps the core on the domain alone: no storage, the editor, React or i18n", () => {
    expect(offenders(APPLICATION, CORE_FORBIDDEN)).toEqual([]);
  });

  it("keeps the stores below the services and away from React", () => {
    expect(offenders(STORES, STORES_FORBIDDEN)).toEqual([]);
  });
});
