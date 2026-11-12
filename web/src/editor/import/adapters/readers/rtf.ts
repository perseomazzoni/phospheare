// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  bump,
  emptySource,
  type Align,
  type ImportedComment,
  type Inline,
  type Signals,
  type SourceDocument,
} from "../../domain/source";
import type { FormatReader } from "../../ports";
import { codepageLabel } from "../decode";
import { ReadRefused } from "../failure";
import { cleanInlines, FlowBuilder, COMMENT_MARK, pacer } from "../flowBuilder";

// Reads Rich Text Format, the drafting apps' compile format and the lingua
// franca of older word processors. RTF is a stream of groups and control
// words, read here by its own tokenizer: the platform has no parser for it,
// and the libraries that exist either render to HTML or drop the encoding
// rules that matter:
//
//   - text bytes are decoded by the code page of the font in use
//     (`\fcharset`), falling back to the document's (`\ansicpg`), so a Polish
//     manuscript in cp1250 reads as Polish, not as Western mojibake;
//   - `\uN` is a Unicode character followed by `\ucN` fallback characters to
//     skip, so a curly quote is read once, not twice;
//   - `\bin` skips its bytes; ignorable destinations (`{\*\…}`) and the
//     known non-text ones (font table, colours, pictures, headers) are
//     stepped over;
//   - character state (`\b`, `\i`, `\ul`, `\v` for hidden, `\caps`,
//     `\strike`, `\fs`) lives on a group stack and is reset by `\plain`;
//     paragraph state is reset by `\pard`;
//   - a field keeps its result (`\fldrslt`), unless it is a table of
//     contents; `\deleted` text, a tracked deletion, is dropped;
//   - comments (`\annotation`, ranged by `\atrfstart`/`\atrfend`) become
//     notes; footnotes (`\footnote`, endnotes with `\ftnalt`) are counted
//     and skipped, never read as text.

const CHARSET_CODEPAGE: Record<number, number> = {
  0: 1252,
  77: 10000,
  128: 932,
  129: 949,
  134: 936,
  136: 950,
  161: 1253,
  162: 1254,
  163: 1258,
  177: 1255,
  178: 1256,
  186: 1257,
  204: 1251,
  222: 874,
  238: 1250,
};

const LCID: Record<number, string> = {
  1033: "en-US",
  2057: "en-GB",
  3081: "en-AU",
  4105: "en-CA",
  1040: "it-IT",
  1036: "fr-FR",
  3084: "fr-CA",
  1031: "de-DE",
  2055: "de-CH",
  3082: "es-ES",
  1034: "es-ES",
  2058: "es-MX",
  2070: "pt-PT",
  1046: "pt-BR",
  1043: "nl-NL",
  1045: "pl-PL",
  1049: "ru-RU",
  1053: "sv-SE",
  1030: "da-DK",
  1044: "nb-NO",
  1035: "fi-FI",
};

/** Destinations whose contents are never the book. */
const SKIP = new Set([
  "colortbl",
  "header",
  "headerl",
  "headerr",
  "headerf",
  "footer",
  "footerl",
  "footerr",
  "footerf",
  "listtable",
  "listoverridetable",
  "revtbl",
  "rsidtbl",
  "generator",
  "xmlnstbl",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "pgdsctbl",
  "mmathPr",
  "listtext",
  "pntext",
  "pntxta",
  "pntxtb",
  "bkmkstart",
  "bkmkend",
  "nonshppict",
  "xe",
  "tc",
  "txe",
  "fldtype",
  "atndate",
  "atnicn",
  "atntime",
  "ftnsep",
  "ftnsepc",
  "ftncn",
  "aftnsep",
  "aftnsepc",
  "aftncn",
]);

const SYMBOLS: Record<string, string> = {
  emdash: "—",
  endash: "–",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
  bullet: "•",
  emspace: " ",
  enspace: " ",
  qmspace: " ",
};

interface CharState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  caps: boolean;
  strike: boolean;
  hidden: boolean;
  deleted: boolean;
  size: number;
  font: number;
  uc: number;
}

interface ParaState {
  align: Align;
  style: number;
  outline?: number;
  pageBefore: boolean;
  inTable: boolean;
}

const PLAIN: Omit<CharState, "uc"> = {
  bold: false,
  italic: false,
  underline: false,
  caps: false,
  strike: false,
  hidden: false,
  deleted: false,
  size: 12,
  font: -1,
};

const freshPara = (): ParaState => ({
  align: "left",
  style: 0,
  pageBefore: false,
  inTable: false,
});

interface Font {
  codepage?: number;
  mono: boolean;
}

/** Where text goes: the book, or a comment's body. */
interface Sink {
  paras: {
    inlines: Inline[];
    refs: string[];
    para: ParaState;
    breakBefore: boolean;
  }[];
  current: { inlines: Inline[]; refs: string[] };
}

const newSink = (): Sink => ({ paras: [], current: { inlines: [], refs: [] } });

class RtfParser {
  private i = 0;
  private readonly s: string;
  private char: CharState = { ...PLAIN, uc: 1 };
  private para: ParaState = freshPara();
  private readonly stack: { char: CharState; para: ParaState }[] = [];
  private defaultCodepage = 1252;
  private defaultFont = 0;
  private readonly fonts = new Map<number, Font>();
  readonly styles = new Map<number, { name: string; outline?: number }>();
  private bytes: number[] = [];
  private sink: Sink = newSink();
  readonly main = this.sink;
  private pendingBreak = false;
  readonly comments: ImportedComment[] = [];
  private commentCount = 0;
  private lastAuthor: string | undefined;
  private lastInitials: string | undefined;
  readonly info: { title?: string; author?: string } = {};
  language?: string;

  constructor(
    text: string,
    private readonly doc: SourceDocument,
  ) {
    this.s = text;
  }

  parse(): void {
    // The outermost group is the document; anything after it is ignored.
    while (this.i < this.s.length && this.s[this.i] !== "{") this.i += 1;
    this.group(0);
    this.endParagraph();
  }

  private flushBytes(): void {
    if (!this.bytes.length) return;
    const text = this.decodeBytes(this.bytes);
    this.bytes = [];
    this.emit(text);
  }

  /** Text bytes, decoded by the code page of the font in use. */
  private decodeBytes(bytes: number[]): string {
    const font = this.fonts.get(
      this.char.font >= 0 ? this.char.font : this.defaultFont,
    );
    return decodeCodepage(bytes, font?.codepage ?? this.defaultCodepage);
  }

  /** One `\x27hh` byte, decoded by the document's code page. */
  private byteChar(hex: string): string {
    const byte = parseInt(hex, 16);
    if (!Number.isFinite(byte)) return "";
    return decodeCodepage([byte], this.defaultCodepage);
  }

  private emit(text: string): void {
    if (!text) return;
    if (this.char.deleted) {
      if (text.trim()) bump(this.doc.report, "trackedChanges");
      return;
    }
    if (this.char.hidden) {
      if (text.trim()) bump(this.doc.report, "hiddenText");
      return;
    }
    const font = this.fonts.get(
      this.char.font >= 0 ? this.char.font : this.defaultFont,
    );
    this.sink.current.inlines.push({
      text,
      bold: this.char.bold,
      italic: this.char.italic,
      underline: this.char.underline,
      mono: font?.mono,
    });
  }

  private mark(key: string): void {
    this.flushBytes();
    this.sink.current.inlines.push({ text: COMMENT_MARK });
    this.sink.current.refs.push(key);
  }

  private endParagraph(force = false): void {
    this.flushBytes();
    const current = this.sink.current;
    if (
      !force &&
      !current.inlines.length &&
      !current.refs.length &&
      this.sink === this.main
    ) {
      this.sink.current = { inlines: [], refs: [] };
      return;
    }
    this.sink.paras.push({
      ...current,
      para: { ...this.para },
      breakBefore: this.pendingBreak || this.para.pageBefore,
    });
    this.pendingBreak = false;
    this.sink.current = { inlines: [], refs: [] };
  }

  /** Reads a control word at `i`, just after the backslash. */
  private word(): { name: string; param?: number } {
    const start = this.i;
    while (this.i < this.s.length && /[a-zA-Z]/.test(this.s[this.i]))
      this.i += 1;
    const name = this.s.slice(start, this.i);
    let param: number | undefined;
    const numStart = this.i;
    if (this.s[this.i] === "-") this.i += 1;
    while (this.i < this.s.length && /\d/.test(this.s[this.i])) this.i += 1;
    if (this.i > numStart && this.s.slice(numStart, this.i) !== "-")
      param = Number(this.s.slice(numStart, this.i));
    else this.i = numStart;
    if (this.s[this.i] === " ") this.i += 1;
    return { name, param };
  }

  /** Skips to the end of the group whose opening brace was already read. */
  private skipGroup(): void {
    let depth = 1;
    while (this.i < this.s.length && depth > 0) {
      const ch = this.s[this.i];
      if (ch === "\\") {
        this.i += 1;
        if (/[a-zA-Z]/.test(this.s[this.i] ?? "")) {
          // Only `\bin` itself is followed by raw bytes; `\binsxn` and
          // `\binfsxn` are ordinary words.
          const { name, param } = this.word();
          if (name === "bin") this.i += Math.max(0, param ?? 0);
          continue;
        }
        this.i += 1;
      } else {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
        this.i += 1;
      }
    }
  }

  /**
   * The plain text of the rest of this group, consumed. Its bytes are decoded
   * like the body's, and `\uN` skips its fallback characters the same way.
   */
  private groupText(): string {
    let out = "";
    let bytes: number[] = [];
    const flush = () => {
      if (bytes.length) out += this.decodeBytes(bytes);
      bytes = [];
    };
    let uc = this.char.uc;
    let depth = 1;
    while (this.i < this.s.length && depth > 0) {
      const ch = this.s[this.i];
      if (ch === "{") {
        depth += 1;
        this.i += 1;
      } else if (ch === "}") {
        depth -= 1;
        this.i += 1;
      } else if (ch === "\\") {
        this.i += 1;
        const next = this.s[this.i];
        if (next === "'") {
          const byte = parseInt(this.s.substr(this.i + 1, 2), 16);
          if (Number.isFinite(byte)) bytes.push(byte);
          this.i += 3;
        } else if (/[a-zA-Z]/.test(next ?? "")) {
          const { name, param } = this.word();
          if (name === "u" && param !== undefined) {
            flush();
            out += String.fromCharCode(param < 0 ? param + 65536 : param);
            this.skipFallback(uc);
          } else if (name === "uc") uc = Math.max(0, param ?? 1);
        } else {
          if (next === "\\" || next === "{" || next === "}")
            bytes.push(next.charCodeAt(0));
          this.i += 1;
        }
      } else {
        if (ch !== "\r" && ch !== "\n") bytes.push(ch.charCodeAt(0) & 0xff);
        this.i += 1;
      }
    }
    flush();
    return out;
  }

  private fontTable(): void {
    let depth = 1;
    let current: number | null = null;
    let charset: number | undefined;
    let mono = false;
    let name = "";
    const commit = () => {
      if (current === null) return;
      this.fonts.set(current, {
        codepage: charset !== undefined ? CHARSET_CODEPAGE[charset] : undefined,
        mono: mono || /courier|consolas|mono/i.test(name),
      });
      current = null;
      charset = undefined;
      mono = false;
      name = "";
    };
    while (this.i < this.s.length && depth > 0) {
      const ch = this.s[this.i];
      if (ch === "{") {
        depth += 1;
        this.i += 1;
        if (this.s.startsWith("\\*", this.i)) {
          this.i += 2;
          this.skipGroup();
          depth -= 1;
        }
      } else if (ch === "}") {
        depth -= 1;
        this.i += 1;
      } else if (ch === "\\") {
        this.i += 1;
        if (!/[a-zA-Z]/.test(this.s[this.i] ?? "")) {
          this.i += this.s[this.i] === "'" ? 3 : 1;
          continue;
        }
        const { name: w, param } = this.word();
        if (w === "f" && param !== undefined) {
          commit();
          current = param;
        } else if (w === "fcharset") charset = param;
        else if (w === "fmodern") mono = true;
      } else {
        if (ch === ";") commit();
        else if (ch !== "\r" && ch !== "\n") name += ch;
        this.i += 1;
      }
    }
    commit();
  }

  private styleSheet(): void {
    let depth = 1;
    let current: number | null = null;
    let outline: number | undefined;
    let name = "";
    let paragraph = true;
    const commit = () => {
      if (current !== null && paragraph)
        this.styles.set(current, { name: name.trim().toLowerCase(), outline });
      current = null;
      outline = undefined;
      name = "";
      paragraph = true;
    };
    while (this.i < this.s.length && depth > 0) {
      const ch = this.s[this.i];
      if (ch === "{") {
        depth += 1;
        this.i += 1;
      } else if (ch === "}") {
        depth -= 1;
        this.i += 1;
      } else if (ch === "\\") {
        this.i += 1;
        // A style named in the document's own language ("Titre\x27e9") keeps
        // its accented letters: the name is shown as the paragraph's style.
        if (this.s[this.i] === "'") {
          name += this.byteChar(this.s.substr(this.i + 1, 2));
          this.i += 3;
          continue;
        }
        if (!/[a-zA-Z]/.test(this.s[this.i] ?? "")) {
          this.i += 1;
          continue;
        }
        const { name: w, param } = this.word();
        if (w === "s" && param !== undefined) {
          commit();
          current = param;
        } else if (w === "cs" || w === "ds" || w === "ts") {
          commit();
          current = param ?? -1;
          paragraph = false;
        } else if (w === "outlinelevel") outline = param;
      } else {
        if (ch === ";") commit();
        else if (ch.charCodeAt(0) < 0x80) {
          if (ch !== "\r" && ch !== "\n") name += ch;
        } else name += this.byteChar(ch.charCodeAt(0).toString(16));
        this.i += 1;
      }
    }
    // Paragraph style 0 is Normal even when the sheet lists it bare.
    if (current !== null) commit();
  }

  private infoGroup(): void {
    let depth = 1;
    while (this.i < this.s.length && depth > 0) {
      const ch = this.s[this.i];
      if (ch === "{") {
        this.i += 1;
        if (this.s[this.i] === "\\") {
          this.i += 1;
          const { name } = this.word();
          if (name === "title" || name === "author") {
            const text = this.groupText().trim();
            if (text) this.info[name] = text;
            continue;
          }
          this.skipGroup();
          continue;
        }
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        this.i += 1;
      } else this.i += 1;
    }
  }

  /** Reads a group whose `{` is at `i`. */
  private group(level: number): void {
    this.flushBytes();
    this.i += 1; // the brace
    this.stack.push({ char: { ...this.char }, para: { ...this.para } });
    let first = true;
    let ignorable = false;
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === "{") {
        this.group(level + 1);
        first = false;
        continue;
      }
      if (ch === "}") {
        this.i += 1;
        break;
      }
      if (ch === "\\") {
        this.i += 1;
        const next = this.s[this.i];
        if (next === "*") {
          ignorable = true;
          this.i += 1;
          continue;
        }
        if (next === "'") {
          const byte = parseInt(this.s.substr(this.i + 1, 2), 16);
          this.i += 3;
          if (Number.isFinite(byte)) this.bytes.push(byte);
          first = false;
          continue;
        }
        if (!/[a-zA-Z]/.test(next ?? "")) {
          this.i += 1;
          first = false;
          switch (next) {
            case "\\":
            case "{":
            case "}":
              this.bytes.push(next.charCodeAt(0));
              break;
            case "~":
              this.flushBytes();
              this.emit("\u00A0");
              break;
            case "_":
              this.flushBytes();
              this.emit("-");
              break;
            case "\n":
            case "\r":
              this.endParagraph(true);
              break;
          }
          continue;
        }
        const { name, param } = this.word();
        if (first) {
          first = false;
          const handled = this.destination(name, param, ignorable);
          if (handled === "done") {
            this.restore();
            return;
          }
          if (handled === "skip") {
            this.skipGroup();
            this.restore();
            return;
          }
        }
        this.control(name, param);
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        this.i += 1;
        continue;
      }
      // A run of plain text, as bytes for the code page to decode.
      const start = this.i;
      while (this.i < this.s.length && !"\\{}\r\n".includes(this.s[this.i]))
        this.i += 1;
      for (let k = start; k < this.i; k++)
        this.bytes.push(this.s.charCodeAt(k) & 0xff);
      first = false;
    }
    this.flushBytes();
    this.restore();
  }

  private fieldIsToc = false;

  private restore(): void {
    this.flushBytes();
    const saved = this.stack.pop();
    if (saved) {
      this.char = saved.char;
      // Paragraph properties are not scoped by groups in practice, since
      // word processors close groups mid-paragraph, but a table cell's flag is.
      this.para = {
        ...this.para,
        inTable: saved.para.inTable || this.para.inTable,
      };
    }
  }

  /**
   * A group's first control word may make it a destination. "done" means the
   * group was consumed here.
   */
  private destination(
    name: string,
    param: number | undefined,
    ignorable: boolean,
  ): "done" | "skip" | null {
    switch (name) {
      case "fonttbl":
        this.fontTable();
        return "done";
      case "stylesheet":
        this.styleSheet();
        return "done";
      case "info":
        this.infoGroup();
        return "done";
      case "pict":
      case "object":
        bump(this.doc.report, "images");
        this.skipGroup();
        return "done";
      case "shp":
      case "shpgrp":
        bump(this.doc.report, "textBoxes");
        this.skipGroup();
        return "done";
      case "fldinst": {
        const instr = this.groupText();
        this.fieldIsToc = /^\s*TOC\b/i.test(instr);
        return "done";
      }
      case "field":
        this.fieldIsToc = false;
        return null;
      case "fldrslt":
        // A table of contents' result is its entries, not the book.
        return this.fieldIsToc ? "skip" : null;
      case "footnote":
        this.footnote();
        return "done";
      case "shppict":
        // A picture's wrapper: the `pict` inside it is what is counted.
        return null;
      case "annotation":
        this.annotation();
        return "done";
      case "atnauthor":
        this.lastAuthor = this.groupText().trim() || undefined;
        return "done";
      case "atnid":
        this.lastInitials = this.groupText().trim() || undefined;
        return "done";
      case "atrfstart":
        this.mark(`as:${this.groupText().trim()}`);
        return "done";
      case "atrfend":
        this.mark(`ae:${this.groupText().trim()}`);
        return "done";
      case "chftn":
        // The automatic footnote number in the text. The footnote is not
        // kept, so its number has nothing to show.
        return null;
    }
    if (SKIP.has(name) || (ignorable && !KNOWN.has(name))) {
      this.skipGroup();
      return "done";
    }
    void param;
    return null;
  }

  /** Counts and skips a footnote; `ftnalt` inside it makes it an endnote. */
  private footnote(): void {
    const start = this.i;
    this.skipGroup();
    const endnote = /\\ftnalt(?![a-z])/.test(this.s.slice(start, this.i));
    bump(this.doc.report, endnote ? "endnotes" : "footnotes");
  }

  private annotation(): void {
    this.commentCount += 1;
    const key = `a:${this.commentCount}`;
    this.mark(key);
    // The comment's own paragraphs must not use up the page break waiting
    // for the book's next paragraph.
    const outer = this.sink;
    const savedPara = this.para;
    const savedBreak = this.pendingBreak;
    this.sink = newSink();
    this.para = freshPara();
    const refBefore = this.annotationRef;
    this.annotationRef = undefined;
    this.groupBody();
    this.endParagraph();
    const body = bodyOf(this.sink);
    const range = this.annotationRef;
    this.annotationRef = refBefore;
    this.sink = outer;
    this.para = savedPara;
    this.pendingBreak = savedBreak;
    const comment: ImportedComment = {
      sourceId: range !== undefined ? `as:${range}` : key,
      anchor: null,
      body,
    };
    if (this.lastAuthor) comment.author = this.lastAuthor;
    if (this.lastInitials) comment.initials = this.lastInitials;
    this.comments.push(comment);
    // Its mark is where a ranged comment ends when no range end was written.
    if (range !== undefined) this.aliases.set(`as:${range}`, key);
    bump(this.doc.report, "comments");
  }

  private annotationRef: string | undefined;
  readonly aliases = new Map<string, string>();

  /** The rest of a destination group, read as text into the current sink. */
  private groupBody(): void {
    while (this.i < this.s.length) {
      const ch = this.s[this.i];
      if (ch === "}") {
        this.i += 1;
        return;
      }
      if (ch === "{") {
        // An `atnref` inside an annotation names its range.
        if (this.s.startsWith("{\\*\\atnref", this.i)) {
          this.i += 10;
          if (this.s[this.i] === " ") this.i += 1;
          this.annotationRef = this.groupText().trim();
          continue;
        }
        this.group(1);
        continue;
      }
      if (ch === "\\") {
        this.i += 1;
        const next = this.s[this.i];
        if (next === "'") {
          const byte = parseInt(this.s.substr(this.i + 1, 2), 16);
          this.i += 3;
          if (Number.isFinite(byte)) this.bytes.push(byte);
          continue;
        }
        if (!/[a-zA-Z]/.test(next ?? "")) {
          this.i += 1;
          if (next === "\\" || next === "{" || next === "}")
            this.bytes.push(next.charCodeAt(0));
          else if (next === "~") this.emit("\u00A0");
          continue;
        }
        const { name, param } = this.word();
        this.control(name, param);
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        this.i += 1;
        continue;
      }
      const start = this.i;
      while (this.i < this.s.length && !"\\{}\r\n".includes(this.s[this.i]))
        this.i += 1;
      for (let k = start; k < this.i; k++)
        this.bytes.push(this.s.charCodeAt(k) & 0xff);
    }
  }

  private control(name: string, param: number | undefined): void {
    const on = param === undefined || param !== 0;
    const fmt = (apply: () => void) => {
      this.flushBytes();
      apply();
    };
    switch (name) {
      case "par":
        this.endParagraph(true);
        break;
      case "line":
        this.endParagraph(true);
        break;
      case "page":
        this.endParagraph();
        this.pendingBreak = true;
        break;
      case "sect":
        this.endParagraph();
        this.pendingBreak = true;
        break;
      case "cell":
      case "nestcell":
        this.endParagraph();
        break;
      case "row":
        break;
      case "trowd":
        if (!this.para.inTable) bump(this.doc.report, "tables");
        this.para.inTable = true;
        break;
      case "intbl":
        this.para.inTable = true;
        break;
      case "pard":
        this.flushBytes();
        this.para = { ...freshPara(), inTable: false };
        break;
      case "plain":
        fmt(() => (this.char = { ...PLAIN, uc: this.char.uc }));
        break;
      case "b":
        fmt(() => (this.char.bold = on));
        break;
      case "i":
        fmt(() => (this.char.italic = on));
        break;
      case "ul":
      case "uld":
      case "uldb":
      case "ulw":
        fmt(() => (this.char.underline = on));
        break;
      case "ulnone":
        fmt(() => (this.char.underline = false));
        break;
      case "caps":
      case "scaps":
        fmt(() => (this.char.caps = on));
        break;
      case "strike":
      case "striked":
        fmt(() => (this.char.strike = on));
        if (on) bump(this.doc.report, "strike");
        break;
      case "v":
        fmt(() => (this.char.hidden = on));
        break;
      case "deleted":
        fmt(() => (this.char.deleted = on));
        break;
      case "fs":
        if (param) fmt(() => (this.char.size = param / 2));
        break;
      case "f":
        if (param !== undefined) fmt(() => (this.char.font = param));
        break;
      case "uc":
        this.char.uc = Math.max(0, param ?? 1);
        break;
      case "u": {
        this.flushBytes();
        const code = (param ?? 0) < 0 ? (param ?? 0) + 65536 : (param ?? 0);
        this.emit(String.fromCharCode(code));
        this.skipFallback(this.char.uc);
        break;
      }
      case "ansicpg":
        if (param) this.defaultCodepage = param;
        break;
      case "deff":
        if (param !== undefined) this.defaultFont = param;
        break;
      case "deflang":
        if (param && LCID[param] && !this.language) this.language = LCID[param];
        break;
      case "ql":
        this.para.align = "left";
        break;
      case "qc":
        this.para.align = "center";
        break;
      case "qr":
        this.para.align = "right";
        break;
      case "qj":
      case "qd":
        this.para.align = "justify";
        break;
      case "s":
        this.para.style = param ?? 0;
        break;
      case "outlinelevel":
        this.para.outline = param;
        break;
      case "pagebb":
        this.para.pageBefore = on;
        break;
      case "tab":
        this.flushBytes();
        this.emit(" ");
        break;
      case "chftn":
        break;
      case "bin":
        // Raw bytes follow; they are never text.
        this.i += Math.max(0, param ?? 0);
        break;
      default: {
        const symbol = SYMBOLS[name];
        if (symbol) {
          this.flushBytes();
          this.emit(symbol);
        }
      }
    }
  }

  /**
   * After `\uN`, skips the `\ucN` characters for non-Unicode readers. A line
   * break in the file is not text, so it is passed over and not counted.
   */
  private skipFallback(count: number): void {
    for (let n = 0; n < count && this.i < this.s.length; n++) {
      const ch = this.s[this.i];
      if (ch === "{" || ch === "}") return;
      if (ch === "\r" || ch === "\n") {
        this.i += 1;
        n -= 1;
        continue;
      }
      if (ch === "\\") {
        const next = this.s[this.i + 1];
        if (next === "'") this.i += 4;
        else if (/[a-zA-Z]/.test(next ?? "")) {
          this.i += 1;
          this.word();
        } else this.i += 2;
      } else this.i += 1;
    }
  }
}

/** Destinations a `\*` may introduce that are still read. */
const KNOWN = new Set([
  "fldinst",
  "atnauthor",
  "atnid",
  "atrfstart",
  "atrfend",
  "annotation",
  "atnref",
  "shppict",
]);

/** Bytes decoded by a Windows code page, Windows-1252 when it is unknown. */
function decodeCodepage(bytes: number[], codepage: number): string {
  const label = codepageLabel(codepage) ?? "windows-1252";
  try {
    return new TextDecoder(label).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("windows-1252").decode(new Uint8Array(bytes));
  }
}

/**
 * The file as one character per byte, each the byte's own value. The parser
 * hands text bytes back to the code page, and `\bin` counts bytes, so no
 * decoding may happen here: the platform's "latin1" is Windows-1252, which
 * maps 0x80-0x9F elsewhere.
 */
function byteString(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let k = 0; k < bytes.length; k += CHUNK)
    out += String.fromCharCode(...bytes.subarray(k, k + CHUNK));
  return out;
}

/** A comment's paragraphs, tidied like the book's, the empty ones dropped. */
function bodyOf(sink: Sink): Inline[][] {
  return sink.paras
    .map((p) => cleanInlines(p.inlines))
    .filter((p) => p.length > 0);
}

export const rtfReader: FormatReader = {
  format: "rtf",
  async read(bytes, name, ctx) {
    const doc = emptySource("rtf");
    const text = byteString(bytes);
    if (!text.trimStart().startsWith("{\\rtf"))
      throw new ReadRefused("damaged", "no rtf signature");
    const parser = new RtfParser(text, doc);
    parser.parse();

    const flow = new FlowBuilder(doc.report);
    const pace = pacer(ctx);
    const refs = new Map<string, { block: number; offset: number }>();
    for (const para of parser.main.paras) {
      await pace.tick();
      const style = parser.styles.get(para.para.style);
      const signals: Signals = {};
      if (style?.name) signals.styleName = style.name;
      const heading = style ? /^heading (\d)$/.exec(style.name) : null;
      const outline = para.para.outline ?? style?.outline;
      if (heading) signals.headingLevel = Math.min(6, Number(heading[1]));
      else if (outline !== undefined && outline < 9)
        signals.headingLevel = Math.min(6, outline + 1);
      if (style?.name === "title") signals.role = "title";
      else if (style?.name === "subtitle") signals.role = "subtitle";
      if (para.para.inTable) signals.origin = "table";
      if (para.breakBefore) signals.breakBefore = true;
      const block = flow.next;
      const offsets = flow.para(para.inlines, para.para.align, signals);
      para.refs.forEach((key, n) =>
        refs.set(key, { block, offset: offsets[n] ?? 0 }),
      );
    }
    doc.flows.push({ name, blocks: flow.blocks });

    for (const comment of parser.comments) {
      const startKey = comment.sourceId;
      const start =
        refs.get(startKey) ?? refs.get(parser.aliases.get(startKey) ?? "");
      if (!start) continue;
      const end = startKey.startsWith("as:")
        ? (refs.get(`ae:${startKey.slice(3)}`) ??
          refs.get(parser.aliases.get(startKey) ?? ""))
        : undefined;
      comment.anchor = { flow: 0, start, end: end ?? start };
    }
    doc.comments = parser.comments;
    if (parser.info.title) doc.meta.title = parser.info.title;
    if (parser.info.author) doc.meta.author = parser.info.author;
    if (parser.language) doc.meta.language = parser.language;
    return doc;
  },
};
