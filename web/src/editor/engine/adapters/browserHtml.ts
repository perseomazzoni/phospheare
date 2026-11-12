// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── Browser clipboard codec ──────────────────────────────────────────────────
//
// The browser adapter for the `ClipboardCodec` port. The outbound half is a
// composition: `extractRange` makes the selection a fragment, with page
// breaks reduced to blank lines, and the editor's own renderer turns it into
// the `text/html` flavor, the dialect word processors read.
//
// The inbound half, `parseHtml`, is the security boundary: a DOM-free
// allowlist parser. It recognizes the semantic tags (`strong`, `em`, `b`,
// `i`, `code`, `h1` to `h6`, `p`, `br`) and the inline-style hints word
// processors emit (`font-weight`, `font-style`, `font-family`,
// `mso-outline-level`), and keeps one attribute, `text-align`. Everything
// else is dropped, and the content of active elements (`script`, `style`,
// `iframe`, `svg` and the rest of `SKIP_CONTENT`) goes with it. The output
// is a valid document of runs the model can hold: text is never interpreted
// as markup, and no URL, attribute or executable element survives.

import type {
  Alignment,
  BlockType,
  Doc,
  Format,
  Paragraph,
  Range,
  Run,
} from "../domain/model";
import {
  charsToRuns,
  extractRange,
  parsePlainText,
  sliceText,
} from "../domain/operations";
import type { ClipboardCodec } from "../ports/clipboard";
import { htmlRenderer } from "./html";

type Char = { char: string; format: Format };

const plainFormat = (): Format => ({
  bold: false,
  italic: false,
  monospace: false,
});

function emptyRun(): Run {
  return { text: "", format: plainFormat() };
}

export const browserClipboardCodec: ClipboardCodec = {
  buildPlain(doc: Doc, range: Range): string {
    return sliceText(doc, range);
  },

  buildHtml(doc: Doc, range: Range): string {
    return htmlRenderer.render(extractRange(doc, range));
  },

  parsePlain(text: string): Doc {
    return parsePlainText(text);
  },

  parseHtml(html: string): Doc {
    return parseHtmlAllowlist(html);
  },
};

// ── The inbound parser ───────────────────────────────────────────────────────

const SKIP_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "head",
  "title",
  "noscript",
  "template",
  "canvas",
  "video",
  "audio",
  "select",
  "textarea",
  "form",
  "button",
  "applet",
  "frame",
  "frameset",
  "noframes",
]);

const BLOCK = new Set([
  "p",
  "div",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "blockquote",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "table",
  "tr",
  "ul",
  "ol",
]);

const BOLD = new Set(["b", "strong"]);
const ITALIC = new Set(["i", "em"]);
const MONO = new Set(["code", "tt", "kbd", "samp"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  eacute: "é",
  egrave: "è",
  euml: "ë",
  ecirc: "ê",
  aacute: "á",
  agrave: "à",
  auml: "ä",
  acirc: "â",
  iacute: "í",
  igrave: "ì",
  iuml: "ï",
  icirc: "î",
  oacute: "ó",
  ograve: "ò",
  ouml: "ö",
  ocirc: "ô",
  uacute: "ú",
  ugrave: "ù",
  uuml: "ü",
  ucirc: "û",
  ccedil: "ç",
  ntilde: "ñ",
  szlig: "ß",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (Number.isNaN(code)) return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return NAMED_ENTITIES[body] ?? whole;
    },
  );
}

// Skip elements that hold no content: the void ones never close, and the
// foreign ones (`svg`, `math`) close themselves when written `<svg/>`, as
// HTML parses them. Skipping from either would skip the rest of the paste.
const VOID_SKIP = new Set(["embed", "frame"]);
const FOREIGN_SKIP = new Set(["svg", "math"]);

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: string;
}

/** Whether an opening skip tag opens content to skip. */
function opensSkip(tag: Tag): boolean {
  return (
    SKIP_CONTENT.has(tag.name) &&
    !VOID_SKIP.has(tag.name) &&
    !(tag.selfClosing && FOREIGN_SKIP.has(tag.name))
  );
}

function parseTag(raw: string): Tag | null {
  let s = raw;
  const selfClosing = s.endsWith("/");
  if (selfClosing) s = s.slice(0, -1);
  const closing = s.startsWith("/");
  if (closing) s = s.slice(1);
  // The tag name must follow "<" or "</" immediately; after a space, "<" is
  // literal text. The caller guards on this too.
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  if (!m) return null;
  return {
    name: m[1].toLowerCase(),
    closing,
    selfClosing,
    attrs: s.slice(m[0].length),
  };
}

function styleAttr(attrs: string): string | null {
  const m = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  return m ? (m[1] ?? m[2]) : null;
}

function inlineFormat(attrs: string): Format {
  const s = styleAttr(attrs);
  if (!s) return plainFormat();
  return {
    bold: /font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(s),
    italic: /font-style\s*:\s*(italic|oblique)/i.test(s),
    monospace:
      /font-family\s*:\s*[^;"']*(mono|courier|consol|menlo|monaco|andale|source code)/i.test(
        s,
      ),
  };
}

function textAlign(attrs: string): Alignment {
  const s = styleAttr(attrs);
  if (!s) return "left";
  const m = s.match(/text-align\s*:\s*(left|center|right|justify)/i);
  return m ? (m[1].toLowerCase() as Alignment) : "left";
}

/** Word marks headings with `mso-outline-level` rather than `<h1>`/`<h2>`. */
function msoHeadingLevel(attrs: string): 0 | 1 | 2 {
  const s = styleAttr(attrs);
  if (!s) return 0;
  const m = s.match(/mso-outline-level\s*:\s*(\d+)/i);
  if (!m) return 0;
  const level = parseInt(m[1], 10);
  return level === 1 ? 1 : level > 1 ? 2 : 0;
}

function parseHtmlAllowlist(html: string): Doc {
  const paras: Paragraph[] = [];
  let current: Char[] = [];
  let blockType: BlockType = "paragraph";
  let alignment: Alignment = "left";
  const formatStack: Format[] = [plainFormat()];
  // The open skip elements, innermost last. A closing tag pops back to its
  // own opening tag, so `<head><style></style></head>` ends the skip at
  // `</head>` however the elements nest.
  const skipping: string[] = [];
  // Inside `<pre>` a source line break is a line break; elsewhere it is a
  // space, as HTML renders it.
  let preDepth = 0;
  // A source line break waiting to become one space before the next text;
  // it never starts or ends a paragraph.
  let pendingSpace: Format | null = null;

  const currentFormat = (): Format => formatStack[formatStack.length - 1];
  const pushFormat = (f: Format) => formatStack.push(f);
  const popFormat = () => {
    if (formatStack.length > 1) formatStack.pop();
  };

  const endParagraph = (allowEmpty: boolean) => {
    pendingSpace = null;
    const text = current.map((c) => c.char).join("");
    // Nothing before the first content is flushed.
    if (current.length === 0 && paras.length === 0) {
      current = [];
      return;
    }
    // An empty line is flushed only when the caller asks for one: a `<br>`
    // does and a closing block tag does not, so `<p><br></p>` is one blank
    // line, not two.
    if (current.length === 0 && !allowEmpty) {
      current = [];
      return;
    }
    paras.push({
      runs: text.trim() === "" ? [emptyRun()] : charsToRuns(current),
      alignment,
      blockType,
    });
    current = [];
  };

  const startBlock = (type: BlockType, align: Alignment) => {
    if (current.length > 0) endParagraph(false);
    blockType = type;
    alignment = align;
  };

  // One format object for the whole text, shared by its characters, since a
  // paste of a megabyte is a million characters. `charsToRuns` copies the
  // format into the run it builds, so the chars are never written through.
  const pushChars = (text: string) => {
    if (pendingSpace && current.length > 0) {
      current.push({ char: " ", format: pendingSpace });
    }
    pendingSpace = null;
    const fmt = currentFormat();
    for (const ch of text) current.push({ char: ch, format: fmt });
  };

  const handleText = (text: string) => {
    if (!text || skipping.length > 0) return;
    if (preDepth > 0) {
      const parts = decodeEntities(text)
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");
      for (let k = 0; k < parts.length; k++) {
        if (k > 0) endParagraph(true);
        if (parts[k]) pushChars(parts[k]);
      }
      return;
    }
    // A source line break, with the blanks around it, is one space between
    // words and nothing at the edge of a paragraph.
    const parts = text.split(/[ \t\f]*[\r\n][ \t\f\r\n]*/);
    for (let k = 0; k < parts.length; k++) {
      if (k > 0) pendingSpace = currentFormat();
      if (parts[k]) {
        pushChars(decodeEntities(parts[k]).replace(/[\r\n]/g, " "));
      }
    }
  };

  const handleTag = (tag: Tag) => {
    if (skipping.length > 0) {
      if (!tag.closing && opensSkip(tag)) skipping.push(tag.name);
      else if (tag.closing) {
        const at = skipping.lastIndexOf(tag.name);
        if (at !== -1) skipping.length = at;
      }
      return;
    }

    if (tag.closing) {
      if (SKIP_CONTENT.has(tag.name)) return;
      if (tag.name === "br" || tag.name === "hr") {
        endParagraph(true);
        return;
      }
      // `<pre>` pushed a monospace frame, which its closing tag pops.
      if (tag.name === "pre" && preDepth > 0) {
        preDepth--;
        popFormat();
      }
      if (BLOCK.has(tag.name)) {
        endParagraph(false);
        blockType = "paragraph";
        alignment = "left";
        return;
      }
      if (BOLD.has(tag.name) || ITALIC.has(tag.name) || MONO.has(tag.name)) {
        popFormat();
        return;
      }
      // An inline tag with no model format still pushed a frame to pop.
      if (
        tag.name === "span" ||
        tag.name === "font" ||
        tag.name === "u" ||
        tag.name === "s" ||
        tag.name === "strike" ||
        tag.name === "del" ||
        tag.name === "a" ||
        tag.name === "sub" ||
        tag.name === "sup"
      ) {
        popFormat();
        return;
      }
      return;
    }

    if (SKIP_CONTENT.has(tag.name)) {
      if (opensSkip(tag)) skipping.push(tag.name);
      return;
    }
    if (tag.name === "br" || tag.name === "hr") {
      endParagraph(true);
      return;
    }
    if (tag.name === "pre") {
      preDepth++;
      startBlock("paragraph", textAlign(tag.attrs));
      pushFormat({ ...currentFormat(), monospace: true });
      return;
    }
    if (BLOCK.has(tag.name)) {
      let type: BlockType = "paragraph";
      if (tag.name === "h1") type = "h1";
      else if (tag.name === "h2") type = "h2";
      else if (
        tag.name === "h3" ||
        tag.name === "h4" ||
        tag.name === "h5" ||
        tag.name === "h6"
      )
        type = "h2";
      else {
        const lvl = msoHeadingLevel(tag.attrs);
        if (lvl === 1) type = "h1";
        else if (lvl === 2) type = "h2";
      }
      startBlock(type, textAlign(tag.attrs));
      return;
    }
    if (BOLD.has(tag.name)) {
      pushFormat({ ...currentFormat(), bold: true });
      return;
    }
    if (ITALIC.has(tag.name)) {
      pushFormat({ ...currentFormat(), italic: true });
      return;
    }
    if (MONO.has(tag.name)) {
      pushFormat({ ...currentFormat(), monospace: true });
      return;
    }
    if (tag.name === "span" || tag.name === "font") {
      const f = inlineFormat(tag.attrs);
      pushFormat({
        bold: currentFormat().bold || f.bold,
        italic: currentFormat().italic || f.italic,
        monospace: currentFormat().monospace || f.monospace,
      });
      return;
    }
    if (
      tag.name === "u" ||
      tag.name === "s" ||
      tag.name === "strike" ||
      tag.name === "del" ||
      tag.name === "a" ||
      tag.name === "sub" ||
      tag.name === "sup"
    ) {
      pushFormat({ ...currentFormat() });
    }
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      handleText(html.slice(i));
      break;
    }
    if (lt > i) handleText(html.slice(i, lt));
    i = lt;

    const next = html[i + 1];
    if (next === "!") {
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? n : end + 3;
      } else if (html.startsWith("<![CDATA[", i)) {
        const end = html.indexOf("]]>", i + 9);
        handleText(html.slice(i + 9, end === -1 ? n : end));
        i = end === -1 ? n : end + 3;
      } else {
        const end = html.indexOf(">", i);
        i = end === -1 ? n : end + 1;
      }
      continue;
    }
    if (next === "?") {
      const end = html.indexOf(">", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (!(
      next === "/" ||
      (next >= "a" && next <= "z") ||
      (next >= "A" && next <= "Z")
    )) {
      // "<" followed by anything that cannot start a tag is literal text.
      handleText("<");
      i = lt + 1;
      continue;
    }

    const tagStart = i;
    const gt = html.indexOf(">", i);
    if (gt === -1) {
      handleText(html.slice(i));
      break;
    }
    const tag = parseTag(html.slice(i + 1, gt));
    i = gt + 1;
    if (!tag) {
      handleText(html.slice(tagStart, i));
      continue;
    }
    handleTag(tag);
  }

  endParagraph(false);

  // Trailing blank lines a final `<br>` or `</p>` left are dropped, keeping
  // at least one paragraph.
  while (
    paras.length > 1 &&
    paras[paras.length - 1].runs.every((r) => r.text.trim() === "")
  ) {
    paras.pop();
  }
  if (paras.length === 0)
    paras.push({
      runs: [emptyRun()],
      alignment: "left",
      blockType: "paragraph",
    });

  return paras;
}
