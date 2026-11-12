// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { parseDocument } from "../../../../security/trustedHtml";
import { emptySource } from "../../domain/source";
import type { FormatReader } from "../../ports";
import { decodeText, htmlCharset } from "../decode";
import { linkComments, walkHtml } from "../htmlFlow";

// Reads a web page, which is also how an online word processor's file
// arrives: "download as web page" is the one export of its kind that keeps
// its italics and its comments, and `htmlFlow` knows its markup. The page is
// decoded by the charset it declares, then parsed as `text/html`, the
// forgiving parser, because pages in the wild are not well-formed, into an
// inert document.

export const htmlReader: FormatReader = {
  format: "html",
  async read(bytes, name) {
    const doc = emptySource("html");
    const text = decodeText(bytes, htmlCharset(bytes));
    const page = parseDocument(text, "text/html");
    const walk = walkHtml(page, doc.report);
    doc.meta = walk.meta;
    doc.flows.push({ name, blocks: walk.blocks });
    doc.comments = linkComments(
      walk.refs.map((ref) => ({ ...ref, flow: 0 })),
      walk.bodies,
      (ref) => ref.href.split("#")[1] ?? "",
    );
    return doc;
  },
};
