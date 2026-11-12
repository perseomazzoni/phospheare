// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { emptySource } from "../../domain/source";
import type { FormatReader } from "../../ports";
import { decodeText } from "../decode";
import { FlowBuilder, pacer, typedEmphasis } from "../flowBuilder";

// Reads plain text, the format with the least to say and so the one most
// worth reading carefully. Three shapes of file arrive as .txt:
//
//   - one paragraph per line, as a modern editor saves it;
//   - paragraphs separated by blank lines with every line hard-wrapped at
//     seventy-odd characters, as in Project Gutenberg and anything typed for
//     an email; read line by line, that is a book of one-line paragraphs;
//   - the app's own export: titles underlined with `=` or `-`, `#` for a
//     scene break, a form feed between chapters, `_italic_` and `*bold*`.
//
// So the reader first decides which of the first two it is looking at: when
// three lines in ten or more are blank, blank lines separate paragraphs and
// the lines between them are rejoined. Extra blank lines, two or more in a
// row, are kept as empty paragraphs, because a big gap is how a typed
// manuscript marks a scene or a chapter, and `prepare` reads them.

const FORM_FEED = "\f";
const SETEXT = /^(=+|-+|~+)\s*$/;

/**
 * Whether a line can be the title a setext underline makes a heading: short,
 * and not a sentence. A line of dashes is just as often a scene break under
 * the last sentence of a scene, and taking that sentence for a title loses
 * the sentence and the break together. A question or an
 * exclamation ends a sentence as a full stop does.
 */
function titleLike(text: string): boolean {
  const line = text.trim();
  return line.split(/\s+/).length <= 12 && !/[.,;…?!]["”’»)]?$/.test(line);
}

export const txtReader: FormatReader = {
  format: "txt",
  async read(bytes, name, ctx) {
    const doc = emptySource("txt");
    const flow = new FlowBuilder(doc.report);
    const pace = pacer(ctx);
    const text = decodeText(bytes)
      .replace(/\r\n?/g, "\n")
      .replace(/\f/g, `\n${FORM_FEED}\n`);
    const lines = text.split("\n");
    // Leading and trailing blank lines are the file's, not the book's.
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    while (lines.length && !lines[0].trim()) lines.shift();

    const blank = lines.filter((line) => !line.trim()).length;
    const wrapped = lines.length > 0 && blank / lines.length >= 0.3;

    const emit = async (line: string, level?: number) => {
      await pace.tick();
      flow.para(
        typedEmphasis(line),
        "left",
        level ? { headingLevel: level } : {},
      );
    };

    let buffer: string[] = [];
    let blanks = 0;
    const flush = async () => {
      if (!buffer.length) return;
      // A setext title: the text, then a line of `=` or `-` under it.
      const under =
        buffer.length > 1 ? SETEXT.exec(buffer[buffer.length - 1]) : null;
      if (under && titleLike(buffer.slice(0, -1).join(" "))) {
        const title = buffer.slice(0, -1).join(" ");
        await emit(title, under[1][0] === "=" ? 1 : 2);
      } else await emit(buffer.join(" "));
      buffer = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Compared whole: `trim()` counts a form feed as whitespace.
      if (line === FORM_FEED) {
        await flush();
        flow.pageBreak();
        blanks = 0;
        continue;
      }
      if (!line.trim()) {
        await flush();
        blanks += 1;
        continue;
      }
      // In a wrapped file the first blank line is the separator and each one
      // after it a kept empty paragraph; line by line, every blank line is
      // one.
      for (let b = wrapped ? 1 : 0; b < blanks; b++) flow.para([]);
      blanks = 0;
      if (wrapped) {
        buffer.push(line.trim());
        continue;
      }
      // Line by line, a setext underline still belongs to the line above it.
      if (
        SETEXT.test(line) &&
        buffer.length === 0 &&
        i > 0 &&
        lines[i - 1].trim() &&
        titleLike(lines[i - 1])
      ) {
        const prev = flow.blocks.pop();
        const title =
          prev && prev.kind === "para"
            ? prev.inlines.map((x) => x.text).join("")
            : "";
        await emit(title, line.trim()[0] === "=" ? 1 : 2);
        continue;
      }
      await emit(line);
    }
    await flush();

    doc.flows.push({ name, blocks: flow.blocks });
    return doc;
  },
};
