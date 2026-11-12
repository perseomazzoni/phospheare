// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The engine's public surface. Code outside `engine/` imports the engine from
// here and only from here.
//
//   1. Nothing under `engine/` imports anything outside `engine/`: no views,
//      no React, no DOM, no storage. The domain is pure TypeScript.
//   2. The layers point one way. `domain/` (the model, its invariants and its
//      operations) knows nothing of application, ports or adapters. `ports/`
//      are interfaces over the domain, `adapters/` implement the ports, and
//      `application/` (the session, its commands, the bus) composes the ports
//      into the editor's behavior.
//   3. Everything re-exported here is a contract the engine promises.
//
// The default adapters are re-exported so the engine can be composed with
// others; a swapped adapter must meet its port's contract.

export * from "./domain/model";
export * from "./domain/invariants";
export * from "./domain/limits";
export * from "./domain/operations";
export * from "./domain/markers";

export * from "./ports/codec";
export * from "./ports/history";
export * from "./ports/search";
export * from "./ports/platform";
export * from "./ports/events";
export * from "./ports/renderer";
export * from "./ports/clipboard";

export * from "./application/commands";
export * from "./application/editorCommands";
export * from "./application/session";
export * from "./application/diff";

export { commonmarkCodec } from "./adapters/commonmark";
export { SnapshotHistory } from "./adapters/snapshot";
export { DeltaTimeline } from "./adapters/delta";
export { regexSearch, wordCharRegex } from "./adapters/regex";
export {
  joinBlocks,
  joinedText,
  cursorAt,
  PARAGRAPH_BREAK,
  PAGE_BREAK_MARK,
  type JoinBlock,
  type JoinedText,
} from "./domain/joined";
export { browserPlatform } from "./adapters/browser";
export { Emitter } from "./adapters/emitter";
export { htmlRenderer } from "./adapters/html";
export { browserClipboardCodec } from "./adapters/browserHtml";
