// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The `ClipboardCodec` port: how a selection becomes the two standard
// clipboard flavors (`text/plain`, `text/html`) and how foreign bytes become a
// document again. The engine never touches the OS clipboard.
//
// The clipboard is separate from the `Codec`, whose contract is a lossless
// `parse(serialize(doc)) ≡ doc` that foreign producers cannot honour. Its
// contract admits loss:
//
//   1. The rich round trip is exact for what the model holds: `parseHtml(
//      buildHtml(doc, range))` preserves the selected text and its
//      bold/italic/monospace, block types and alignment.
//   2. `parsePlain(buildPlain(doc, range))` returns the selected text, one
//      paragraph per line.
//   3. `parseHtml` never throws on arbitrary input, never interprets text as
//      markup, and drops unsupported markup (scripts, styles, links, images,
//      fonts, colors). Its output is always a valid document made of runs the
//      model can hold.
//
// `parseHtml` is the security boundary: untrusted bytes enter the engine only
// through it, and its output is data (runs), never markup.

import type { Doc, Range } from "../domain/model";

export interface ClipboardPayload {
  plain: string;
  html: string;
}

export interface ClipboardCodec {
  buildPlain(doc: Doc, range: Range): string;
  buildHtml(doc: Doc, range: Range): string;
  parsePlain(text: string): Doc;
  parseHtml(html: string): Doc;
}
