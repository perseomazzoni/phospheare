// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  compare,
  compoundsOf,
  itemsOf,
  rulesOf,
  simplesOf,
  specificity,
  type RuleOf,
} from "./css.fixture";

// Where a theme's own touches erase a state of the paint they tune. A sheet
// that tunes a copy of the paint does it in a later layer (`@layer paint,
// tune`), and a later layer outranks every weight: a touch that can meet an
// element the paint draws in a state (hover, focus, pressed, chosen, open,
// a verdict on an ancestor) beats that state on each property both set,
// and the state never shows. Unless the touch is a state of its own the
// paint already let win, the state is restated in the tune after the touch.

/** An attribute that names a variant of a control, not a state it is in. */
const VARIANT = /^\[data-(seat|kind|variant|size|tone)\b/;

/** A simple selector that names a state of an element, not a kind of one. */
export function isState(one: string): boolean {
  if (VARIANT.test(one)) return false;
  if (/^:(is|not|where|has)\(/.test(one))
    return (
      one.startsWith(":has(") ||
      /:(hover|focus|active|disabled|checked|open|popover-open)|\[(aria|data)-|\[open\]/.test(
        one,
      )
    );
  return /^(:(hover|focus|focus-visible|focus-within|active|disabled|checked|placeholder-shown|popover-open|open|target|invalid|user-invalid|indeterminate)$|\[(aria|data)-|\[open\]$|\.(is-[\w-]+|selected|active|invalid|current|open)$)/.test(
    one,
  );
}

/**
 * The root's attributes under a theme (`data-theme`, `data-crop` and the
 * frame's options), which settle every `:root[…]` condition in a sheet.
 */
export type RootAttributes = Record<string, string>;

/** Whether a selector's conditions on the root hold under these attributes. */
function rootHolds(text: string, root: RootAttributes): boolean {
  for (const m of text.matchAll(/:root((?:\[[^\]]+\])+)/g))
    for (const a of m[1].matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)) {
      const name = a[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      if (!(name in root)) continue;
      if (a[2] === undefined ? !root[name] : root[name] !== a[2]) return false;
    }
  return true;
}

/** The selector with its conditions on the root, settled, taken out. */
function withoutRoot(text: string): string {
  return text
    .replace(/:where\(\s*:root(?:\[[^\]]+\])*\s*\)\s*/g, "")
    .replace(/:root(?:\[[^\]]+\])*\s*/g, "")
    .trim();
}

/**
 * The selector as plain alternatives: each `:is()` and `:where()` of simple
 * selectors opened into one selector per argument.
 */
function alternatives(text: string, budget = 64): string[] {
  const at = text.search(/:(is|where)\(/);
  if (at < 0) return [text];
  const open = text.indexOf("(", at);
  let end = open + 1;
  for (let depth = 1; end < text.length && depth > 0; end++)
    if (text[end] === "(") depth++;
    else if (text[end] === ")") depth--;
  const args = itemsOf(text.slice(open + 1, end - 1));
  // One argument with a combinator narrows the compound it stands in to
  // its own subject, under its own ancestors: `.a:is(.b .c)` is `.b .a.c`
  // to every question asked here but its weight.
  if (args.length === 1 && compoundsOf(args[0]).length > 1) {
    const arg = compoundsOf(args[0]);
    const subject = arg[arg.length - 1];
    const ancestors = args[0].slice(0, args[0].length - subject.length).trim();
    // The host compound's own simples, and its type, are not said twice.
    const host = simplesOf(compoundsOf(text.slice(0, at)).pop() ?? "");
    const typed = host.some((one) => /^[a-z*]/i.test(one));
    const added = simplesOf(subject)
      .filter((one) => !host.includes(one))
      .filter((one) => !(typed && /^[a-z*]/i.test(one)))
      .join("");
    return alternatives(
      `${ancestors} ${text.slice(0, at)}${added}${text.slice(end)}`,
      budget,
    );
  }
  // Several such arguments stay whole, as one opaque kind, its name
  // written in capitals so it is not opened again.
  if (args.some((arg) => compoundsOf(arg).length > 1) || args.length > budget)
    return alternatives(
      text.slice(0, at) + text.slice(at, open).toUpperCase() + text.slice(open),
      budget,
    );
  return args.flatMap((arg) =>
    alternatives(text.slice(0, at) + arg + text.slice(end), budget),
  );
}

/** A selector item, read once: its simples by kind, its subject, its weight. */
interface Item {
  text: string;
  /** The pseudo-element its subject draws, or "". */
  pe: string;
  states: Set<string>;
  kinds: Set<string>;
  subjectKinds: Set<string>;
  /** What a `:not()` refuses: an element with one of these never matches. */
  refused: Set<string>;
  spec: [number, number, number];
}

/** An attribute's name and its value, when the selector names one. */
const attribute = (one: string) => /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(one);

/**
 * Whether two items ask one element for what it cannot be at once: an
 * attribute at two values, or a selector one refuses and the other needs.
 */
function exclusive(a: Item, b: Item): boolean {
  const needs = (x: Item) => [...x.states, ...x.kinds];
  if (needs(a).some((one) => b.refused.has(one))) return true;
  if (needs(b).some((one) => a.refused.has(one))) return true;
  // One status of a control's at a time: `.is-ok` is never `.is-error`.
  const status = (x: Item) =>
    [...x.states].filter((one) => /^\.is-[\w-]+$/.test(one));
  if (
    status(a).some((one) =>
      status(b).some((other) => other !== one && !status(a).includes(other)),
    )
  )
    return true;
  for (const one of needs(a)) {
    const x = attribute(one);
    if (!x || x[2] === undefined) continue;
    for (const other of needs(b)) {
      const y = attribute(other);
      if (y && y[1] === x[1] && y[2] !== undefined && y[2] !== x[2])
        return true;
    }
  }
  return false;
}

function readOne(text: string, alternative: string): Item {
  const states = new Set<string>();
  const kinds = new Set<string>();
  const subjectKinds = new Set<string>();
  const refused = new Set<string>();
  const compounds = compoundsOf(alternative);
  let pe = "";
  compounds.forEach((compound, at) => {
    for (const one of simplesOf(compound)) {
      if (one.startsWith("::")) {
        if (at === compounds.length - 1) pe = one;
        continue;
      }
      if (one === "*" || one === "&") continue;
      if (/^:not\(/.test(one)) {
        for (const arg of itemsOf(one.slice(5, -1)))
          if (compoundsOf(arg).length === 1) refused.add(arg);
        if (isState(one)) states.add(one);
      } else if (isState(one)) {
        states.add(one);
        // A keyboard's focus is a focus.
        if (one === ":focus-visible") states.add(":focus");
      } else {
        kinds.add(one);
        if (at === compounds.length - 1) subjectKinds.add(one);
      }
    }
  });
  return {
    text,
    pe,
    states,
    kinds,
    subjectKinds,
    refused,
    spec: specificity(text),
  };
}

/** A selector item as the plain alternatives it matches, or none at all. */
function read(text: string, root: RootAttributes): Item[] {
  if (!rootHolds(text, root)) return [];
  return alternatives(withoutRoot(text)).map((one) => readOne(text, one));
}

const within = <T>(a: Set<T>, b: Set<T>) => [...a].every((one) => b.has(one));

/**
 * Pairs of kinds written on one element (`.project.project-gone`), by a
 * sheet or by the markup. A class the markup builds from a stem
 * (`ui-btn-${variant}`) is written as that stem, `.ui-btn-*`.
 */
export type Together = Set<string>;

const pair = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

/** Every two kinds the sheet's selectors put in one compound. */
function together(rules: RuleOf[]): Together {
  const found: Together = new Set();
  for (const rule of rules)
    for (const selector of rule.selectors)
      for (const compound of compoundsOf(selector)) {
        const kinds = simplesOf(compound).filter((one) => /^[.a-z]/i.test(one));
        for (const a of kinds)
          for (const b of kinds) if (a !== b) found.add(pair(a, b));
      }
  return found;
}

/**
 * Every kind the sheet's selectors set inside another (`.msg .msg-body`),
 * written `ancestor > descendant`, the ancestor's stems too (`.msg-you`
 * is a `.msg-*`): a part of an element, not a variant.
 */
function nested(rules: RuleOf[]): Set<string> {
  const found = new Set<string>();
  const kindsOf = (compound: string) =>
    simplesOf(compound).filter((one) => /^./.test(one));
  for (const rule of rules)
    for (const selector of rule.selectors) {
      const compounds = compoundsOf(selector);
      const subject = kindsOf(compounds[compounds.length - 1] ?? "");
      for (const above of compounds.slice(0, -1))
        for (const a of kindsOf(above))
          for (const b of subject)
            for (const name of namesOf(a)) found.add(`${name} > ${b}`);
    }
  return found;
}

/** The text from an opening bracket at `at` to its match, both included. */
function balanced(text: string, at: number): string {
  const open = text[at];
  const close = open === "{" ? "}" : open === "[" ? "]" : open;
  let depth = 0;
  for (let end = at; end < text.length; end++) {
    if (text[end] === open && (open !== close || end === at)) depth++;
    else if (text[end] === close && --depth === 0)
      return text.slice(at, end + 1);
  }
  return text.slice(at);
}

/**
 * Every two classes a source writes on one element: those in one
 * `className`, and those in one list of classes it joins.
 */
export function writtenTogether(source: string): Together {
  const units: string[] = [];
  for (const m of source.matchAll(/className=(?=["{])/g))
    units.push(balanced(source, m.index + m[0].length));
  for (const m of source.matchAll(/\[/g)) {
    const list = balanced(source, m.index);
    if (/^\s*\.(filter|join)\(/.test(source.slice(m.index + list.length)))
      units.push(list);
  }
  const found: Together = new Set();
  for (const unit of units) {
    const classes = [
      ...[...unit.matchAll(/([a-z][a-z0-9-]*-)\$\{/g)].map((m) => `.${m[1]}*`),
      ...[
        ...unit.matchAll(/(?<![\w$.-])[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\w-])/g),
      ].map((m) => `.${m[0]}`),
    ];
    for (const a of classes)
      for (const b of classes) if (a !== b) found.add(pair(a, b));
  }
  return found;
}

/** A class and the stems it could be built from: `.ui-btn-*`, `.ui-*`. */
function namesOf(kind: string): string[] {
  const parts = kind.split("-");
  return [
    kind,
    ...parts.slice(1).map((_, at) => `${parts.slice(0, at + 1).join("-")}-*`),
  ];
}

/**
 * Whether two sets of kinds can stand on one element: one among the other,
 * or every kind the one names and the other does not written beside each
 * such kind of the other, by the sheet or the markup.
 */
function compatible(a: Set<string>, b: Set<string>, seen: Together): boolean {
  if (within(a, b) || within(b, a)) return true;
  const onlyA = [...a].filter((one) => !b.has(one));
  const onlyB = [...b].filter((one) => !a.has(one));
  // A stem stands for a variant, never for a part the sheet sets inside it.
  const part = (x: string, y: string) =>
    [`${x} > ${y}`, `${x}-* > ${y}`, `${y} > ${x}`, `${y}-* > ${x}`].some(
      (one) => seen.has(one),
    );
  return onlyA.every((x) =>
    onlyB.every(
      (y) =>
        seen.has(pair(x, y)) ||
        (!part(x, y) &&
          namesOf(x).some((one) =>
            namesOf(y).some((other) => seen.has(pair(one, other))),
          )),
    ),
  );
}

/**
 * Whether one element could match both: the same pseudo-element, a kind
 * named in each subject, and kinds that can stand together, in the subject
 * and overall. A bare state (`:focus-visible`) is any element's, and is
 * left to the paint.
 */
function mayMeet(a: Item, b: Item, seen: Together): boolean {
  return (
    a.pe === b.pe &&
    !exclusive(a, b) &&
    a.subjectKinds.size > 0 &&
    b.subjectKinds.size > 0 &&
    compatible(a.subjectKinds, b.subjectKinds, seen) &&
    (within(ancestors(a), ancestors(b)) || within(ancestors(b), ancestors(a)))
  );
}

/** The kinds an item asks of the subject's ancestors. */
const ancestors = (item: Item) =>
  new Set([...item.kinds].filter((one) => !item.subjectKinds.has(one)));

const BORDER =
  /^border(?:-(top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-(color|width|style))?$/;

/** Whether two properties set any of the same thing, shorthands read whole. */
export function overlaps(a: string, b: string): boolean {
  if (a === b) return true;
  const radius = /^border(-[a-z]+)*-radius$/;
  if (radius.test(a) || radius.test(b))
    return (
      radius.test(a) &&
      radius.test(b) &&
      (a === "border-radius" || b === "border-radius")
    );
  const ba = BORDER.exec(a);
  const bb = BORDER.exec(b);
  if (ba && bb) {
    const sideMeets =
      !ba[1] ||
      !bb[1] ||
      ba[1] === bb[1] ||
      /block|inline/.test(ba[1]) ||
      /block|inline/.test(bb[1]);
    return sideMeets && (!ba[2] || !bb[2] || ba[2] === bb[2]);
  }
  return a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
}

/** Whether `a`, at its place, outranks `b` at its own. */
function beats(a: Item, at: number, b: Item, bt: number): boolean {
  const order = compare(a.spec, b.spec);
  return order > 0 || (order === 0 && at > bt);
}

/** An item's subject and states, as one key, to find the paint's own rule. */
const keyOf = (item: Item) =>
  [
    item.pe,
    ...[...item.subjectKinds].filter((one) => !/^:[A-Z]/.test(one)).sort(),
    "|",
    ...[...item.states].sort(),
  ].join(" ");

export interface Erasure {
  /** The touch, a tune rule's selector item, and its rule. */
  touch: string;
  touchRule: RuleOf;
  /** The paint's state it erases, and that state's rule. */
  state: string;
  stateRule: RuleOf;
  /** The properties the state loses. */
  props: string[];
}

/**
 * Every state of the paint a touch of the tune erases, unrestated, with the
 * root as a theme leaves it and the pairs of classes the markup writes on
 * one element.
 */
export function erasures(
  css: string,
  root: RootAttributes,
  written: Together = new Set(),
): Erasure[] {
  const rules = rulesOf(css);
  const paint = rules.filter((rule) => rule.within.includes("layer paint"));
  const tune = rules.filter((rule) => rule.within.includes("layer tune"));
  const seen = new Set([...together(rules), ...nested(rules), ...written]);
  const items = new Map<RuleOf, Item[]>(
    rules.map((rule) => [
      rule,
      rule.selectors.flatMap((one) => read(one, root)),
    ]),
  );
  const paintItems = paint.flatMap((rule) =>
    (items.get(rule) ?? []).map((item) => ({ rule, item })),
  );
  const paintByKey = new Map<string, { rule: RuleOf; item: Item }[]>();
  for (const rule of paint)
    for (const item of items.get(rule) ?? [])
      paintByKey.set(keyOf(item), [
        ...(paintByKey.get(keyOf(item)) ?? []),
        { rule, item },
      ]);

  const found = new Map<string, Erasure>();
  for (const touchRule of tune)
    for (const t of items.get(touchRule) ?? [])
      for (const { rule: stateRule, item: s } of paintItems) {
        // The paint's rule is a state the touch is not in, a kind its
        // subject is that the touch does not name (`.project-gone`,
        // `h3.dt-region-label`), or a context the touch does not ask for
        // (`.doc-tree-sheet .doc-tree`).
        // The base of a variant the touch names is no narrower than it.
        const variants = [...s.subjectKinds].filter(
          (one) =>
            !t.subjectKinds.has(one) &&
            !/^:[A-Z]/.test(one) &&
            ![...t.subjectKinds].some((kind) => kind.startsWith(`${one}-`)),
        );
        const context = [...ancestors(s)].filter(
          (one) => !ancestors(t).has(one) && !/^:[A-Z]/.test(one),
        );
        // A variant or a context in no state of its own is erased only where
        // the paint let it win: at the touch's weight or above, as it would
        // in one flat sheet. A heavier touch outweighs it by design.
        const narrower =
          [...s.states].some((one) => !t.states.has(one)) ||
          ((variants.length > 0 || context.length > 0) &&
            compare(s.spec, t.spec) >= 0);
        if (!narrower) continue;
        // A disabled control is meant to lose its hover and its press.
        if (
          [...t.states].some(
            (one) => /disabled/.test(one) && !/:not\(/.test(one),
          )
        )
          continue;
        if (!mayMeet(t, s, seen)) continue;
        const shared = stateRule.decls.filter((sd) =>
          touchRule.decls.some(
            (td) =>
              overlaps(td.prop, sd.prop) &&
              !(td.prop === sd.prop && td.value === sd.value),
          ),
        );
        if (shared.length === 0) continue;
        // A touch the paint already let win over this one (`:hover` over
        // `.active`, written later at the same weight) erases nothing the
        // paint showed.
        const own = (paintByKey.get(keyOf(t)) ?? []).filter(({ item }) =>
          within(ancestors(item), ancestors(t)),
        );
        if (
          own.length > 0 &&
          own.every(
            ({ rule, item }) => !beats(s, stateRule.index, item, rule.index),
          )
        )
          continue;
        const lost = shared
          .map((sd) => sd.prop)
          .filter(
            (prop) =>
              !tune.some(
                (other) =>
                  other.decls.some((od) => overlaps(od.prop, prop)) &&
                  (items.get(other) ?? []).some(
                    (o) =>
                      within(s.states, o.states) &&
                      // Restated, or outweighed: heavier than the
                      // state, as it would be in one flat sheet.
                      ((variants.every((one) => o.subjectKinds.has(one)) &&
                        context.every((one) => ancestors(o).has(one))) ||
                        compare(o.spec, s.spec) > 0) &&
                      mayMeet(o, s, seen) &&
                      // The touch's own rule naming the state speaks for it.
                      (other === touchRule ||
                        beats(o, other.index, t, touchRule.index)),
                  ),
              ),
          );
        if (lost.length === 0) continue;
        const key = `${touchRule.index} ${t.text} ${stateRule.index} ${s.text}`;
        const had = found.get(key);
        found.set(key, {
          touch: t.text,
          touchRule,
          state: s.text,
          stateRule,
          props: [...new Set([...(had?.props ?? []), ...lost])],
        });
      }
  return [...found.values()];
}
