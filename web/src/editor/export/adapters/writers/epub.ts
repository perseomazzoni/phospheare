// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Writes EPUB 3 that passes EPUBCheck and the ebook stores' own checks,
// because an EPUB a validator rejects is the most-reported export failure:
//
//   - `mimetype` first and stored (`zip.ts`);
//   - a package document with `dc:identifier` (referenced as the unique
//     identifier), `dc:title`, `dc:language` and `dcterms:modified` in the
//     `CCYY-MM-DDThh:mm:ssZ` form;
//   - a navigation document (`nav.xhtml`) with a `toc` and `landmarks`, and an
//     NCX beside it for older readers;
//   - one well-formed XHTML file per chapter, every id unique, every word
//     escaped and stripped of the characters XML forbids;
//   - schema.org accessibility metadata, which an EU sale expects under the
//     European Accessibility Act. It describes what the file is and claims no
//     conformance that nobody has audited.
//
// No font, image or script is packaged: nothing to license, nothing to run.

import {
  tocEntries,
  type Chapter,
  type ExportDocument,
} from "../../domain/model";
import type { FormatWriter } from "../../ports";
import { chapterToHtml, nestedList, stylesheet } from "./markup";
import { escapeXml, isoSeconds, XML_DECLARATION } from "./xml";
import { zipPackage } from "./zip";
import { PRODUCT } from "../../../../product";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The book's id as a URN, stable across exports so a reader sees one book. */
export function identifierOf(id: string): string {
  return UUID.test(id)
    ? `urn:uuid:${id.toLowerCase()}`
    : `urn:${PRODUCT.kebab}:book:${encodeURIComponent(id)}`;
}

const fileOf = (chapter: Chapter) => `${chapter.id}.xhtml`;

function epubTypeOf(chapter: Chapter): string {
  switch (chapter.kind) {
    case "tech":
      return "frontmatter";
    case "title":
      return "titlepage";
    case "toc":
      return "toc";
    case "part":
      return "part";
    case "section":
      return "chapter";
    case "group":
    case "reference":
    case "note":
      return "appendix";
  }
}

function xhtml(doc: ExportDocument, title: string, body: string): string {
  const lang = escapeXml(doc.meta.language);
  return `${XML_DECLARATION}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;
}

function epubEntries(doc: ExportDocument) {
  const { meta } = doc;
  const byId = new Map(doc.chapters.map((chapter) => [chapter.id, chapter]));
  const href = (id: string) => {
    const chapter = byId.get(id);
    return chapter ? `${fileOf(chapter)}#${id}-title` : "#";
  };
  // A navigation document must list something: a book exported with only
  // its tech page lists that page.
  const listed = tocEntries(doc);
  const entries =
    listed.length > 0
      ? listed
      : doc.chapters.slice(0, 1).map((chapter) => ({
          id: chapter.id,
          title: chapter.title ?? meta.title,
          level: 1 as const,
        }));
  const identifier = identifierOf(meta.id);
  // EPUB's required form: seconds, no fraction, UTC.
  const modified = isoSeconds(meta.exportedAt);
  const firstText = doc.chapters.find(
    (chapter) => chapter.kind === "part" || chapter.kind === "section",
  );
  const tocPage = doc.chapters.find((chapter) => chapter.kind === "toc");

  const chapterFiles = doc.chapters.map((chapter) => ({
    path: `OEBPS/${fileOf(chapter)}`,
    data: xhtml(
      doc,
      chapter.title ?? meta.title,
      chapterToHtml(chapter, doc, href, epubTypeOf(chapter)),
    ),
  }));

  const landmarks = [
    tocPage
      ? `<li><a epub:type="toc" href="${fileOf(tocPage)}">${escapeXml(tocPage.title ?? "")}</a></li>`
      : "",
    firstText
      ? `<li><a epub:type="bodymatter" href="${fileOf(firstText)}">${escapeXml(firstText.title ?? meta.title)}</a></li>`
      : "",
  ].join("");

  const nav = xhtml(
    doc,
    tocPage?.title ?? meta.title,
    `<nav epub:type="toc" id="toc">
<h1>${escapeXml(tocPage?.title ?? meta.title)}</h1>
${nestedList(entries, href)}
</nav>
${landmarks ? `<nav epub:type="landmarks" id="landmarks" hidden="hidden"><ol>${landmarks}</ol></nav>` : ""}`,
  );

  const ncx = `${XML_DECLARATION}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapeXml(identifier)}"/></head>
<docTitle><text>${escapeXml(meta.title)}</text></docTitle>
<navMap>
${entries
  .map(
    (entry, index) =>
      `<navPoint id="nav-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(entry.title)}</text></navLabel><content src="${escapeXml(href(entry.id))}"/></navPoint>`,
  )
  .join("\n")}
</navMap>
</ncx>
`;

  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...doc.chapters.map(
      (chapter) =>
        `<item id="${chapter.id}" href="${fileOf(chapter)}" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n");
  const spine = doc.chapters
    .map((chapter) => `<itemref idref="${chapter.id}"/>`)
    .join("\n");

  const opf = `${XML_DECLARATION}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(meta.language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
<dc:title>${escapeXml(meta.title)}</dc:title>
<dc:language>${escapeXml(meta.language)}</dc:language>
${meta.author ? `<dc:creator id="creator">${escapeXml(meta.author)}</dc:creator>\n` : ""}${meta.subject ? `<dc:subject>${escapeXml(meta.subject)}</dc:subject>\n` : ""}<meta property="dcterms:modified">${modified}</meta>
<meta property="schema:accessMode">textual</meta>
<meta property="schema:accessModeSufficient">textual</meta>
<meta property="schema:accessibilityFeature">structuralNavigation</meta>
<meta property="schema:accessibilityFeature">tableOfContents</meta>
<meta property="schema:accessibilityFeature">readingOrder</meta>
<meta property="schema:accessibilityHazard">none</meta>
<meta property="schema:accessibilitySummary">${escapeXml(meta.accessibilitySummary)}</meta>
<meta name="generator" content="${escapeXml(PRODUCT.name)}"/>
</metadata>
<manifest>
${manifest}
</manifest>
<spine toc="ncx">
${spine}
</spine>
</package>
`;

  const container = `${XML_DECLARATION}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

  return [
    { path: "META-INF/container.xml", data: container },
    { path: "OEBPS/content.opf", data: opf },
    { path: "OEBPS/nav.xhtml", data: nav },
    { path: "OEBPS/toc.ncx", data: ncx },
    { path: "OEBPS/style.css", data: stylesheet(doc) },
    ...chapterFiles,
  ];
}

export const epubWriter: FormatWriter = {
  format: "epub",
  write: async (doc) => zipPackage(epubEntries(doc), "application/epub+zip"),
};
