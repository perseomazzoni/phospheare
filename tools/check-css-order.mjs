// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Checks that moving rules between the frame's stylesheets keeps the cascade.
//
//     node tools/check-css-order.mjs \
//       --before HEAD:web/src/editor/editor.css \
//       --after web/src/editor/editor.css web/src/editor/assistant/assistant.css
//
// Each list names the sheets in the order `frame.css` imports them; a
// `REV:path` entry is read from git. The frame's sheets share one layer, so
// between two rules of equal specificity the later one wins, and a move that
// changes which comes first can change what the writer sees.
//
// Every rule is split into one unit per selector. A unit is matched across
// the two lists by its at-rule context, selector and declarations, so a
// selector taken out of a list still matches. The tool reports:
//
// - a unit lost or added by the move;
// - two units whose order the move reversed, when they have the same
//   specificity and importance, set the same property (or a shorthand and its
//   longhand) and may match the same element.
//
// "May match" is read from the selectors' last compound: two class lists that
// share no class never match, anything else may. So a reported pair is a
// candidate to examine, not always a change. Media and container conditions
// are not compared, since two conditions can hold at once.
//
// Exit 0 when nothing is reported, 1 with a finding, 2 on a bad argument.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/package.json", import.meta.url));
const postcss = require("postcss");

function parseArgs(argv) {
  const lists = { before: [], after: [] };
  let into = null;
  for (const arg of argv) {
    if (arg === "--before" || arg === "--after") into = arg.slice(2);
    else if (into) lists[into].push(arg);
    else return null;
  }
  return lists.before.length && lists.after.length ? lists : null;
}

function readSheet(entry) {
  const at = entry.indexOf(":");
  // A Windows drive letter is one character before its colon.
  if (at > 1)
    return execFileSync("git", ["show", entry], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  return readFileSync(entry, "utf8");
}

/** Top-level parts of a selector list or a functional pseudo-class's list. */
function splitTop(list) {
  const parts = [];
  let depth = 0;
  let part = "";
  for (const ch of list) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(part.trim());
      part = "";
    } else part += ch;
  }
  if (part.trim()) parts.push(part.trim());
  return parts;
}

function greater(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Specificity as [ids, classes, types]. */
function specificity(selector) {
  const s = [0, 0, 0];
  let rest = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  rest = rest.replace(
    /:(?:is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g,
    (_, inner) => {
      let best = [0, 0, 0];
      for (const part of splitTop(inner)) {
        const p = specificity(part);
        if (greater(p, best)) best = p;
      }
      for (let i = 0; i < 3; i++) s[i] += best[i];
      return "";
    },
  );
  const count = (re, i) => {
    rest = rest.replace(re, () => {
      s[i]++;
      return "";
    });
  };
  count(/\[[^\]]*\]/g, 1);
  count(/::[\w-]+(?:\([^)]*\))?/g, 2);
  count(/:[\w-]+(?:\([^)]*\))?/g, 1);
  count(/#[\w-]+/g, 0);
  count(/\.[\w-]+/g, 1);
  rest.replace(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g, () => {
    s[2]++;
    return "";
  });
  return s;
}

/** The selector's last compound: its classes, its type and its pseudo-element. */
function subject(selector) {
  const compounds = selector
    .replace(/\((?:[^()]|\([^()]*\))*\)/g, "()")
    .split(/[\s>+~]+/)
    .filter(Boolean);
  const last = compounds.at(-1) ?? "";
  return {
    classes: (last.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1)),
    type: last.match(/^[a-zA-Z][\w-]*/)?.[0] ?? "",
    pseudo: last.match(/::[\w-]+/)?.[0] ?? "",
  };
}

function mayMatchSame(a, b) {
  if (a.pseudo !== b.pseudo) return false;
  if (a.classes.length && b.classes.length)
    return a.classes.some((c) => b.classes.includes(c));
  return !(a.type && b.type && a.type !== b.type);
}

const SHORTHANDS = [
  "animation",
  "background",
  "border",
  "columns",
  "flex",
  "font",
  "gap",
  "grid",
  "inset",
  "list-style",
  "margin",
  "mask",
  "outline",
  "overflow",
  "padding",
  "place",
  "text-decoration",
  "transition",
];
const SIDES = ["top", "right", "bottom", "left"];

function clash(p, q) {
  if (p === q) return true;
  for (const [a, b] of [
    [p, q],
    [q, p],
  ]) {
    if (SHORTHANDS.includes(a) && b.startsWith(`${a}-`)) return true;
    if (a === "inset" && SIDES.includes(b)) return true;
  }
  return false;
}

function contextOf(node) {
  const parts = [];
  for (let p = node.parent; p && p.type !== "root"; p = p.parent)
    if (p.type === "atrule") parts.unshift(`@${p.name} ${p.params}`);
  return parts.join(" ");
}

/** Every rule of the sheets, in cascade order, one unit per selector. */
function unitsOf(entries) {
  const units = [];
  for (const entry of entries) {
    postcss.parse(readSheet(entry)).walkRules((rule) => {
      if (
        rule.parent?.type === "atrule" &&
        rule.parent.name.endsWith("keyframes")
      )
        return;
      const decls = [];
      rule.each((d) => {
        if (d.type === "decl")
          decls.push({
            prop: d.prop,
            value: d.value,
            important: !!d.important,
          });
      });
      const context = contextOf(rule);
      const body = decls
        .map((d) => `${d.prop}:${d.value}${d.important ? "!" : ""}`)
        .join(";");
      for (const selector of splitTop(rule.selector)) {
        units.push({
          key: `${context}|${selector.replace(/\s+/g, " ")}|${body}`,
          where: `${entry}:${rule.source.start.line}`,
          selector,
          decls,
          specificity: specificity(selector).join(","),
          subject: subject(selector),
        });
      }
    });
  }
  return units;
}

const lists = parseArgs(process.argv.slice(2));
if (!lists) {
  console.error(
    "usage: node tools/check-css-order.mjs --before <sheet>... --after <sheet>...",
  );
  process.exit(2);
}

const before = unitsOf(lists.before);
const after = unitsOf(lists.after);

// Match each unit to its first unmatched twin, so repeats pair in order.
const waiting = new Map();
after.forEach((u, i) => {
  if (!waiting.has(u.key)) waiting.set(u.key, []);
  waiting.get(u.key).push(i);
});
const pairs = [];
const lost = [];
for (const u of before) {
  const queue = waiting.get(u.key);
  if (queue?.length) pairs.push([u, queue.shift()]);
  else lost.push(u);
}
const added = [...waiting.values()].flat().map((i) => after[i]);

const position = new Map(pairs);
let findings = lost.length + added.length;
for (const u of lost) console.log(`lost: ${u.where} ${u.selector}`);
for (const u of added) console.log(`added: ${u.where} ${u.selector}`);

for (let i = 0; i < pairs.length; i++) {
  const [first] = pairs[i];
  for (let j = i + 1; j < pairs.length; j++) {
    const [second] = pairs[j];
    if (position.get(first) < position.get(second)) continue;
    if (first.specificity !== second.specificity) continue;
    if (!mayMatchSame(first.subject, second.subject)) continue;
    const props = new Set();
    for (const d of first.decls)
      for (const e of second.decls)
        if (d.important === e.important && clash(d.prop, e.prop))
          props.add(d.prop === e.prop ? d.prop : `${d.prop}/${e.prop}`);
    if (!props.size) continue;
    findings++;
    console.log(
      `reversed: ${first.where} ${first.selector}\n` +
        `      now after ${second.where} ${second.selector}\n` +
        `      (${[...props].join(", ")})`,
    );
  }
}

console.error(
  `${before.length} units before, ${after.length} after; ${findings} to examine`,
);
process.exit(findings ? 1 : 0);
