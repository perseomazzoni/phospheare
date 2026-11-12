// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The CommonMark dialect codec ─────────────────────────────────────────────
//
// The file format the editor writes: the parser and the serializer as the two
// halves of one state machine, behind the `Codec` port. The serializer emits
// format transitions as `*`, `**`, `***` and backtick-quoted monospace, and
// the parser mirrors that state machine. `{` is escaped in run text, so the
// parser sees a bare `{pagebreak}` line only when the serializer emitted one.

import type {
  Alignment,
  BlockType,
  Doc,
  Format,
  Paragraph,
  Run,
} from "../domain/model";
import type { Codec } from "../ports/codec";

// ── Serializer ───────────────────────────────────────────────────────────────

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/`/g, "\\`")
    .replace(/\{/g, "\\{");
}

// A backtick inside code cannot be escaped, because a backslash before the
// fence would be read as text, so the fence is one backtick longer than the
// longest run of backticks in the text, and only a run of exactly the fence's
// length closes it. A text that starts or ends with a backtick is padded with
// a space on each side, so the backtick never touches the fence; a text that
// starts and ends with a space is padded too, because the parser strips one
// padding space from each side.
function codeFence(text: string): string {
  let longest = 0;
  for (const ticks of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, ticks.length);
  }
  return "`".repeat(longest + 1);
}

function escapeCode(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/\{/g, "\\{");
  const pad =
    escaped.startsWith("`") ||
    escaped.endsWith("`") ||
    (escaped.startsWith(" ") && escaped.endsWith(" ") && escaped.trim() !== "");
  return pad ? ` ${escaped} ` : escaped;
}

// The minimal marker sequence between two format states. The parser mirrors
// this state machine, so every transition is unambiguous. Monospace nests
// inside the bold and italic markers, so a bold or italic change around a
// code run closes the code first and reopens it after: a marker emitted
// between the backticks would become part of the code's text. `close` and
// `open` are the fences of the code runs on either side.
function formatTransition(
  from: Format,
  to: Format,
  close = "`",
  open = "`",
): string {
  let out = "";
  const monoChanges = from.monospace !== to.monospace;
  const boldChanges = from.bold !== to.bold;
  const italicChanges = from.italic !== to.italic;
  if (from.monospace && (monoChanges || boldChanges || italicChanges))
    out += close;
  if (boldChanges && italicChanges) out += "***";
  else if (boldChanges) out += "**";
  else if (italicChanges) out += "*";
  if (to.monospace && (monoChanges || boldChanges || italicChanges))
    out += open;
  return out;
}

function mergeAdjacentRuns(runs: readonly Run[]): Run[] {
  if (runs.length === 0)
    return [
      { text: "", format: { bold: false, italic: false, monospace: false } },
    ];
  const out: Run[] = [];
  for (const run of runs) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.format.bold === run.format.bold &&
      prev.format.italic === run.format.italic &&
      prev.format.monospace === run.format.monospace
    ) {
      out[out.length - 1] = { ...prev, text: prev.text + run.text };
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

function serializeParagraph(para: Paragraph): string {
  // A page break is a directive block, with no alignment and no content.
  if (para.blockType === "pagebreak") return "{pagebreak}";

  const merged = mergeAdjacentRuns(para.runs);
  const alignPrefix =
    para.alignment !== "left" ? `{align:${para.alignment}}` : "";

  let blockPrefix = "";
  if (para.blockType === "h1") blockPrefix = "# ";
  else if (para.blockType === "h2") blockPrefix = "## ";

  let body = "";
  let state: Format = { bold: false, italic: false, monospace: false };
  let fence = "`";

  for (const run of merged) {
    const open = run.format.monospace ? codeFence(run.text) : "`";
    body += formatTransition(state, run.format, fence, open);
    body += run.format.monospace ? escapeCode(run.text) : escapeText(run.text);
    state = run.format;
    fence = open;
  }

  body += formatTransition(
    state,
    { bold: false, italic: false, monospace: false },
    fence,
  );

  // A paragraph whose text opens with `# ` or `## ` would come back as a
  // heading ("# 3" as a line of prose). Only those two shapes are escaped:
  // `#hashtag` and `###` never parse as headings, and the parser's general
  // backslash escape reads `\#` back as `#`.
  if (para.blockType === "paragraph" && HEADING_LIKE_RE.test(body)) {
    body = "\\" + body;
  }

  return alignPrefix + blockPrefix + body;
}

const HEADING_LIKE_RE = /^#{1,2}\s/;

function serialize(doc: Doc): string {
  return doc.map(serializeParagraph).join("\n\n");
}

// ── Parser ───────────────────────────────────────────────────────────────────

const ALIGN_RE = /^\{align:(left|center|right|justify)\}/;

function parseAlignment(text: string): { alignment: Alignment; rest: string } {
  // A leading backslash escapes a literal `{align:...}`.
  if (text.startsWith("\\{align:"))
    return { alignment: "left", rest: text.slice(1) };
  const m = text.match(ALIGN_RE);
  if (m) return { alignment: m[1] as Alignment, rest: text.slice(m[0].length) };
  return { alignment: "left", rest: text };
}

// The inline content of one paragraph as runs, mirroring the serializer's
// state machine. A backslash makes the next character literal, and
// backtick-delimited text produces monospace runs.
function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  const monospace = false;
  let buf = "";
  let i = 0;

  const flushBuf = () => {
    if (buf) {
      runs.push({ text: buf, format: { bold, italic, monospace } });
      buf = "";
    }
  };

  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // A code span closes on a run of exactly as many backticks as opened it;
    // a longer or shorter run inside is the code's own text.
    if (text[i] === "`") {
      let ticks = 0;
      while (i + ticks < text.length && text[i + ticks] === "`") ticks++;

      flushBuf();

      let closeIdx = -1;
      for (let j = i + ticks; j < text.length;) {
        if (text[j] !== "`") {
          j++;
          continue;
        }
        let run = 0;
        while (j + run < text.length && text[j + run] === "`") run++;
        if (run === ticks) {
          closeIdx = j;
          break;
        }
        j += run;
      }
      if (closeIdx !== -1) {
        let code = text.slice(i + ticks, closeIdx);
        // One padding space comes off each side, when both are there and
        // the code is not all spaces (`escapeCode`).
        if (
          code.length > 2 &&
          code.startsWith(" ") &&
          code.endsWith(" ") &&
          code.trim() !== ""
        ) {
          code = code.slice(1, -1);
        }
        // The serializer escapes the code's own text (`escapeCode`). Sliced
        // raw, a monospace span holding a backslash or a star would double
        // its escapes on every save.
        const unescaped = code.replace(/\\([\\*`{])/g, "$1");
        // The surrounding bold and italic state carries into the code run,
        // because the serializer nests code inside `**` and `***`.
        runs.push({
          text: unescaped,
          format: { bold, italic, monospace: true },
        });
        i = closeIdx + ticks;
      } else {
        // Unclosed backticks are literal text.
        buf += text.slice(i, i + ticks);
        i += ticks;
      }
      continue;
    }

    if (text[i] !== "*") {
      buf += text[i++];
      continue;
    }

    let stars = 0;
    while (i + stars < text.length && text[i + stars] === "*") stars++;

    flushBuf();

    // A run of four or more stars is read three at a time.
    if (stars >= 3) {
      bold = !bold;
      italic = !italic;
      i += 3;
    } else if (stars === 2) {
      bold = !bold;
      i += 2;
    } else {
      italic = !italic;
      i += 1;
    }
  }

  flushBuf();

  if (runs.length === 0)
    runs.push({
      text: "",
      format: { bold: false, italic: false, monospace: false },
    });
  return runs;
}

const H2_RE = /^##\s/;
const H1_RE = /^#\s/;

// A block that is exactly `{pagebreak}`, after the optional alignment prefix,
// is a page break. A break carries no alignment.
const PAGEBREAK_RE = /^\{pagebreak\}$/;

function parseBlockType(text: string): { blockType: BlockType; rest: string } {
  if (H1_RE.test(text)) return { blockType: "h1", rest: text.slice(2) };
  if (H2_RE.test(text)) return { blockType: "h2", rest: text.slice(3) };
  return { blockType: "paragraph", rest: text };
}

function parse(rawCommonmark: string): Doc {
  // CRLF and a lone CR become LF before anything else, or a CRLF file would
  // parse as one paragraph. `canonicalize` in `text/hash.ts` must apply the
  // same normalization before hashing.
  const commonmark = rawCommonmark.includes("\r")
    ? rawCommonmark.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    : rawCommonmark;
  if (!commonmark) {
    return [
      {
        runs: [
          {
            text: "",
            format: { bold: false, italic: false, monospace: false },
          },
        ],
        alignment: "left",
        blockType: "paragraph",
      },
    ];
  }

  const blocks = commonmark.split("\n\n");
  // A file's terminating newline is not content: `"A\n\nB\n".split("\n\n")`
  // is `["A", "B\n"]`, and the same prose would parse differently depending
  // on whether its paragraph is last, showing a zero-width hunk when
  // compared. The editor never puts a newline inside a run, so dropping it
  // loses nothing. Only the last block's trailing newlines go; leading
  // newlines and middle blocks ("A\n\n\nB") are left as they are.

  blocks[blocks.length - 1] = blocks[blocks.length - 1].replace(/\n+$/, "");

  return blocks.map((block): Paragraph => {
    const { alignment, rest: afterAlign } = parseAlignment(block);
    if (PAGEBREAK_RE.test(afterAlign)) {
      return { runs: [], alignment: "left", blockType: "pagebreak" };
    }
    const { blockType, rest } = parseBlockType(afterAlign);
    return { runs: parseInline(rest), alignment, blockType };
  });
}

/** The default codec: this file's CommonMark dialect. */
export const commonmarkCodec: Codec = { parse, serialize };
