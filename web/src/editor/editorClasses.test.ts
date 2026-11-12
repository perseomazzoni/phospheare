// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Every class `editor.css` styles is one the app's code writes. A rule for a
// class no element wears draws nothing and fails no rendered check, and the
// sheet's hand-written lists (the coarse-pointer floors, the narrow scale,
// the reduced-motion quiet list) keep such a class alive where nobody looks.
// A class only a test writes is not written by the app, so tests are not
// read.

import { describe, expect, it } from "vitest";
import { EDITOR_CSS as EDITOR } from "./editorSheets.fixture";
import { rulesOf } from "../styles/css.fixture";

const SOURCES = Object.values(
  import.meta.glob<string>(
    ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../**/*.fixture.ts"],
    { query: "?raw", import: "default", eager: true },
  ),
);

/**
 * The source without its comments, so a class a note names is not taken for
 * one the code writes. A `//` after a colon is a URL's, not a comment's.
 */
function uncommented(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/**
 * The words the code writes inside quotes and templates, and the stems it
 * builds a class from: `msg-${role}` and `"dt-" + kind` both write `msg-`
 * and `dt-`.
 */
function written(sources: string[]) {
  const words = new Set<string>();
  const stems = new Set<string>();
  for (const source of sources.map(uncommented)) {
    for (const [literal] of source.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g))
      for (const [word] of literal.matchAll(
        /(?<![\w-])[A-Za-z_][\w-]*(?![\w-])/g,
      ))
        words.add(word);
    for (const [, stem] of source.matchAll(/([A-Za-z][\w-]*-)\$\{/g))
      stems.add(stem);
    for (const [, stem] of source.matchAll(/["'`]([A-Za-z][\w-]*-)["'`]\s*\+/g))
      stems.add(stem);
  }
  return { words, stems };
}

/** The classes a sheet's selectors name, attribute values aside. */
function classesOf(css: string): Set<string> {
  const found = new Set<string>();
  for (const { selectors, within } of rulesOf(css)) {
    if (within.some((at) => at.startsWith("keyframes"))) continue;
    for (const selector of selectors)
      for (const [, name] of selector
        .replace(/\[[^\]]*\]/g, "")
        .matchAll(/\.(-?[A-Za-z_][\w-]*)/g))
        found.add(name);
  }
  return found;
}

/**
 * The classes `css` styles that no source writes. A class built from a stem
 * counts as written only when the code also writes its ending, so a stem
 * vouches for the variants the code can build and for no others.
 */
function unwritten(css: string, sources: string[]): string[] {
  const { words, stems } = written(sources);
  return [...classesOf(css)]
    .filter(
      (name) =>
        !words.has(name) &&
        ![...stems].some(
          (stem) => name.startsWith(stem) && words.has(name.slice(stem.length)),
        ),
    )
    .sort();
}

describe("the classes the editor's stylesheet names", () => {
  it("are each written by the app's code", () => {
    expect(unwritten(EDITOR, SOURCES)).toEqual([]);
  });

  it("are read past comments, attribute values and stems with no ending", () => {
    const sources = [
      'const tone = "quiet";\nconst chip = <b className={`chip chip-${tone}`} />;',
      "// .chip-gone is styled in the sheet\nconst mark = <i className='mark' />;",
    ];
    const css =
      '.chip, .chip-quiet, .chip-loud, .chip-gone, .mark[data-k=".ghost"] {}';
    expect(unwritten(css, sources)).toEqual(["chip-gone", "chip-loud"]);
  });
});
