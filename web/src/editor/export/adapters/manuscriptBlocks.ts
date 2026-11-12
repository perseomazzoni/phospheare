// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Reads the manuscript dialect into the export model. The engine's own codec
// parses the text, because it is the one parser that defines the dialect: an
// export cannot read a `{align:center}` or an escaped `\*` differently from
// the editor the writer saw it in. This adapter only maps the engine's
// paragraphs onto export blocks.

import { commonmarkCodec, type Paragraph } from "../../engine";
import type { Block, Inline } from "../domain/model";
import type { BlockParser } from "../ports";

function inlinesOf(paragraph: Paragraph): Inline[] {
  return paragraph.runs
    .filter((run) => run.text !== "")
    .map((run) => ({
      text: run.text,
      ...(run.format.bold ? { bold: true } : {}),
      ...(run.format.italic ? { italic: true } : {}),
      ...(run.format.monospace ? { mono: true } : {}),
    }));
}

function blockOf(paragraph: Paragraph): Block {
  switch (paragraph.blockType) {
    case "pagebreak":
      return { kind: "pageBreak" };
    case "h1":
    case "h2":
      return {
        kind: "heading",
        level: paragraph.blockType === "h1" ? 1 : 2,
        inlines: inlinesOf(paragraph),
        align: paragraph.alignment,
      };
    case "paragraph":
      return {
        kind: "paragraph",
        inlines: inlinesOf(paragraph),
        align: paragraph.alignment,
      };
  }
}

export const manuscriptParser: BlockParser = {
  parse: (text) => commonmarkCodec.parse(text).map(blockOf),
};
