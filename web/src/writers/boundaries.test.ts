// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../testing/moduleImports.fixture";

// Pins the writers module's layers. A layer that imports the one outside it
// still compiles, so the rules are read from the source text, as in
// `fault/boundaries.test.ts`:
//
// - the domain is pure: no other layer and no React, only the platform's
//   shared types; it states what a registry of accounts must do;
// - the application reaches the registry only through that interface: no
//   `registry.ts`, no React;
// - `registry.ts` implements the interface over the domain alone.

const raw = (files: Record<string, unknown>) => files as Record<string, string>;

const DOMAIN = raw(
  import.meta.glob(["./domain/**/*.ts", "!./domain/**/*.test.ts"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);
const APPLICATION = raw(
  import.meta.glob(["./application/**/*.ts", "!./application/**/*.test.ts"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);
const REGISTRY = raw(
  import.meta.glob("./registry.ts", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);

function offending(
  files: Record<string, string>,
  allowed: (path: string) => boolean,
): string[] {
  return Object.entries(files).flatMap(([file, source]) =>
    moduleImports(source)
      .filter(({ specifier }) => !allowed(specifier))
      .map(({ specifier, line }) => `${file}:${line} imports ${specifier}`),
  );
}

describe("writers boundaries", () => {
  it("sees every form a module is named in", () => {
    const local = (path: string) => path.startsWith("./");
    for (const source of [
      `const m = await import("../registry");`,
      `const m = require("react");`,
      `import "../registry";`,
      `export { x } from "../registry";`,
    ])
      expect(offending({ "a.ts": source }, local), source).toHaveLength(1);
    expect(
      offending(
        { "a.ts": `// import "react";\nimport { x } from "./x";` },
        local,
      ),
    ).toEqual([]);
  });

  it("keeps the domain pure", () => {
    expect(Object.keys(DOMAIN).length).toBeGreaterThan(0);
    expect(
      offending(
        DOMAIN,
        (p) => p.startsWith("./") || p === "../../platform/types",
      ),
    ).toEqual([]);
  });

  it("keeps the application off the registry and React", () => {
    expect(Object.keys(APPLICATION).length).toBeGreaterThan(0);
    expect(
      offending(
        APPLICATION,
        (p) =>
          !/(?:^|\/)registry$/.test(p) &&
          p !== "react" &&
          !p.startsWith("react-"),
      ),
    ).toEqual([]);
  });

  it("builds the registry on the domain alone", () => {
    expect(Object.keys(REGISTRY)).toHaveLength(1);
    expect(offending(REGISTRY, (p) => p.startsWith("./domain/"))).toEqual([]);
  });
});
