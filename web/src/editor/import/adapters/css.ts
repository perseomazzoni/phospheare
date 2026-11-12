// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Just enough CSS to find the italics. An online word processor's "download
// as web page" sets no `<em>` at all: every italic is a `<span class="c7">`
// and `.c7{font-style:italic}` sits in a `<style>` in the head. A reader that
// looks only at tags loses every italic in the book, the complaint writers
// make loudest. So the walker reads class rules and inline styles for the
// handful of properties that carry meaning in a manuscript, and nothing else:
// no cascade, no specificity, no inheritance beyond what the walker passes
// down itself.

export interface StyleProps {
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  strike?: boolean;
  mono?: boolean;
  caps?: boolean;
  hidden?: boolean;
  align?: "left" | "center" | "right" | "justify";
  fontSizePt?: number;
  breakBefore?: boolean;
  breakAfter?: boolean;
  /** `mso-outline-level`, a desktop word processor's HTML heading level. */
  outlineLevel?: number;
}

const MONO = /\b(monospace|courier|consolas|menlo|monaco|"?source code)/i;

function sizeInPt(value: string): number | undefined {
  const match = /^([\d.]+)\s*(pt|px|em|rem|%)?$/.exec(value.trim());
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  switch (match[2]) {
    case "px":
      return n * 0.75;
    case "em":
    case "rem":
      return n * 12;
    case "%":
      return (n / 100) * 12;
    default:
      return n;
  }
}

/** Reads one `style` attribute or rule body, ignoring unknown properties. */
export function parseDeclarations(body: string): StyleProps {
  const props: StyleProps = {};
  for (const decl of body.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim().toLowerCase();
    const value = decl
      .slice(colon + 1)
      .replace(/!important/i, "")
      .trim()
      .toLowerCase();
    switch (name) {
      case "font-style":
        props.italic = value === "italic" || value === "oblique";
        break;
      case "font-weight":
        props.bold =
          value === "bold" || value === "bolder" || Number(value) >= 600;
        break;
      case "text-decoration":
      case "text-decoration-line":
        if (value.includes("underline")) props.underline = true;
        if (value.includes("line-through")) props.strike = true;
        if (value === "none") props.underline = props.strike = false;
        break;
      case "font-family":
        if (MONO.test(value)) props.mono = true;
        break;
      case "text-transform":
        props.caps = value === "uppercase";
        break;
      case "font-variant":
        if (value.includes("small-caps")) props.caps = true;
        break;
      case "display":
        if (value === "none") props.hidden = true;
        break;
      case "visibility":
        if (value === "hidden") props.hidden = true;
        break;
      case "text-align":
        if (
          value === "center" ||
          value === "right" ||
          value === "justify" ||
          value === "left"
        )
          props.align = value;
        break;
      case "font-size": {
        const pt = sizeInPt(value);
        if (pt !== undefined) props.fontSizePt = pt;
        break;
      }
      case "page-break-before":
      case "break-before":
        if (/always|page|left|right|recto|verso/.test(value))
          props.breakBefore = true;
        break;
      case "page-break-after":
      case "break-after":
        if (/always|page|left|right|recto|verso/.test(value))
          props.breakAfter = true;
        break;
      case "mso-outline-level": {
        const level = Number(value);
        if (level >= 1 && level <= 6) props.outlineLevel = level;
        break;
      }
    }
  }
  return props;
}

/**
 * Class rules from every `<style>` text: `.c7{…}`, `p.c3, span.c4 {…}`.
 * Selectors that are not a plain class, with an optional tag, are skipped:
 * word processors' HTML exports write nothing else that carries emphasis.
 */
export function classRules(sheets: readonly string[]): Map<string, StyleProps> {
  const rules = new Map<string, StyleProps>();
  for (const sheet of sheets) {
    const css = sheet
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const props = parseDeclarations(match[2]);
      for (const selector of match[1].split(",")) {
        const cls = /^\s*[a-z0-9]*\.([\w-]+)\s*$/i.exec(selector);
        if (!cls) continue;
        rules.set(cls[1], { ...rules.get(cls[1]), ...props });
      }
    }
  }
  return rules;
}
