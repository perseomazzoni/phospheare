// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `Renderer` port, the view boundary: how a document becomes something a
// view can display.
//
// Contract, for every renderer:
//
//   1. Rendering is deterministic: the same doc renders identically every
//      time, so the view can diff one render against the next.
//   2. A doc with at least one paragraph always renders to a non-empty
//      string, because an empty paragraph is still a visible block.
//   3. Run text is escaped, never interpreted: characters like `<`, `>` and
//      `&` can never become markup in the output.
//   4. The renderer is faithful: page breaks, block types, alignment and
//      run formats all change the output; two docs that differ render
//      differently.

import type { Doc } from "../domain/model";

export interface Renderer {
  render(doc: Doc): string;
}
