// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { moduleImports } from "../../testing/moduleImports.fixture";

// Enforces the export's layer rule, as `ai/boundaries.test.ts` does for the
// AI module, because an unchecked layer rule breaks at the next convenient
// import. The layers:
//
//   domain        pure — the model, formats, layouts, names, the tick trees
//   ports         the domain's types only
//   application   the assembler and the run — domain and ports, nothing else
//   adapters      parsers, writers, the download — may reach the engine's
//                 codec and the hardened Markdown, never the project or storage
//   host          the one layer that knows the project and its providers;
//                 it wires, and never draws
//   presentation  the window — the kit, the domain and the application's types
//
// Each pattern matches a module's whole specifier, however the file names it
// (`moduleImports`): a bare directory import (`"../ports"`), a subpath and
// any depth of `../`. The self-check proves each one matches, because a
// pattern that never matches passes every file vacuously.

const host = (name: string) => new RegExp(`^(?:.*\\/)?${name}(?:\\/.*)?$`);
const layer = (...names: string[]) =>
  new RegExp(`^(?:\\.\\.?\\/)+(?:${names.join("|")})(?:\\/.*)?$`);

/**
 * React and its bindings: `react`, `react-dom` and any subpath of either, and
 * `react-i18next`. Banning `"react"` alone would let a `react-dom` or
 * `react-i18next` import through.
 */
const REACT = /^(?:react(?:-dom)?(?:\/.*)?|react-i18next)$/;
const I18N = /^i18next$/;
/** The network, which no layer of the core reaches. */
const FETCH = /\bfetch\s*\(/;

const raw = (files: Record<string, string>) =>
  Object.entries(files).filter(
    ([path]) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"),
  );

const DOMAIN = import.meta.glob("./domain/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const PORTS = import.meta.glob("./ports/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const APPLICATION = import.meta.glob("./application/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const ADAPTERS = import.meta.glob("./adapters/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const HOST = import.meta.glob("./host/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const PRESENTATION = import.meta.glob("./presentation/**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** Nothing inside the core knows the project, storage, React or the network. */
const CORE_FORBIDDEN = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("webapp"),
  host("engine"),
  layer("components", "tree", "reference"),
  host("(?:ai|assistant)"),
  layer("adapters", "host", "presentation"),
  REACT,
  I18N,
];
const DOMAIN_FORBIDDEN = layer("application", "ports");
const PORTS_FORBIDDEN = layer("application");
const ADAPTER_FORBIDDEN = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("webapp"),
  layer("host", "presentation", "application"),
  REACT,
  I18N,
];
/**
 * The host wires the core to the project and never draws. The window belongs
 * to the presentation; a host that imported it would make the composition
 * root's choice of window.
 */
const HOST_FORBIDDEN = [layer("presentation"), REACT];
const PRESENTATION_FORBIDDEN = [
  host("(?:project|profile)"),
  host("storage"),
  host("auth"),
  host("engine"),
  layer("adapters", "host"),
];

/** Each import in `files` whose module one of `patterns` names. */
const offenders = (files: Record<string, string>, patterns: RegExp[]) =>
  raw(files).flatMap(([path, source]) =>
    moduleImports(source)
      .filter(({ specifier }) => patterns.some((p) => p.test(specifier)))
      .map(({ specifier, line }) => `${path}:${line} imports ${specifier}`),
  );
const reaches = (source: string, ...patterns: RegExp[]) =>
  offenders({ "sample.ts": source }, patterns).length > 0;

describe("the export's hexagonal boundary", () => {
  it("can tell an outward import from an inward one", () => {
    expect(reaches(`import { x } from "../ports";`, DOMAIN_FORBIDDEN)).toBe(
      true,
    );
    expect(
      reaches(
        `import { x } from "../../application/assemble";`,
        PORTS_FORBIDDEN,
      ),
    ).toBe(true);
    expect(
      reaches(`import { x } from "../adapters/writers";`, CORE_FORBIDDEN[7]),
    ).toBe(true);
    expect(
      reaches(
        `import { x } from "../../../project/naming";`,
        host("(?:project|profile)"),
      ),
    ).toBe(true);
    expect(reaches(`import { x } from "../../storage";`, host("storage"))).toBe(
      true,
    );
    expect(
      reaches(
        `import { x } from "../host/projectSink";`,
        PRESENTATION_FORBIDDEN[4],
      ),
    ).toBe(true);
    // A dynamic import, a require and a re-export reach as surely.
    expect(
      reaches(`const m = await import("../../storage");`, ...CORE_FORBIDDEN),
    ).toBe(true);
    expect(reaches(`const m = require("react-dom");`, ...HOST_FORBIDDEN)).toBe(
      true,
    );
    expect(reaches(`export { x } from "../ports";`, DOMAIN_FORBIDDEN)).toBe(
      true,
    );
    // Inward and sibling imports stay legal.
    expect(
      reaches(
        `import type { Block } from "../domain/model";`,
        DOMAIN_FORBIDDEN,
      ),
    ).toBe(false);
    expect(
      reaches(
        `import { x } from "./projectFacts";`,
        host("(?:project|profile)"),
      ),
    ).toBe(false);
    for (const name of [
      "react",
      "react-dom",
      "react-dom/client",
      "react-i18next",
    ])
      expect(reaches(`import { x } from "${name}";`, REACT), name).toBe(true);
    expect(reaches(`import { x } from "react-markdown-ish";`, REACT)).toBe(
      false,
    );
  });

  it("finds every layer's files, so no rule passes over an empty glob", () => {
    for (const files of [
      DOMAIN,
      PORTS,
      APPLICATION,
      ADAPTERS,
      HOST,
      PRESENTATION,
    ])
      expect(raw(files).length).toBeGreaterThan(0);
  });

  it("keeps the core free of the project, storage, React and the network", () => {
    const core = { ...DOMAIN, ...PORTS, ...APPLICATION };
    expect(offenders(core, CORE_FORBIDDEN)).toEqual([]);
    expect(
      raw(core)
        .filter(([, source]) => FETCH.test(source))
        .map(([path]) => path),
    ).toEqual([]);
  });

  it("keeps the inner order: the domain imports nothing outward, ports only the domain", () => {
    expect(offenders(DOMAIN, [DOMAIN_FORBIDDEN])).toEqual([]);
    expect(offenders(PORTS, [PORTS_FORBIDDEN])).toEqual([]);
  });

  it("keeps the adapters from reaching sideways into the project or storage", () => {
    expect(offenders(ADAPTERS, ADAPTER_FORBIDDEN)).toEqual([]);
  });

  it("keeps the host from drawing", () => {
    expect(offenders(HOST, HOST_FORBIDDEN)).toEqual([]);
  });

  it("keeps the window on the kit and the core, never the host's implementations", () => {
    expect(offenders(PRESENTATION, PRESENTATION_FORBIDDEN)).toEqual([]);
  });
});
