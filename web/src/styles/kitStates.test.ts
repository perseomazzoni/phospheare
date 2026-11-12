// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Pins the kit's states in the stylesheet text, because jsdom runs no CSS.
// Every hover and press on a kit control is guarded, so a disabled or locked
// control never tints, lifts or sinks: a Search held disabled until a wait
// passes must not light under the pointer and say "this will work" when it
// will not. A later variant or a theme's own touch is the likeliest place to
// forget it. `e2e/kit-states.spec.ts` shows the guard computed on one button.

import { describe, expect, it } from "vitest";
import BASE from "./base.css?raw";
import { compoundsOf, itemsOf, rulesOf, withoutPseudo } from "./css.fixture";
import { allThemes } from "../theme/application/registry";
import "../theme/index";
import SHARED from "../theme/themes/shared.css?raw";
import MATTE from "../theme/themes/matte/theme.css?raw";

// The kit as Matte wears it: the frame lays it out, the shared paint and
// Matte's sheet paint its hovers, presses and marks.
const CSS = (BASE + "\n" + SHARED + "\n" + MATTE).replace(
  /\/\*[\s\S]*?\*\//g,
  " ",
);

/** The declarations of every rule whose selector list holds `selector`. */
function declarations(css: string, selector: string): string {
  const found: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((one) => one.trim());
    if (selectors.includes(selector)) found.push(match[2] ?? "");
  }
  return found.join(" ");
}

/** The pointer-coarse block, whose rules are the kit's floors. */
const coarse = (() => {
  const at = CSS.indexOf("@media (pointer: coarse)");
  if (at < 0) return "";
  let depth = 0;
  for (let i = CSS.indexOf("{", at); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(at, i + 1);
  }
  return "";
})();

// ── The kit under the pointer ────────────────────────────────────────────────
//
// One guard over the frame's sheet and every theme's sheet as the page wears
// it: whichever rule wins the cascade, none of them may tint, lift or sink a
// control in a state it cannot be used in.

const ARIA = '[aria-disabled="true"]';

/**
 * The disabled states each kit control can be in. A button and a tick take
 * both: `disabled` while a wait passes, `aria-disabled` for a lock that still
 * explains itself when pressed. A list row is only ever locked, so its reason
 * can be read by focus, and a pick is a label, which `:disabled` never
 * matches. The name matches the variants (`.ui-btn-soft`) and parts too.
 */
const KIT: { name: RegExp; states: string[] }[] = [
  { name: /\.ui-btn\b/, states: [":disabled", ARIA] },
  { name: /\.ui-tick\b/, states: [":disabled", ARIA] },
  { name: /\.ui-row\b/, states: [ARIA] },
  { name: /\.pick\b/, states: [ARIA] },
];

/**
 * What a compound's own `:not(…)` exclude. `:is` and `:where` hold
 * alternatives, so they exclude a state only when every alternative does:
 * `:is(:not(:disabled), :not([aria-disabled="true"]))` still matches both
 * disabled states. A `:not` inside `:has` is about another element, and one
 * inside another `:not` excludes nothing, so neither counts.
 */
function excluded(compound: string): Set<string> {
  const out = new Set<string>();
  for (let at = 0; at < compound.length;) {
    const fn = /^:(not|is|where|has)\(/.exec(compound.slice(at));
    if (!fn) {
      at++;
      continue;
    }
    let end = at + fn[0].length;
    for (let depth = 1; end < compound.length && depth > 0; end++)
      if (compound[end] === "(") depth++;
      else if (compound[end] === ")") depth--;
    const items = itemsOf(compound.slice(at + fn[0].length, end - 1));
    if (fn[1] === "not")
      for (const item of items)
        out.add(
          item
            .trim()
            .replace(/'/g, '"')
            .replace(/=true\]$/, '="true"]'),
        );
    else if (fn[1] !== "has") {
      const each = items.map(excluded);
      for (const state of each[0] ?? [])
        if (each.every((alternative) => alternative.has(state))) out.add(state);
    }
    at = end;
  }
  return out;
}

/**
 * Every compound in the sheet that gives a kit control a hover or a press,
 * with the disabled states it leaves open.
 */
function pointerRules(css: string) {
  return rulesOf(css).flatMap(({ selectors }) =>
    selectors.flatMap((selector) =>
      compoundsOf(selector)
        .filter((compound) => /:(hover|active)\b/.test(compound))
        .flatMap((compound) => {
          const named = withoutPseudo(compound, "not");
          const states = KIT.filter(({ name }) => name.test(named)).flatMap(
            (kit) => kit.states,
          );
          if (states.length === 0) return [];
          const off = excluded(compound);
          return [
            { selector, open: [...new Set(states)].filter((s) => !off.has(s)) },
          ];
        }),
    ),
  );
}

/** The selectors that leave a state open, as a failure names them. */
const unguarded = (css: string) =>
  pointerRules(css)
    .filter(({ open }) => open.length > 0)
    .map(({ selector, open }) => `${selector} [${open.join(", ")}]`);

/**
 * Hovers a theme's sheet leaves open to a locked button, named whole so the
 * guard holds every other rule in that sheet. Each is a fix to the sheet, and
 * leaves this list with it: the last row below fails once it is guarded.
 */
const OPEN: Record<string, string[]> = {
  // The dark scheme lights a locked button's label and glyph.
  shine: [
    ':where(:root[data-theme="shine-dark"]) .ui-btn:where(:not(.ui-btn-primary):not(.ui-btn-danger):not(.ui-btn-attention):not(:disabled)):hover [[aria-disabled="true"]]',
    ':where(:root[data-theme="shine-dark"]) .ui-btn:where(:not(.ui-btn-primary):not(.ui-btn-danger):not(.ui-btn-attention):not(:disabled)):hover svg [[aria-disabled="true"]]',
  ],
  // A locked button's shadow goes.
  vision: [
    ':is(.ui-btn-primary, .ui-btn-outline, .ui-btn-attention):is(:hover, :active):not(:disabled) [[aria-disabled="true"]]',
  ],
};

/** The frame's sheet, then every theme's as the page wears it. */
const POINTER_SHEETS: [string, string, string[]][] = [
  ["base.css", BASE, []],
  ...(await Promise.all(
    allThemes().map(async (theme): Promise<[string, string, string[]]> => [
      theme.id,
      await theme.sheet(),
      OPEN[theme.family] ?? [],
    ]),
  )),
];

describe("the kit under the pointer", () => {
  it.each(POINTER_SHEETS)(
    "%s guards every hover and press against each disabled state",
    (_id, css, open) => {
      // Fails, rather than passing, when the search finds nothing to check.
      expect(pointerRules(css).length).toBeGreaterThan(0);
      expect(unguarded(css).filter((one) => !open.includes(one))).toEqual([]);
    },
  );

  it("finds a hover or press left open to a disabled state", () => {
    const open = (css: string) => unguarded(css).length;
    expect(open(".ui-btn:hover {}")).toBe(1);
    expect(open(".ui-btn-soft:hover:not(:disabled) {}")).toBe(1);
    expect(open(`.ui-btn:active:not(${ARIA}) {}`)).toBe(1);
    expect(open(".ui-tick:hover:not(:disabled) {}")).toBe(1);
    expect(open(".ui-row:hover:not(:disabled) {}")).toBe(1);
    expect(open(".pick:hover {}")).toBe(1);
    // A guard on another element, or inside `:has` or a second `:not`.
    expect(open(`.x:not(:disabled, ${ARIA}) .ui-btn:hover {}`)).toBe(1);
    expect(open(`.ui-btn:hover:has(:not(:disabled, ${ARIA})) {}`)).toBe(1);
    expect(open(`.ui-btn:hover:not(:not(:disabled, ${ARIA})) {}`)).toBe(1);
    expect(open(`.ui-btn:hover:not(.a:disabled, ${ARIA}) {}`)).toBe(1);
    // A guard split across alternatives, which each leave one state open.
    expect(open(`.ui-btn:hover:is(:not(:disabled), :not(${ARIA})) {}`)).toBe(1);
    expect(open(`.ui-btn:hover:where(:not(:disabled), :not(${ARIA})) {}`)).toBe(
      1,
    );
    // Every way of writing the guard.
    expect(
      open(
        `.ui-btn:hover:is(:not(:disabled, ${ARIA}), :not(:disabled):not(${ARIA})) {}`,
      ),
    ).toBe(0);
    expect(open(`.ui-btn:hover:not(:disabled, ${ARIA}) {}`)).toBe(0);
    expect(
      open(".ui-btn:hover:not(:disabled):not([aria-disabled='true']) {}"),
    ).toBe(0);
    expect(
      open(
        `.ui-btn:where(:not(:disabled):not(${ARIA})):is(:hover, :active) {}`,
      ),
    ).toBe(0);
    expect(open(`.ui-row:hover:not(${ARIA}) {}`)).toBe(0);
    expect(open(".ui-btn:focus-visible {}")).toBe(0);
  });

  it("lists only hovers a sheet still leaves open", () => {
    for (const [id, css, open] of POINTER_SHEETS)
      for (const one of open) expect(unguarded(css), id).toContain(one);
  });
});

describe("a choice that cannot be taken", () => {
  it("dims a disabled field with every other unavailable choice, alike", () => {
    // The same dim, whether one rule lists them all or each has its own.
    const selectors = [...CSS.matchAll(/([^{}]+)\{[^}]*opacity:\s*0\.58/g)]
      .flatMap((match) => itemsOf(match[1] ?? ""))
      .map((one) => one.trim());
    expect(selectors).toEqual(
      expect.arrayContaining([
        '.pick[aria-disabled="true"]',
        '.ui-row[aria-disabled="true"]',
        ".ui-input:disabled",
      ]),
    );
  });
});

// The kit's shapes, read from the rule itself.
describe("the kit's new shapes", () => {
  it("centres one line in the wrapping field from its one height", () => {
    const rule = declarations(CSS, ".ui-input.ui-input-wrap");
    expect(rule).toMatch(/--field-h:\s*38px/);
    expect(rule).toMatch(/min-height:\s*var\(--field-h\)/);
    expect(rule).toMatch(
      /padding:\s*calc\(\(var\(--field-h\) - 2px - 1\.5em\) \/ 2\) 12px/,
    );
  });

  it("floors the wrapping field and the bare tick on a coarse pointer", () => {
    expect(coarse).not.toBe("");
    expect(declarations(coarse, ".ui-input.ui-input-wrap")).toMatch(
      /--field-h:\s*var\(--tap\)/,
    );
    expect(declarations(coarse, ".ui-tick.ui-tick-bare")).toMatch(
      /min-width:\s*var\(--tap\)/,
    );
  });

  it("marks a button with an inset ring, never a border", () => {
    const rule = declarations(CSS, '.ui-bar-act[data-attention="1"]');
    expect(rule).toMatch(/color:\s*var\(--attention\)/);
    expect(rule).toMatch(
      /box-shadow:\s*inset 0 0 0 1px var\(--attention-glow\)/,
    );
    expect(rule).not.toMatch(/border/);
  });

  it("marks a track cell by its label's ink", () => {
    expect(
      declarations(CSS, '.ui-bar-track button[data-attention="1"]'),
    ).toMatch(/color:\s*var\(--attention\)/);
  });
});
