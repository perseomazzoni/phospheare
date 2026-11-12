// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { attr, kid, kids, onOff, parseXml } from "../xml";

// A .docx's styles, resolved as the format specifies. Most of a .docx's
// italics are not in the runs. A novelist who formats with styles ("Emphasis"
// for a stressed word, "Quote" for a letter, a "Chapter Title" built on
// Heading 1) leaves the formatting in styles.xml, and a reader that looks
// only at direct formatting imports a book with no italics in it, the
// complaint writers make loudest about importers.
//
// Two rules make it right:
//
//   - Inheritance: a style is its own properties over its `basedOn` style's,
//     to any depth; a cycle is cut, never followed forever.
//   - Toggles: bold, italic, caps, strike and hidden are toggle properties
//     (ECMA-376 Part 1, section 17.7.3). A character style's italic, applied
//     in a paragraph whose style is already italic, turns italic off, which
//     is how "Emphasis" in an italic block quote comes out upright, as the app
//     it was written in draws it. Direct formatting on the run is absolute,
//     and wins over both.
//
// Headings are matched by style name ("heading 1", written in English in
// every localisation) or by outline level, never by style id, which a
// localised app writes as "Titolo1" or "Überschrift1".

export interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  caps?: boolean;
  strike?: boolean;
  hidden?: boolean;
  mono?: boolean;
  /** Points. */
  size?: number;
}

export interface ParaProps {
  /** 0-based, as the format writes it; 9 means "body text". */
  outlineLevel?: number;
  align?: "left" | "center" | "right" | "justify";
  pageBreakBefore?: boolean;
}

interface Style {
  id: string;
  name: string;
  type: string;
  basedOn?: string;
  run: RunProps;
  para: ParaProps;
}

const TOGGLES = ["bold", "italic", "caps", "strike", "hidden"] as const;
const MONO = /courier|consolas|menlo|monaco|mono|source code/i;

/** Run properties as `<w:rPr>` states them; absent means "not said". */
export function readRunProps(rPr: Element | null): RunProps {
  const props: RunProps = {};
  if (!rPr) return props;
  const b = kid(rPr, "b");
  if (b) props.bold = onOff(b);
  const i = kid(rPr, "i");
  if (i) props.italic = onOff(i);
  const u = kid(rPr, "u");
  if (u) {
    const value = attr(u, "val");
    props.underline = value !== "none" && value !== "0" && value !== "false";
  }
  const caps = kid(rPr, "caps") ?? kid(rPr, "smallCaps");
  if (caps) props.caps = onOff(caps);
  const strike = kid(rPr, "strike") ?? kid(rPr, "dstrike");
  if (strike) props.strike = onOff(strike);
  const vanish = kid(rPr, "vanish");
  if (vanish) props.hidden = onOff(vanish);
  const fonts = kid(rPr, "rFonts");
  const face = fonts ? (attr(fonts, "ascii") ?? attr(fonts, "hAnsi")) : null;
  if (face) props.mono = MONO.test(face);
  const sz = kid(rPr, "sz");
  const half = sz ? Number(attr(sz, "val")) : NaN;
  if (Number.isFinite(half) && half > 0) props.size = half / 2;
  return props;
}

export function readParaProps(pPr: Element | null): ParaProps {
  const props: ParaProps = {};
  if (!pPr) return props;
  const outline = kid(pPr, "outlineLvl");
  const level = outline ? Number(attr(outline, "val")) : NaN;
  if (Number.isInteger(level)) props.outlineLevel = level;
  const jc = kid(pPr, "jc");
  const align = jc ? attr(jc, "val") : null;
  if (align === "center") props.align = "center";
  else if (align === "right" || align === "end") props.align = "right";
  else if (align === "both" || align === "distribute") props.align = "justify";
  else if (align === "left" || align === "start") props.align = "left";
  const pb = kid(pPr, "pageBreakBefore");
  if (pb) props.pageBreakBefore = onOff(pb);
  return props;
}

export class DocxStyles {
  private readonly styles = new Map<string, Style>();
  private readonly defaults: RunProps;
  /** The paragraph style a paragraph with no `pStyle` takes. */
  readonly defaultPara?: string;
  /** The document's language, from the defaults (`w:lang`). */
  readonly language?: string;

  constructor(xml: string | null) {
    let defaults: RunProps = {};
    let defaultPara: string | undefined;
    let language: string | undefined;
    if (xml) {
      const doc = parseXml(xml);
      const root = doc.documentElement;
      const rPrDefault = kid(kid(root, "docDefaults") ?? root, "rPrDefault");
      const rPr = rPrDefault ? kid(rPrDefault, "rPr") : null;
      defaults = readRunProps(rPr);
      const lang = rPr ? kid(rPr, "lang") : null;
      language = (lang && attr(lang, "val")) || undefined;
      for (const el of kids(root, "style")) {
        const id = attr(el, "styleId");
        if (!id) continue;
        const nameEl = kid(el, "name");
        const basedOn = kid(el, "basedOn");
        const style: Style = {
          id,
          name:
            (nameEl ? attr(nameEl, "val") : null)?.toLowerCase() ??
            id.toLowerCase(),
          type: attr(el, "type") ?? "paragraph",
          basedOn: (basedOn && attr(basedOn, "val")) || undefined,
          run: readRunProps(kid(el, "rPr")),
          para: readParaProps(kid(el, "pPr")),
        };
        this.styles.set(id, style);
        if (
          style.type === "paragraph" &&
          /^(1|true|on)$/.test(attr(el, "default") ?? "")
        )
          defaultPara = id;
      }
    }
    this.defaults = defaults;
    this.defaultPara = defaultPara;
    this.language = language;
  }

  /** A style's chain, nearest first: itself, its basedOn, and so on. */
  private chain(id: string | undefined): Style[] {
    const out: Style[] = [];
    const seen = new Set<string>();
    for (let style = id ? this.styles.get(id) : undefined; style;) {
      if (seen.has(style.id)) break;
      seen.add(style.id);
      out.push(style);
      style = style.basedOn ? this.styles.get(style.basedOn) : undefined;
    }
    return out;
  }

  /** The nearest value a chain states for a property. */
  private static nearest<K extends keyof RunProps>(
    chain: Style[],
    key: K,
  ): RunProps[K] {
    for (const style of chain)
      if (style.run[key] !== undefined) return style.run[key];
    return undefined;
  }

  /** The style's name, lower case ("heading 1"), or `null`. */
  nameOf(id: string | undefined): string | null {
    const style = id ? this.styles.get(id) : undefined;
    return style ? style.name : null;
  }

  /** A paragraph's properties: its style chain under its direct ones. */
  paragraph(styleId: string | undefined, direct: ParaProps): ParaProps {
    const out: ParaProps = {};
    for (const style of this.chain(styleId ?? this.defaultPara).reverse())
      Object.assign(out, stripUndefined(style.para));
    return Object.assign(out, stripUndefined(direct));
  }

  /** A run's effective properties, by inheritance and the toggle rule. */
  run(
    paraStyle: string | undefined,
    runStyle: string | undefined,
    direct: RunProps,
  ): RunProps {
    const pChain = this.chain(paraStyle ?? this.defaultPara);
    const rChain = this.chain(runStyle);
    const out: RunProps = {};
    for (const key of TOGGLES) {
      const base = DocxStyles.nearest(pChain, key) ?? this.defaults[key];
      const toggle = DocxStyles.nearest(rChain, key);
      const styled = toggle === undefined ? base : toggle !== !!base;
      const value = direct[key] ?? styled;
      if (value !== undefined) out[key] = value;
    }
    for (const key of ["underline", "mono", "size"] as const) {
      const value =
        direct[key] ??
        DocxStyles.nearest(rChain, key) ??
        DocxStyles.nearest(pChain, key) ??
        this.defaults[key];
      if (value !== undefined) (out as Record<string, unknown>)[key] = value;
    }
    return out;
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
