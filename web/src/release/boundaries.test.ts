// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  moduleImports,
  type ModuleImport,
} from "../testing/moduleImports.fixture";

// Pins the release module's layers. A layer that imports the one outside it
// still compiles, so the rules are read from the source text, as in
// `fault/boundaries.test.ts`:
//
// - the domain is pure: no other layer, no React, no browser globals;
// - the application is plain rules, and it states what it needs of the feed
//   and the device's memory as interfaces of its own: no React, no browser
//   globals, no implementation;
// - `githubReleases.ts` and `localReleaseMemory.ts` implement those
//   interfaces, take only their types from the application, and import no
//   page;
// - the notice (`ReleaseNotice.tsx`) reaches the implementations only
//   through `compose.ts`;
// - the rest of the app imports `index.ts` and nothing inside it.
//
// The import rules read a file's imports through `moduleImports`, so an
// import, a re-export, a dynamic `import()`, a `require` and a side-effect
// import all count, and each pattern matches the module's specifier.

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
const IMPLEMENTATIONS = raw(
  import.meta.glob(["./githubReleases.ts", "./localReleaseMemory.ts"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);
const NOTICE = raw(
  import.meta.glob("./ReleaseNotice.tsx", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);
/** Every source file of the app outside this module. */
const OUTSIDE = raw(
  import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!./**"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);

/** A sibling layer, imported bare or by a subpath, at any depth of `../`. */
const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.?\\/)+(?:${names.join("|")})(?:\\/.*)?$`);
const REACT = /^react(?:-dom|-router)?$/;
/** A value import, which a file that may take only types must not hold. */
const VALUE_IMPORT = (name: string) => {
  const named = layer(name);
  return (found: ModuleImport) =>
    !found.typeOnly && named.test(found.specifier);
};
/** A member read from a browser global; a sentence ending "window." is not one. */
const BROWSER = /\b(?:window|document|navigator|sessionStorage)\.\w/;

/** A pattern over a module's specifier, or a test of the whole import. */
type Rule = RegExp | ((found: ModuleImport) => boolean);
const breaks = (rule: Rule, found: ModuleImport) =>
  rule instanceof RegExp ? rule.test(found.specifier) : rule(found);
const reaches = (source: string, rule: Rule) =>
  moduleImports(source).some((found) => breaks(rule, found));

function expectNone(
  files: Record<string, string>,
  imports: Rule[],
  codes: RegExp[] = [],
) {
  expect(Object.keys(files).length).toBeGreaterThan(0);
  for (const [file, source] of Object.entries(files)) {
    const refused = moduleImports(source)
      .filter((found) => imports.some((rule) => breaks(rule, found)))
      .map(({ specifier, line }) => `${file}:${line} imports ${specifier}`);
    expect(refused).toEqual([]);
    for (const pattern of codes)
      expect(source, `${file} must not match ${pattern}`).not.toMatch(pattern);
  }
}

describe("the release hexagon", () => {
  it("can tell each forbidden import when it sees one", () => {
    expect(
      reaches(`import { releaseCheck } from "../compose";`, layer("compose")),
    ).toBe(true);
    expect(
      reaches(
        `import { githubReleases } from "../githubReleases";`,
        layer("githubReleases"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import type { Release } from "./application/checkForRelease";`,
        VALUE_IMPORT("application"),
      ),
    ).toBe(false);
    expect(
      reaches(
        `import { createReleaseCheck } from "./application/checkForRelease";`,
        VALUE_IMPORT("application"),
      ),
    ).toBe(true);
    expect(reaches(`import { useEffect } from "react";`, REACT)).toBe(true);
    expect(
      reaches(
        `import { Button } from "../../ui";`,
        layer("githubReleases", "localReleaseMemory"),
      ),
    ).toBe(false);
    // A dynamic import and a require reach as surely as a static import.
    expect(
      reaches(
        `const m = await import("../githubReleases");`,
        layer("githubReleases"),
      ),
    ).toBe(true);
    expect(reaches(`const m = require("react-dom");`, REACT)).toBe(true);
    expect(
      reaches(
        `const m = await import("./application/checkForRelease");`,
        VALUE_IMPORT("application"),
      ),
    ).toBe(true);
  });

  it("keeps the domain pure", () => {
    expectNone(
      DOMAIN,
      [
        layer(
          "application",
          "githubReleases",
          "localReleaseMemory",
          "ReleaseNotice",
          "compose",
        ),
        REACT,
      ],
      [BROWSER],
    );
  });

  it("keeps the application plain rules over its own interfaces", () => {
    expectNone(
      APPLICATION,
      [
        layer(
          "githubReleases",
          "localReleaseMemory",
          "ReleaseNotice",
          "compose",
        ),
        REACT,
      ],
      [BROWSER],
    );
  });

  it("keeps the implementations to the application's interfaces", () => {
    expect(Object.keys(IMPLEMENTATIONS)).toHaveLength(2);
    expectNone(IMPLEMENTATIONS, [
      layer("ReleaseNotice", "compose"),
      VALUE_IMPORT("application"),
      REACT,
    ]);
  });

  it("keeps the notice away from the implementations", () => {
    expectNone(NOTICE, [layer("githubReleases", "localReleaseMemory")]);
  });

  it("is reached from outside only through its index", () => {
    const inside = /\/release\/(?!index$).+$/;
    const root = /\/release(?:\/index)?$/;
    expect(reaches(`import { x } from "./release/compose";`, inside)).toBe(
      true,
    );
    expect(
      reaches(`const m = await import("./release/compose");`, inside),
    ).toBe(true);
    expect(reaches(`import { APP_VERSION } from "./release";`, inside)).toBe(
      false,
    );

    expect(Object.keys(OUTSIDE).length).toBeGreaterThan(100);
    expect(
      Object.values(OUTSIDE).some((source) =>
        moduleImports(source).some((found) => root.test(found.specifier)),
      ),
    ).toBe(true);
    expectNone(OUTSIDE, [inside]);
  });
});
