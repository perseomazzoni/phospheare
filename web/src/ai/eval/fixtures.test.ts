// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";

// Keeps the evaluation corpus consistent between qualification runs, without
// running a model. The fixtures are synthetic, never a writer's manuscript,
// and every label references a file that exists. The fixtures load as raw
// imports rather than through `node:fs`, so the web tsconfig needs no Node
// types.

const FILES = import.meta.glob("./fixtures/**/*", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function read(relative: string): string {
  const wanted = relative.split("\\").join("/");
  const key = Object.keys(FILES).find((one) => one.endsWith(wanted));
  if (!key) throw new Error(`missing fixture ${relative}`);
  return FILES[key] ?? "";
}

interface Labels {
  version: number;
  language: string;
  cases: Array<{
    id: string;
    sources: string[];
    mustMentionAny: string[];
  }>;
}

describe("AI evaluation corpus", () => {
  it("labels only files that exist, in both languages", () => {
    for (const language of ["en", "it"]) {
      const labels = JSON.parse(
        read(`fixtures/${language}/labels.json`),
      ) as Labels;
      expect(labels.version).toBe(1);
      expect(labels.language).toBe(language);
      expect(labels.cases.length).toBeGreaterThan(0);
      for (const testCase of labels.cases) {
        expect(testCase.sources.length).toBeGreaterThan(0);
        for (const file of testCase.sources) {
          const text = read(`fixtures/${language}/${file}`);
          expect(text.trim().length, `${language}/${file}`).toBeGreaterThan(0);
        }
        expect(testCase.mustMentionAny.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the two languages structurally parallel", () => {
    const en = JSON.parse(read("fixtures/en/labels.json")) as Labels;
    const italian = JSON.parse(read("fixtures/it/labels.json")) as Labels;
    expect(italian.cases.map((one) => one.id)).toEqual(
      en.cases.map((one) => one.id),
    );
    expect(italian.cases.map((one) => one.sources.length)).toEqual(
      en.cases.map((one) => one.sources.length),
    );
  });
});
