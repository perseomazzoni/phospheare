// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { TRUSTED_TYPES_POLICY } from "./csp";

// The Trusted Types policy every markup sink passes through, named in the
// policy's `trusted-types` directive (`csp.ts`). Under
// `require-trusted-types-for 'script'`, a browser with the API refuses a plain
// string at `innerHTML`, `DOMParser.parseFromString` and every other sink that
// turns text into DOM, and throws instead. Only a `TrustedHTML` this policy
// minted passes.
//
// The helpers put the policy to two uses:
//
// - Rendered markup, for a sink the page shows. The helpers admit only the
//   dialect in `DIALECT`. An element or attribute outside it, a link to
//   another scheme, a comment, markup that lands in the head or on the body:
//   the helper throws, and the sink gets nothing. The renderers escape text
//   and keep raw HTML off, so the check fires only for markup from somewhere
//   else, which then throws instead of rendering.
// - Inert parsing, for `parseDocument`: a new document in which no script
//   runs and no resource is fetched, which the importers walk and nothing
//   renders. Any text may be parsed into one, unchecked; the check itself
//   parses its input this way to look at it.
//
// What the policy adds beyond the check is that every sink is enumerable:
// the only way to reach one is through the helpers here. `csp.test.ts` pins
// that no source file assigns `innerHTML`, parses with `DOMParser` or sets
// `__html` except through them.
//
// The check runs in the helpers, before the policy, so it holds in a browser
// without the API and in jsdom, which has no `trustedTypes`: a renderer that
// drifts from the dialect fails in a component test, not in a browser.

interface Policy {
  createHTML(input: string): TrustedHTML;
}

interface PolicyFactory {
  createPolicy(
    name: string,
    rules: { createHTML: (input: string) => string },
  ): Policy;
}

// Resolved on first use rather than at import: the module is loaded by the
// build's config through `csp.ts`, where there is no window.
let policy: Policy | null | undefined;

function current(): Policy | null {
  if (policy === undefined) {
    const factory = (globalThis as { trustedTypes?: PolicyFactory })
      .trustedTypes;
    policy = factory
      ? factory.createPolicy(TRUSTED_TYPES_POLICY, {
          createHTML: (input) => input,
        })
      : null;
  }
  return policy;
}

// The same markup hands back the same value. React rewrites `innerHTML`
// whenever `__html` is a different object, so a fresh `TrustedHTML` per
// render would replace a rendered subtree, and the selection or focus inside
// it, on every re-render of its parent. Only checked markup is kept, so a
// refusal is re-checked, and refused, every time. The bound is above the
// number of rendered sinks a screen holds at once (every turn of a long chat),
// least recently used first out, so a streaming answer's drafts age out.
const MINTED_LIMIT = 512;
const minted = new Map<string, string | TrustedHTML>();

/**
 * Marks rendered markup for a sink, for React's `__html`, after checking it
 * against the rendered dialect.
 * @throws TypeError for markup outside the dialect.
 */
export function trustedHtml(html: string): string | TrustedHTML {
  const known = minted.get(html);
  if (known !== undefined) {
    minted.delete(html);
    minted.set(html, known);
    return known;
  }
  checkRendered(html, inertDocument);
  const marked = current();
  const value = marked ? marked.createHTML(html) : html;
  minted.set(html, value);
  if (minted.size > MINTED_LIMIT) {
    const oldest = minted.keys().next().value;
    if (oldest !== undefined) minted.delete(oldest);
  }
  return value;
}

/** Assigns `innerHTML` through the policy. */
export function setInnerHtml(el: Element, html: string): void {
  // `lib.dom` types the setter as `string`; the browser accepts a
  // `TrustedHTML` and, under the directive, accepts nothing else.
  (el as { innerHTML: string | TrustedHTML }).innerHTML = trustedHtml(html);
}

/**
 * Parses markup into a new, inert document through the policy: no script
 * runs in it, no resource it names is fetched.
 */
export function parseDocument(
  text: string,
  type: "text/html" | "application/xml",
): Document {
  const marked = current();
  // `lib.dom` types the argument as `string`.
  const input = marked ? (marked.createHTML(text) as string) : text;
  return new DOMParser().parseFromString(input, type);
}

function inertDocument(html: string): Document {
  return parseDocument(html, "text/html");
}

// ── The rendered dialect ─────────────────────────────────────────────────────

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const ELEMENT = 1;
const TEXT = 3;

type Admits = (value: string) => boolean;

const matches =
  (pattern: RegExp): Admits =>
  (value) =>
    pattern.test(value);
const any: Admits = () => true;

/** The schemes `safeMarkdown.ts` lets a link have, checked again here. */
const SAFE_LINK: Admits = (value) => /^(https?:|mailto:)/i.test(value.trim());
const TEXT_ALIGN = matches(/^text-align:\s*(left|center|right|justify)\s*;?$/);
const NONE: ReadonlyMap<string, Admits> = new Map();

/**
 * Every element a renderer writes, with the attributes it writes on it. The
 * engine's renderer writes the aligned blocks, `hr`, `br` and the three
 * marks; markdown-it, with HTML off, writes the rest; `safeMarkdown.ts` adds
 * the citation button and the web-citation mark, and `ReferenceReader.tsx`
 * the aside wrapper.
 */
const DIALECT: ReadonlyMap<string, ReadonlyMap<string, Admits>> = new Map<
  string,
  ReadonlyMap<string, Admits>
>([
  ["p", new Map([["style", TEXT_ALIGN]])],
  ["h1", new Map([["style", TEXT_ALIGN]])],
  ["h2", new Map([["style", TEXT_ALIGN]])],
  ["h3", NONE],
  ["h4", NONE],
  ["h5", NONE],
  ["h6", NONE],
  ["br", NONE],
  ["hr", NONE],
  ["strong", NONE],
  ["em", NONE],
  ["s", NONE],
  ["code", new Map([["class", matches(/^language-\S*$/)]])],
  ["pre", NONE],
  ["blockquote", NONE],
  ["ul", NONE],
  ["ol", new Map([["start", matches(/^\d+$/)]])],
  ["li", NONE],
  ["table", NONE],
  ["thead", NONE],
  ["tbody", NONE],
  ["tr", NONE],
  ["th", new Map([["style", TEXT_ALIGN]])],
  ["td", new Map([["style", TEXT_ALIGN]])],
  [
    "a",
    new Map([
      ["href", SAFE_LINK],
      ["rel", matches(/^noopener noreferrer nofollow$/)],
      ["target", matches(/^_blank$/)],
      ["title", any],
    ]),
  ],
  [
    "button",
    new Map([
      ["type", matches(/^button$/)],
      ["class", matches(/^ai-cite$/)],
      ["data-cite", matches(/^\S+$/)],
      ["aria-label", any],
    ]),
  ],
  ["sup", new Map([["class", matches(/^ai-web-mark$/)]])],
  ["div", new Map([["class", matches(/^tpl-note$/)]])],
]);

/**
 * Throws unless `html` parses to the rendered dialect and nothing else.
 * `parse` makes the inert document the check walks.
 *
 * The message names the element or attribute refused, never the text around
 * it: the text is a manuscript's or a model's, and the console is not where
 * either belongs.
 */
export function checkRendered(
  html: string,
  parse: (html: string) => Document,
): void {
  const doc = parse(html);
  const refuse = (what: string): never => {
    throw new TypeError(`markup refused by the rendered dialect: ${what}`);
  };
  // A `<base>`, `<meta>` or `<title>` lands in the head; a `<frameset>` or
  // an attribute on `<body>` or `<html>` lands on the frame.
  if (doc.head.childNodes.length > 0) refuse("markup in the head");
  const body = doc.body;
  if (
    !body ||
    body.localName !== "body" ||
    body.attributes.length > 0 ||
    doc.documentElement.attributes.length > 0
  )
    refuse("markup on the frame");

  const visit = (parent: Node): void => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === TEXT) continue;
      if (node.nodeType !== ELEMENT) refuse(`a node of type ${node.nodeType}`);
      const el = node as Element;
      const admitted =
        el.namespaceURI === HTML_NAMESPACE
          ? DIALECT.get(el.localName)
          : undefined;
      if (!admitted) refuse(`<${el.localName}>`);
      for (const attr of Array.from(el.attributes)) {
        const admits = admitted?.get(attr.name);
        if (!admits || !admits(attr.value))
          refuse(`<${el.localName} ${attr.name}>`);
      }
      visit(el);
    }
  };
  visit(body);
}
