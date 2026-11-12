// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import BASE_CSS from "./base.css?raw";
import { EDITOR_CSS } from "../editor/editorSheets.fixture";
import WEBAPP_CSS from "../webapp/webapp.css?raw";

// Reduced motion is answered everywhere. A writer who asked the operating
// system for stillness asked once, and every screen owes them the same
// answer. The failure is an entrance animation with `both` that fills
// backwards, strands its element at `opacity: 0`, and tells the writer the
// interface is broken rather than calm.
//
// So this gate covers animations, not transitions. A transition dropped to
// `none` still arrives at its end state; an animation left running is either
// motion nobody consented to or an element that never appears. Both fail the
// build, and a reviewer does not reliably notice either.
//
// The rule: every selector that starts an animation is named in its own
// stylesheet's `prefers-reduced-motion` block. Its own, because a rule in
// `base.css` cannot know that `editor.css` exists, and the editor's chunk
// arrives long after the shared sheet is parsed.

const SHEETS = [
  ["base.css", BASE_CSS],
  ["editor.css", EDITOR_CSS],
  ["webapp.css", WEBAPP_CSS],
] as const;

/** Strip block comments, keeping newlines so line numbers survive. */
const decomment = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

/**
 * Split a stylesheet into its reduced-motion blocks and everything else.
 *
 * Brace counting rather than a regex: a `@media` block holds whole rules, and
 * a nested-brace pattern that matched one would be hard to correct later.
 */
function partition(css: string): { normal: string; reduced: string } {
  const source = decomment(css);
  const marker = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let normal = "";
  let reduced = "";
  let cursor = 0;

  for (let hit = marker.exec(source); hit; hit = marker.exec(source)) {
    normal += source.slice(cursor, hit.index);
    let depth = 1;
    let i = hit.index + hit[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
      i += 1;
    }
    reduced += `${source.slice(start, i - 1)}\n`;
    cursor = i;
    marker.lastIndex = i;
  }

  normal += source.slice(cursor);
  return { normal, reduced };
}

/** Every selector in a chunk of CSS that declares an `animation`. */
function animatedSelectors(css: string): string[] {
  const found = new Set<string>();
  // `selector-list { … }`, skipping at-rules, whose prelude is not a selector.
  for (const rule of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const body = rule[2];
    if (!/(^|[\s;])animation(-name)?\s*:/.test(body)) continue;
    // `animation: none` is an answer, not a question.
    if (/animation(-name)?\s*:\s*none/.test(body)) continue;
    for (const selector of rule[1].split(",")) {
      const cleaned = selector.trim().replace(/\s+/g, " ");
      if (cleaned) found.add(cleaned);
    }
  }
  return [...found];
}

/**
 * Which selectors the reduced-motion block speaks for.
 *
 * A pseudo-class is dropped from both sides before comparing: quieting
 * `.project` is a complete answer for `.project:hover`, and a block that had to
 * list every state of every control would be unreadable, and so go stale.
 */
function quieted(reduced: string): Set<string> {
  const found = new Set<string>();
  for (const rule of reduced.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    for (const selector of rule[1].split(",")) {
      const cleaned = selector.trim().replace(/\s+/g, " ");
      if (cleaned) found.add(base(cleaned));
    }
  }
  return found;
}

const base = (selector: string) =>
  selector.replace(/::?[\w-]+(\([^)]*\))?/g, "").trim();

describe("reduced motion is answered in every stylesheet", () => {
  it.each(SHEETS)("%s quiets every animation it starts", (_name, css) => {
    const { normal, reduced } = partition(css);
    const covered = quieted(reduced);

    // A blanket `*` in the reduced block answers for everything, which suits
    // some stylesheets.
    if (covered.has("*")) return;

    const missing = animatedSelectors(normal)
      .map(base)
      .filter((selector) => selector && !covered.has(selector));

    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it.each(SHEETS)("%s has a reduced-motion block at all", (_name, css) => {
    expect(partition(css).reduced.trim()).not.toBe("");
  });

  // Membership is not enough: at equal specificity the last declaration wins,
  // so a quieting rule that sits above the rule it quiets is inert. The block
  // must be the sheet's last word.
  it.each(SHEETS)(
    "%s keeps its reduced-motion block after the rules it quiets",
    (_name, css) => {
      const decommented = decomment(css);
      const block = decommented.lastIndexOf("@media (prefers-reduced-motion");
      expect(block).toBeGreaterThanOrEqual(0);
      // The block's own closing brace, by depth: the first `}` after the
      // opening one closes a nested rule, not the media query.
      const open = decommented.indexOf("{", block);
      let depth = 0;
      let close = -1;
      for (let i = open; i < decommented.length; i += 1) {
        if (decommented[i] === "{") depth += 1;
        else if (decommented[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      expect(close).toBeGreaterThan(0);
      // A sheet may carry unrelated blocks after it, but nothing that moves:
      // a transition or animation declared below the quieting block would win
      // on source order and defeat it.
      expect(
        decommented.slice(close + 1),
        "no transition or animation may be declared after the reduced-motion block",
      ).not.toMatch(/(^|[{;\s])(transition|animation)\s*:/);
    },
  );
});
