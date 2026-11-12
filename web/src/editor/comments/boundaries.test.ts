// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  moduleImports,
  type ModuleImport,
} from "../../testing/moduleImports.fixture";

// Holds the comments' hexagon apart, with the import's gate
// (`editor/import/boundaries.test.ts`) fitted to this hexagon's shape:
//
//   domain        pure — the model, anchors, counts, proposals, mentions,
//                 the file's codec and the limits
//   application   the service: read-modify-write through the store it
//                 declares — the domain, nothing else
//   host          the React seam: the service built for a project, and the
//                 hooks that read it; it wires, never draws. Its store
//                 (`host/projectStore.ts`) reaches the project and storage,
//                 takes only types from the service, and never React
//   presentation  the margin — the kit, the core, the host's hooks, and the
//                 editor's views it measures; never the project, storage or
//                 the assistant
//
// Two rules differ from the import's. The presentation reads the service
// through the host's hooks; and it reaches the engine and the views, because
// a margin is drawn beside prose it has to measure. Every comment body is
// untrusted text, an editor's words from an import or a persona's from a
// model, so nothing builds markup from a string and nothing reaches the
// network: a comment travels only as a file in the writer's project.
//
// Every rule reads a file's imports through `moduleImports`, so an import, a
// re-export, a dynamic `import()`, a `require` and a side-effect import all
// count, and a pattern matches the module's whole specifier.

const host = (name: string) => new RegExp(`^(?:.*\\/)?${name}(?:\\/.*)?$`);
const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.?\\/)+(?:${names.join("|")})(?:\\/.*)?$`);

const REACT = /^(?:react(?:-dom)?(?:\/.*)?|react-i18next)$/;
const I18N = /^i18next$/;

/** String-to-markup sinks and the network, banned in every layer. */
const UNSAFE = [
  /\.innerHTML\b/,
  /\.outerHTML\b/,
  /\binsertAdjacentHTML\b/,
  /\bdocument\.write\b/,
  /\bcreateContextualFragment\b/,
  /\bdangerouslySetInnerHTML\b/,
  /\bnew\s+Worker\b/,
  /\bXMLHttpRequest\b/,
  /\bfetch\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\b/,
];

const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(
    ([path]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"),
  );

const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const APPLICATION = import.meta.glob("./application/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const STORE = import.meta.glob("./host/projectStore.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const HOST = import.meta.glob("./host/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const PRESENTATION = import.meta.glob("./presentation/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** A pattern over a module's specifier, or a test of the whole import. */
type Rule = RegExp | ((found: ModuleImport) => boolean);
const breaks = (rule: Rule, found: ModuleImport) =>
  rule instanceof RegExp ? rule.test(found.specifier) : rule(found);

const CORE_FORBIDDEN: Rule[] = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("webapp"),
  host("engine"),
  host("views"),
  layer("components", "tree", "reference"),
  host("(?:ai|assistant)"),
  layer("host", "presentation"),
  REACT,
  I18N,
];
const DOMAIN_FORBIDDEN = layer("application");
/** A value import of a layer, where only its types may be taken. */
const valueImport = (name: string) => {
  const named = layer(name);
  return (found: ModuleImport) =>
    !found.typeOnly && named.test(found.specifier);
};
const STORE_FORBIDDEN: Rule[] = [
  host("auth"),
  host("webapp"),
  host("(?:ai|assistant)"),
  layer("presentation"),
  valueImport("application"),
  REACT,
  I18N,
];
const HOST_FORBIDDEN: Rule[] = [layer("presentation")];
const PRESENTATION_FORBIDDEN: Rule[] = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("webapp"),
  host("(?:ai|assistant)"),
  layer("host/projectStore"),
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

/** Each file in `files` whose code one of `patterns` matches. */
const unsafe = (files: Record<string, string>, patterns: RegExp[]) =>
  raw(files)
    .filter(([, source]) => patterns.some((pattern) => pattern.test(source)))
    .map(([path]) => path);

describe("the comments' hexagonal boundary", () => {
  it("can tell an outward import from an inward one", () => {
    expect(
      reaches(`import { x } from "../application/comments";`, DOMAIN_FORBIDDEN),
    ).toBe(true);
    expect(
      reaches(`import { x } from "../host/projectStore";`, CORE_FORBIDDEN[8]),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../profile/profileSync";`,
        host("(?:project|profile)"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../assistant/commentsAdapter";`,
        host("(?:ai|assistant)"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../host/projectStore";`,
        PRESENTATION_FORBIDDEN[5],
      ),
    ).toBe(true);
    expect(
      reaches(
        `import type { CommentStore } from "../application/comments";`,
        valueImport("application"),
      ),
    ).toBe(false);
    expect(
      reaches(
        `import { CommentsService } from "../application/comments";`,
        valueImport("application"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../project/naming";`,
        host("(?:project|profile)"),
      ),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../ai/domain/types";`,
        PRESENTATION_FORBIDDEN[4],
      ),
    ).toBe(true);
    expect(
      reaches(`import { x } from "../../views/engine";`, host("views")),
    ).toBe(true);
    expect(
      reaches(
        `import type { Thread } from "../domain/model";`,
        DOMAIN_FORBIDDEN,
      ),
    ).toBe(false);
    expect(
      reaches(
        `import { useCommentsService } from "../host/comments";`,
        PRESENTATION_FORBIDDEN[5],
      ),
    ).toBe(false);
    expect(
      reaches(
        `const m = await import("../../../storage/types");`,
        host("storage"),
      ),
    ).toBe(true);
    // A require, a side-effect import and a dynamic import of the service
    // all load a value.
    expect(reaches(`const m = require("react-dom");`, ...STORE_FORBIDDEN)).toBe(
      true,
    );
    expect(reaches(`import "../../../storage";`, ...CORE_FORBIDDEN)).toBe(true);
    expect(
      reaches(
        `const m = await import("../application/comments");`,
        valueImport("application"),
      ),
    ).toBe(true);
  });

  it("finds every layer's files, so no rule passes over an empty glob", () => {
    for (const files of [DOMAIN, APPLICATION, STORE, HOST, PRESENTATION])
      expect(raw(files).length).toBeGreaterThan(0);
  });

  it("keeps the core free of the project, storage, the editor, React and i18n", () => {
    expect(offenders({ ...DOMAIN, ...APPLICATION }, CORE_FORBIDDEN)).toEqual(
      [],
    );
  });

  it("keeps the inner order: the domain imports nothing outward", () => {
    expect(offenders(DOMAIN, [DOMAIN_FORBIDDEN])).toEqual([]);
  });

  it("keeps the store below the service and away from React", () => {
    expect(offenders(STORE, STORE_FORBIDDEN)).toEqual([]);
  });

  it("keeps the host from drawing", () => {
    expect(offenders(HOST, HOST_FORBIDDEN)).toEqual([]);
  });

  it("keeps the margin off the project, storage and the assistant", () => {
    expect(offenders(PRESENTATION, PRESENTATION_FORBIDDEN)).toEqual([]);
  });

  it("builds no markup from strings and reaches no network, anywhere", () => {
    expect(
      unsafe({ ...DOMAIN, ...APPLICATION, ...HOST, ...PRESENTATION }, UNSAFE),
    ).toEqual([]);
  });
});
