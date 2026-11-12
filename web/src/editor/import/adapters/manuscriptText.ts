// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { commonmarkCodec } from "../../engine/adapters/commonmark";
import type { DraftParagraph } from "../domain/draft";
import type { ManuscriptWriter } from "../ports";

// Writes imported text the way the editor writes. The draft's paragraphs are
// already the engine's shape, so this is the engine's own serialiser and
// nothing else: an imported chapter is byte for byte the file the editor
// would have saved had the writer typed it, so the first save after an import
// is a no-op rather than a diff.

export const manuscriptText: ManuscriptWriter = {
  serialize(paragraphs) {
    return commonmarkCodec.serialize(
      paragraphs.map((para: DraftParagraph) => ({
        blockType: para.blockType,
        alignment: para.alignment,
        runs: para.runs.map((run) => ({
          text: run.text,
          format: {
            bold: run.bold,
            italic: run.italic,
            monospace: run.monospace,
          },
        })),
      })),
    );
  },
  visibleParagraphs(text) {
    return commonmarkCodec
      .parse(text)
      .map((para) => para.runs.map((run) => run.text).join(""));
  },
};
