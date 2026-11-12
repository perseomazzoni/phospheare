// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The diff engine's pure core: two documents in, one merged document with its
// decorations and hunks out. It holds no state and touches no DOM.

export { diffTokens, type TokenOp } from "./words";
export { splitSentences } from "./sentences";
export {
  alignBlocks,
  pairParagraphs,
  paragraphText,
  type BlockPair,
} from "./blocks";
export {
  buildMergedDoc,
  type DiffAim,
  type DiffDecoration,
  type DiffDecorationKind,
  type DiffGranularity,
  type Hunk,
  type HunkKind,
  type MergedDiff,
  type RawHunk,
} from "./merge";
export { applyHunk, sameHunk } from "./accept";
