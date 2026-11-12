// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `Codec` port, the file format boundary: how a document becomes bytes on
// disk and how bytes on disk become a document again.
//
// Contract, for every codec:
//
//   1. Round trip: `parse(serialize(doc))` returns an equal document for
//      every document the engine can produce. Information is never lost.
//   2. `parse('')` yields a document with one empty paragraph, the session's
//      invariant that a doc never holds zero paragraphs.
//   3. `serialize([])` is the empty string. The session never holds an empty
//      array, but the codec accepts one.
//   4. Formatting survives: bold, italic and monospace combine freely, and
//      typed text is escaped so it can never read as a directive like
//      `{pagebreak}`.

import type { Doc } from "../domain/model";

export interface Codec {
  parse(text: string): Doc;
  serialize(doc: Doc): string;
}
