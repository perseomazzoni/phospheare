// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../testing/moduleImports.fixture";

// The log's layers: a pure domain, an application that knows the store only
// as a port, and a browser side and a page that the rest of the app reaches
// through `index.ts` alone.

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
const PRESENTATION = raw(
  import.meta.glob(
    ["./presentation/**/*.{ts,tsx}", "!./presentation/**/*.test.{ts,tsx}"],
    { eager: true, query: "?raw", import: "default" },
  ),
);
/** Every source file of the app outside this module. */
const OUTSIDE = raw(
  import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!./**"], {
    eager: true,
    query: "?raw",
    import: "default",
  }),
);

/** The specifiers in `files` that `allowed` refuses, with where they are. */
function refused(
  files: Record<string, string>,
  allowed: (specifier: string) => boolean,
): string[] {
  expect(Object.keys(files).length).toBeGreaterThan(0);
  return Object.entries(files).flatMap(([file, source]) =>
    moduleImports(source)
      .filter((found) => !allowed(found.specifier))
      .map(({ specifier, line }) => `${file}:${line} imports ${specifier}`),
  );
}

describe("the log hexagon", () => {
  it("keeps the domain pure", () => {
    expect(refused(DOMAIN, (s) => /^\.\/[^/]+$/.test(s))).toEqual([]);
  });

  it("lets the application reach only the domain", () => {
    expect(
      refused(APPLICATION, (s) => /^\.\.\/domain\/[^/]+$/.test(s)),
    ).toEqual([]);
  });

  it("keeps the page away from the browser side's store", () => {
    expect(refused(PRESENTATION, (s) => !/idbStore$/.test(s))).toEqual([]);
  });

  it("lets the rest of the app in through index.ts and page.ts alone", () => {
    expect(
      refused(
        OUTSIDE,
        (s) => !/(?:^|\/)log\/./.test(s) || /\/log(?:\/page)?\/?$/.test(s),
      ),
    ).toEqual([]);
  });

  it("keeps the page out of the code that only writes lines", () => {
    const pageUsers = Object.entries(OUTSIDE)
      .filter(([, source]) =>
        moduleImports(source).some(({ specifier }) =>
          /\/log\/page$/.test(specifier),
        ),
      )
      .map(([file]) => file);
    expect(pageUsers).toEqual(["../App.tsx"]);
  });
});
