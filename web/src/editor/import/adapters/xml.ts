// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { parseDocument } from "../../../security/trustedHtml";
import { ReadRefused } from "./failure";

// Reads XML parts. The packages' insides are XML, parsed by the browser's own
// `DOMParser` into an inert document: no script runs in it, no image loads
// from it, nothing it names is fetched. The one XML danger that survives is
// entity expansion, a "billion laughs" of nested `<!ENTITY>` definitions that
// expand a kilobyte into gigabytes. No manuscript format defines its own
// entities, so a part that declares one is refused before it is parsed.
//
// Elements are matched by local name, never by prefix: a .docx writes `w:p`
// in the Transitional namespace and the same `w:p` in the Strict one, and a
// producer is free to bind any prefix at all. `getElementsByTagNameNS("*")`
// and `localName` are the namespace-blind way to ask.

/**
 * Parses one XML part. Refuses entity declarations; a part that does not
 * parse is damaged.
 */
export function parseXml(text: string): Document {
  if (/<!ENTITY/i.test(text))
    throw new ReadRefused("damaged", "entity declaration");
  const doc = parseDocument(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0)
    throw new ReadRefused("damaged", "xml does not parse");
  return doc;
}

/** Element children with this local name in any namespace, or all of them. */
export function kids(el: Element | Document, localName?: string): Element[] {
  const out: Element[] = [];
  for (const node of Array.from(el.childNodes))
    if (
      node.nodeType === 1 &&
      (!localName || (node as Element).localName === localName)
    )
      out.push(node as Element);
  return out;
}

/** The first element child with this local name, or `null`. */
export function kid(el: Element | Document, localName: string): Element | null {
  for (const node of Array.from(el.childNodes))
    if (node.nodeType === 1 && (node as Element).localName === localName)
      return node as Element;
  return null;
}

/** Every descendant element with this local name, in document order. */
export function descendants(
  el: Element | Document,
  localName: string,
): Element[] {
  return Array.from(el.getElementsByTagNameNS("*", localName));
}

/** The first descendant with this local name, or `null`. */
export function descendant(
  el: Element | Document,
  localName: string,
): Element | null {
  return el.getElementsByTagNameNS("*", localName)[0] ?? null;
}

/** An attribute by local name, whatever its prefix (`w:val`, `val`). */
export function attr(el: Element, localName: string): string | null {
  for (const a of Array.from(el.attributes))
    if (a.localName === localName) return a.value;
  return null;
}

/** A .docx on/off element: present means on, unless its value says off. */
export function onOff(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const value = attr(el, "val");
  return value === null || !/^(0|false|off|none)$/i.test(value);
}

/**
 * Resolves a package-relative path, as `../Text/ch1.xhtml` from
 * `OEBPS/nav.xhtml`.
 */
export function resolvePath(base: string, relative: string): string {
  const clean = decodeURIComponent(relative.split("#")[0]);
  if (clean.startsWith("/")) return clean.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const segment of clean.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}
