// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import postcss, { type AtRule, type Node, type Root } from "postcss";

// The app's stylesheets as their tests read them, parsed by postcss the way
// the browser parses them: a comment mark inside a string, a declaration
// across lines, `!important` and a rule inside `@media` all read as drawn.

/** One declaration, with the rule and the at-rules it stands in. */
export interface Declared {
  /** The rule's selector list, each item alone; a keyframe step's is its offset. */
  selectors: string[];
  /** The rule's selector list, whole. Empty for a declaration outside a rule. */
  selector: string;
  /** In lower case, as the browser reads it. */
  prop: string;
  /** Without its `!important`. */
  value: string;
  important: boolean;
  /** The at-rules around it, outermost first: `media (forced-colors: active)`. */
  within: string[];
}

/** One rule: its selectors, its declarations, and where it stands. */
export interface RuleOf {
  selectors: string[];
  decls: { prop: string; value: string; important: boolean }[];
  within: string[];
  /** Its place among the stylesheet's rules, first to last. */
  index: number;
}

/**
 * The stylesheet parsed.
 *
 * @throws on a block left open or a brace with no block, as postcss does.
 */
export function parseCss(css: string): Root {
  return postcss.parse(css);
}

const rooted = (css: string | Root) =>
  typeof css === "string" ? parseCss(css) : css;

function atRulesAround(node: Node): string[] {
  const out: string[] = [];
  for (let at = node.parent; at; at = at.parent)
    if (at.type === "atrule") {
      const rule = at as AtRule;
      out.unshift(
        `${rule.name.toLowerCase()} ${rule.params.replace(/\s+/g, " ").trim()}`.trim(),
      );
    }
  return out;
}

/** A selector list split into its items, outside parentheses and brackets. */
export function itemsOf(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(selector.slice(from, i));
      from = i + 1;
    }
  }
  out.push(selector.slice(from));
  // Prettier wraps a long `:not(` over lines; the space it leaves inside the
  // brackets means nothing, and would make one state read as two.
  return out
    .map((one) =>
      one.trim().replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")"),
    )
    .filter(Boolean);
}

/** Every declaration in the stylesheet, in order. */
export function declarationsOf(css: string | Root): Declared[] {
  const found: Declared[] = [];
  rooted(css).walkDecls((decl) => {
    const rule = decl.parent?.type === "rule" ? decl.parent : null;
    const selector = rule ? rule.selector.replace(/\s+/g, " ").trim() : "";
    found.push({
      selectors: rule ? itemsOf(rule.selector) : [],
      selector,
      prop: decl.prop.startsWith("--") ? decl.prop : decl.prop.toLowerCase(),
      value: decl.value.trim(),
      important: Boolean(decl.important),
      within: atRulesAround(decl),
    });
  });
  return found;
}

/** Every rule in the stylesheet, in order, whatever at-rule holds it. */
export function rulesOf(css: string | Root): RuleOf[] {
  const found: RuleOf[] = [];
  rooted(css).walkRules((rule) => {
    const decls: RuleOf["decls"] = [];
    for (const node of rule.nodes)
      if (node.type === "decl")
        decls.push({
          prop: node.prop.startsWith("--")
            ? node.prop
            : node.prop.toLowerCase(),
          value: node.value.trim(),
          important: Boolean(node.important),
        });
    found.push({
      selectors: itemsOf(rule.selector),
      decls,
      within: atRulesAround(rule),
      index: found.length,
    });
  });
  return found;
}

/**
 * What the browser would read otherwise than it looks: a rule nested in a
 * rule (CSS nesting, which these tests do not read), a declaration standing
 * outside any rule, and a stray `;` after a rule, which the browser takes
 * into the next selector and drops that rule.
 */
export function misread(css: string | Root): string[] {
  const found: string[] = [];
  rooted(css).walk((node) => {
    if (node.type === "rule" && node.parent?.type === "rule")
      found.push(`${node.selector} is nested in a rule`);
    if (node.type === "rule" && node.raws.ownSemicolon)
      found.push(`a ";" after ${node.selector} drops the rule after it`);
    if (
      node.type === "decl" &&
      (node.parent?.type === "root" ||
        (node.parent?.type === "atrule" &&
          !/^(font-face|property|page|counter-style|font-feature-values)$/i.test(
            node.parent.name,
          )))
    )
      found.push(`${node.prop} stands outside any rule`);
  });
  return found;
}

/** A selector's compounds, split at its combinators outside parentheses. */
export function compoundsOf(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (i > from) out.push(selector.slice(from, i));
      from = i + 1;
    }
  }
  if (from < selector.length) out.push(selector.slice(from));
  return out.filter(Boolean);
}

/** A selector's subject: its last compound. */
export function lastCompound(selector: string): string {
  const compounds = compoundsOf(selector);
  return compounds[compounds.length - 1] ?? "";
}

/** The simple selectors of a compound, functional pseudo-classes whole. */
export function simplesOf(compound: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < compound.length) {
    let j = i + 1;
    if (compound[i] === "[") j = compound.indexOf("]", i) + 1;
    else if (compound.startsWith("::", i)) {
      j = i + 2;
      while (j < compound.length && /[\w-]/.test(compound[j])) j++;
    } else
      while (j < compound.length && !/[.#:[]/.test(compound[j])) {
        if (compound[j] === "(") {
          let depth = 1;
          for (j++; j < compound.length && depth > 0; j++)
            if (compound[j] === "(") depth++;
            else if (compound[j] === ")") depth--;
          continue;
        }
        j++;
      }
    out.push(compound.slice(i, j));
    i = j;
  }
  return out;
}

/** A selector with every `:name(…)` taken out, its argument with it. */
export function withoutPseudo(selector: string, name: string): string {
  let out = selector;
  for (;;) {
    const at = out.indexOf(`:${name}(`);
    if (at < 0) return out;
    let end = at + name.length + 2;
    for (let depth = 1; end < out.length && depth > 0; end++)
      if (out[end] === "(") depth++;
      else if (out[end] === ")") depth--;
    out = out.slice(0, at) + out.slice(end);
  }
}

/** A selector's specificity: ids, classes and their kin, types. */
export function specificity(selector: string): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  for (const compound of compoundsOf(selector))
    for (const one of simplesOf(compound)) {
      const fn = /^:(is|not|has|where)\((.*)\)$/.exec(one);
      if (fn) {
        if (fn[1] === "where") continue;
        const best = itemsOf(fn[2])
          .map(specificity)
          .sort((a, b) => compare(b, a))[0] ?? [0, 0, 0];
        total[0] += best[0];
        total[1] += best[1];
        total[2] += best[2];
      } else if (one.startsWith("#")) total[0]++;
      else if (/^(\.|\[|:(?!:))/.test(one)) total[1]++;
      else if (one !== "*" && one !== "&") total[2]++;
    }
  return total;
}

/** Orders two specificities: above zero when `a` outranks `b`. */
export function compare(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The custom properties the app's code writes (inline styles,
 * `setProperty`): the stylesheets read them, and no stylesheet declares
 * them, so a theme's sheet must not either.
 */
export const SCRIPTED = [
  // The colour drawn from a writer's name, on their initial (`Avatar`).
  "--name-colour",
  // Each Part's hue in the shape glyph (`SpineGlyph`).
  "--spine-hue",
  "--feed-top",
  "--feed-bottom",
  "--guide-left-x",
  "--guide-right-x",
  "--ed-fold-rest",
  "--track-w",
  "--track-at",
  "--track-n",
  // The landing rail's row under the spark (`Rail`): the Part being read.
  "--rail-at",
  // A kit slider's position, 0..1. Its thumb is a pseudo-element that no
  // inline style reaches, so the tint is mixed in the stylesheet.
  "--ui-slider-at",
  // A fitted track's thumb, measured onto the chosen cell.
  "--thumb-x",
  "--thumb-w",
  "--tail",
  // The on-screen keyboard's height, written onto the root element, not
  // the shell, by `EditorRoute`: three things move out of the keyboard's
  // way and one of them, the toast, is rendered outside the shell.
  "--kb",
  // How tall the Ask face's floating asking stack currently is, written
  // onto `.ai-stage` by `AiPanel` on every render. The transcript takes
  // it as bottom padding and the jump button as its sticky offset, so
  // both clear a block whose height changes with the draft, the
  // suggestions and every hint row.
  "--ai-asking-h",
  // The structure panel's own width, written onto the shell by
  // `EditorRoute` for the peek to draw a folded panel at while
  // `--panel-w` keeps reserving the rail.
  "--panel-open-w",
  // Where the command bar stood when the writer reached for it, written
  // onto `.bar-stack` by `EditorRoute` only while the bar is engaged; its
  // `var()` carries the at-rest centre as the fallback.
  "--bar-pin",
  // A tick tree row's depth in the export window, written by
  // `ExportPicker` on each row; the stylesheet steps the row in by it.
  "--export-depth",
  // Which line of its item an import row's cells stand on, and how many
  // lines the item has, written by `ChaptersStep`: a group's one bead and
  // one count span them all.
  "--line",
  "--lines",
  // The floating thread's seat, level with its passage, written by
  // `Margin` on the float.
  "--float-top",
  // How far the notes run past the prose's end, written by `Margin` on the
  // surface so the margin's rule reaches the last note.
  "--cm-overhang",
  // Henosis mode's fade length (the writer's X) and where the way back
  // starts from (the fade's opacity when it stopped), written onto the
  // shell by `useHenosis`.
  "--henosis-fade",
  "--henosis-from",
  // How long a landing sequence's current step takes to fade in, written
  // by `Sequence` on each step.
  "--seq-fade",
];
