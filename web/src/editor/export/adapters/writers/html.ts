// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes HTML as one self-contained page that opens anywhere, offline: the
// stylesheet inline, and no script, remote font or image, so nothing in it
// reaches the network when a reader opens it. Each chapter is a `<section>`
// that ends on a page break when printed, except the last.
//
// The file is opened by people this app never meets, outside its CSP, and
// every word in it is escaped (`markup.ts`). It also carries a policy of its
// own: nothing loads, nothing runs, only its inline styles apply. A missed
// escape still leaves the browser opening the file refusing the script.

import type { ExportDocument } from "../../domain/model";
import type { FormatWriter } from "../../ports";
import { chapterToHtml, stylesheet } from "./markup";
import { escapeXml, utf8 } from "./xml";
import { PRODUCT } from "../../../../product";

export function renderHtml(doc: ExportDocument): string {
  const { meta } = doc;
  const body = doc.chapters
    .map((chapter) => chapterToHtml(chapter, doc, (id) => `#${id}`))
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${escapeXml(meta.language)}">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeXml(meta.title)}</title>
${meta.author ? `<meta name="author" content="${escapeXml(meta.author)}"/>\n` : ""}<meta name="generator" content="${escapeXml(PRODUCT.name)}"/>
<style>
${stylesheet(doc)}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export const htmlWriter: FormatWriter = {
  format: "html",
  write: async (doc) => utf8(renderHtml(doc)),
};
