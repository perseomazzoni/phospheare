// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import {
  describeFindings,
  findForbiddenMarkers,
  findForbiddenModules,
  importChain,
  isForbidden,
  moduleName,
} from "./demoBoundary";

const SRC = "C:\\repo\\web\\src";

describe("moduleName", () => {
  it("names a source file by its web/src path without the extension", () => {
    expect(moduleName("C:/repo/web/src/auth/AuthContext.tsx", SRC)).toBe(
      "auth/AuthContext",
    );
  });

  it("accepts either separator and ignores a query", () => {
    expect(
      moduleName("C:\\repo\\web\\src\\storage\\driveRest.ts?used", SRC),
    ).toBe("storage/driveRest");
  });

  it("names a dependency by its package, scoped or not", () => {
    expect(moduleName("C:/repo/node_modules/fflate/esm/browser.js", SRC)).toBe(
      "npm:fflate",
    );
    expect(moduleName("C:/repo/node_modules/@scope/pkg/index.js", SRC)).toBe(
      "npm:@scope/pkg",
    );
  });

  it("names another file under web/ relative to web/", () => {
    expect(moduleName("C:/repo/web/index.html", SRC)).toBe("index.html");
  });

  it("leaves an id outside web/ and node_modules as it is", () => {
    expect(moduleName("\0vite/preload-helper.js", SRC)).toBe(
      "\0vite/preload-helper.js",
    );
  });
});

describe("isForbidden", () => {
  it("forbids a file under a prefix, and a file a bare prefix starts", () => {
    expect(isForbidden("webapp/library/Library")).toBe(true);
    expect(isForbidden("storage/driveGrant")).toBe(true);
    expect(isForbidden("ai/adapters/openrouterStream")).toBe(true);
    expect(isForbidden("ai/host/openrouterConnection")).toBe(true);
    expect(isForbidden("webapp/ai/ConnectPopup")).toBe(true);
  });

  it("keeps what the demo needs", () => {
    expect(isForbidden("ai/adapters/demo")).toBe(false);
    expect(isForbidden("storage/memoryProvider")).toBe(false);
    expect(isForbidden("ai/application/assistant")).toBe(false);
    expect(isForbidden("ai/adapters/chatCodec")).toBe(false);
    expect(isForbidden("editor/EditorRoute")).toBe(false);
  });

  it("forbids the stripped features' packages only", () => {
    expect(isForbidden("npm:pdfmake")).toBe(true);
    expect(isForbidden("npm:react")).toBe(false);
  });
});

describe("importChain", () => {
  const importers: Record<string, string[]> = {
    leaf: ["mid", "other"],
    mid: ["entry"],
    other: ["mid"],
  };
  const of = (id: string) => importers[id] ?? [];

  it("returns the shortest chain, entry first", () => {
    expect(importChain("leaf", of, (id) => id === "entry")).toEqual([
      "entry",
      "mid",
      "leaf",
    ]);
  });

  it("survives a cycle and returns the module alone when no entry reaches it", () => {
    const cyclic = (id: string) => (id === "a" ? ["b"] : ["a"]);
    expect(importChain("a", cyclic, () => false)).toEqual(["a"]);
  });
});

describe("findForbiddenModules", () => {
  it("reports each forbidden module once, sorted, with its named chain", () => {
    const ids = [
      "C:/repo/web/src/main.tsx",
      "C:/repo/web/src/storage/driveRest.ts",
      "C:/repo/web/src/auth/AuthContext.tsx",
      "C:/repo/web/src/auth/AuthContext.tsx?x",
      "C:/repo/web/src/ui/Button.tsx",
    ];
    const importers: Record<string, string[]> = {
      "C:/repo/web/src/auth/AuthContext.tsx": ["C:/repo/web/src/main.tsx"],
      "C:/repo/web/src/storage/driveRest.ts": [
        "C:/repo/web/src/auth/AuthContext.tsx",
      ],
    };
    const findings = findForbiddenModules(
      ids,
      SRC,
      (id) => importers[id] ?? [],
      (id) => id.endsWith("main.tsx"),
    );
    expect(findings).toEqual([
      { module: "auth/AuthContext", chain: ["main", "auth/AuthContext"] },
      {
        module: "storage/driveRest",
        chain: ["main", "auth/AuthContext", "storage/driveRest"],
      },
    ]);
  });
});

describe("findForbiddenMarkers", () => {
  it("reports each marker once per file, with its context", () => {
    const findings = findForbiddenMarkers([
      [
        "assets/a.js",
        'fetch("https://openrouter.ai/x");fetch("https://openrouter.ai/y")',
      ],
      ["index.html", "<p>clean</p>"],
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "assets/a.js",
      marker: "openrouter.ai",
    });
    expect(findings[0]?.excerpt).toContain("https://openrouter.ai/x");
  });
});

describe("describeFindings", () => {
  it("lists every module with its chain and every marker", () => {
    const text = describeFindings(
      [{ module: "auth/AuthContext", chain: ["main", "auth/AuthContext"] }],
      [{ file: "index.html", marker: "/identity/", excerpt: "x/identity/y" }],
    );
    expect(text).toContain("1 forbidden module(s) and 1 forbidden marker(s)");
    expect(text).toContain("main → auth/AuthContext");
    expect(text).toContain("/identity/ in index.html");
  });
});
