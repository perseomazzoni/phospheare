// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { MAX_BLOCKS, YIELD_EVERY } from "../domain/limits";
import {
  bump,
  type Align,
  type Inline,
  type ReadReport,
  type Signals,
  type SourceBlock,
} from "../domain/source";
import { tidyText } from "../domain/text";
import type { ReadContext } from "../ports";
import { ReadRefused } from "./failure";

// Builds a flow the same way in every reader. Each reader walks its own
// format and hands paragraphs to this, so the clean-up is one piece of code
// and not seven that disagree. A paragraph comes out with its text tidied
// (`tidyText`), its runs' edges trimmed, runs of the same formatting merged,
// and no newline inside any run: the engine cannot hold one, and a run that
// arrived with one would round-trip as two paragraphs.
//
// The italic and bold runs are counted here, after merging, because that is
// the number the report promises: "312 italic passages kept".

const sameFormat = (a: Inline, b: Inline) =>
  !!a.bold === !!b.bold &&
  !!a.italic === !!b.italic &&
  !!a.mono === !!b.mono &&
  !!a.underline === !!b.underline;

/**
 * A stand-in a reader puts in the text where a comment reference stood. The
 * text is tidied after the reader is done with it (spaces collapsed, edges
 * trimmed), so an offset counted before that would point at the wrong word;
 * a character carried through the tidying and taken out last is where the
 * reference ends up. It is a private-use code point, so no manuscript means
 * it, and any the source already held are dropped first.
 */
export const COMMENT_MARK = String.fromCharCode(0xe000);

/** Source text without stray `COMMENT_MARK`s, before a reader adds its own. */
export function unmarked(text: string): string {
  return text.includes(COMMENT_MARK) ? text.split(COMMENT_MARK).join("") : text;
}

function takeMarks(inlines: Inline[]): { inlines: Inline[]; marks: number[] } {
  const marks: number[] = [];
  let offset = 0;
  const out: Inline[] = [];
  for (const inline of inlines) {
    let text = "";
    for (const ch of inline.text) {
      if (ch === COMMENT_MARK) marks.push(offset);
      else {
        text += ch;
        offset += ch.length;
      }
    }
    if (text) out.push({ ...inline, text });
  }
  return { inlines: marks.length ? out : inlines, marks };
}

/** Tidies and merges a paragraph's runs, dropping edge whitespace. */
export function cleanInlines(raw: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of raw) {
    let text = tidyText(inline.text);
    if (!text) continue;
    const prev = out[out.length - 1];
    // A space on both sides of a run boundary is one space.
    if (prev && prev.text.endsWith(" ") && text.startsWith(" "))
      text = text.slice(1);
    if (!text) continue;
    if (prev && sameFormat(prev, inline)) prev.text += text;
    else {
      const next: Inline = { text };
      if (inline.bold) next.bold = true;
      if (inline.italic) next.italic = true;
      if (inline.mono) next.mono = true;
      if (inline.underline) next.underline = true;
      out.push(next);
    }
  }
  if (out.length) {
    out[0].text = out[0].text.trimStart();
    const last = out[out.length - 1];
    last.text = last.text.trimEnd();
  }
  return out.filter((inline) => inline.text.length > 0);
}

export class FlowBuilder {
  readonly blocks: SourceBlock[] = [];
  private readonly report: ReadReport;

  constructor(report: ReadReport) {
    this.report = report;
  }

  /**
   * Adds a paragraph. Returns where each `COMMENT_MARK` stood in the
   * finished text, in order, with the marks taken out: the anchors of the
   * comments whose references the reader left there.
   */
  para(
    raw: readonly Inline[],
    align: Align = "left",
    signals: Signals = {},
  ): number[] {
    const { inlines, marks } = takeMarks(cleanInlines(raw));
    for (const inline of inlines) {
      if (inline.italic) bump(this.report, "italic");
      if (inline.bold) bump(this.report, "bold");
      if (inline.underline) bump(this.report, "underline");
    }
    this.push({ kind: "para", inlines, align, signals });
    return marks;
  }

  /** The index the next block will have, a comment anchor's `block`. */
  get next(): number {
    return this.blocks.length;
  }

  pageBreak(): void {
    this.push({ kind: "pageBreak" });
  }

  rule(): void {
    this.push({ kind: "rule" });
  }

  private push(block: SourceBlock): void {
    if (this.blocks.length >= MAX_BLOCKS)
      throw new ReadRefused("tooLarge", `more than ${MAX_BLOCKS} paragraphs`);
    this.blocks.push(block);
  }
}

/**
 * A reader's heartbeat, ticked once per paragraph. Every `YIELD_EVERY` ticks
 * it hands the page a frame, and once the window has closed it stops the read.
 */
export function pacer(ctx: ReadContext): { tick(): Promise<void> } {
  let count = 0;
  return {
    async tick() {
      count += 1;
      if (count % YIELD_EVERY !== 0) return;
      await ctx.yield();
      if (ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
    },
  };
}

/** Plain text with typed emphasis read back: `_italic_`, `*bold*`. */
export function typedEmphasis(text: string): Inline[] {
  // Only at word edges, and only around something that is not a space, so a
  // filename with an underscore, a multiplication and a lone asterisk
  // footnote marker are left as they were typed.
  const re =
    /(^|[\s(“"‘'«—–-])(_|\*)(?=\S)(.+?)(?<=\S)\2(?=$|[\s.,;:!?)”"’'»—–-])/gu;
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index + match[1].length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push(
      match[2] === "_"
        ? { text: match[3], italic: true }
        : { text: match[3], bold: true },
    );
    last = start + match[2].length * 2 + match[3].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
