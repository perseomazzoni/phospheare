// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins the dialog foot in the stylesheet text. jsdom runs no CSS and measures
// every box as zero, so the browser rows hold the layout: the actions inside
// the dialog on the desk (`e2e/dialog-actions.spec.ts`), and on a phone each
// on its own row, its label inside its button, at the reach floor
// (`e2e/dialog-actions.mobile.spec.ts`). These rows pin the rules a later
// edit would undo.
//
// Below the phone plane, actions that share one row through `flex: 1` get
// 104px each on a 375px screen, and a row cannot refuse a label that does not
// fit. "Erase everything and sign out" overflows a 44px button and reads
// "everything and sign", at the moment a writer most needs to know which
// action erases their work. One row per action makes the label's
// length stop mattering.
//
// On the desk the actions keep their natural widths in a single `nowrap` row
// aligned to `flex-end`. A dialog is 400px and the three actions measure
// 454px in English and 405px in Italian, so the row overflows out the start
// edge, which is not scrollable, and the dismissal lands on the scrim. Both
// halves are one rule: the layout accommodates the sentence, because a
// translator changes the sentence and not the layout.

import { describe, expect, it } from "vitest";
import BASE from "./base.css?raw";

/** The `@media (max-width: 720px)` block, comments stripped. */
const phoneBlock = (() => {
  const at = BASE.indexOf("@media (max-width: 720px)");
  if (at < 0) return "";
  // Walk the braces so the whole block is captured rather than the first rule.
  let depth = 0;
  for (let i = BASE.indexOf("{", at); i < BASE.length; i++) {
    if (BASE[i] === "{") depth++;
    else if (BASE[i] === "}" && --depth === 0) {
      return BASE.slice(at, i + 1).replace(/\/\*[\s\S]*?\*\//g, " ");
    }
  }
  return "";
})();

/**
 * A rule in the phone block.
 *
 * @throws when the block or the rule is missing, so no check below passes by
 * reading nothing.
 */
const rule = (selector: string) => {
  const at = phoneBlock.indexOf(selector);
  if (at < 0) throw new Error(`no ${selector} in the phone block`);
  return phoneBlock.slice(at, phoneBlock.indexOf("}", at) + 1);
};

describe("the dialog foot on a phone", () => {
  it("does not let the actions divide one row between them", () => {
    // `flex: 1` makes a 29-character destructive label 104px wide. In a column
    // it is wrong the other way, dividing the foot's height between the
    // actions instead of giving each its own.
    const btn = rule(".ui-dialog-foot .ui-btn {");
    expect(btn).not.toMatch(/flex:\s*1\s*;/);
    expect(btn).toMatch(/flex:\s*none/);
  });

  it("leaves the height to the reach floor", () => {
    // The foot must not opt out of `--tap`: the coarse block raises it to 44,
    // and a stacked row of actions is where a thumb lands.
    expect(BASE).toMatch(/--tap:\s*44px/);
  });
});

describe("the dialog foot on the desk", () => {
  /** The unqualified `.ui-dialog-foot` rule, outside any media block. */
  const deskFoot = (() => {
    // Searched from the top: the desk rule is declared before the phone block
    // overrides it, so the first occurrence is the one that sets the row.
    const at = BASE.indexOf(".ui-dialog-foot {");
    if (at < 0) return "";
    return BASE.slice(at, BASE.indexOf("}", at) + 1).replace(
      /\/\*[\s\S]*?\*\//g,
      " ",
    );
  })();

  it("lets the actions wrap rather than leave the dialog", () => {
    // Without this the row overflows past `flex-end`'s start edge, which no
    // scroll can reach and no `scrollWidth` reports. Wrapping changes nothing
    // when the actions fit, which is why it is safe as the default.
    expect(deskFoot).toMatch(/flex-wrap:\s*wrap/);
    expect(deskFoot).not.toMatch(/flex-wrap:\s*nowrap/);
  });

  it("grows an action to hold a label that has no space to break at", () => {
    // A label with no break point, such as "Sign in again as {{email}}", can
    // run past a 360px screen and the 400px dialog, and spill its wrapped
    // lines out of a fixed-height box. A floor and a cap, never a
    // height. Comments are stripped first, since one may quote the label.
    const css = BASE.replace(/\/\*[\s\S]*?\*\//g, " ");
    const at = css.indexOf(".ui-dialog-foot .ui-btn {");
    const btn = css.slice(at, css.indexOf("}", at));
    expect(btn).toMatch(/height:\s*auto/);
    expect(btn).toMatch(/max-width:\s*100%/);
    expect(btn).toMatch(/overflow-wrap:\s*anywhere/);
    expect(btn).toMatch(/min-height:\s*max\(36px,\s*var\(--tap/);
    expect(rule(".ui-dialog-foot .ui-btn {")).not.toMatch(/[^-]height:\s*\d/);
  });
});
