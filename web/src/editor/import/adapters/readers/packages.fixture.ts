// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { zipSync, type Zippable } from "fflate";

// Test-only packages, built in the test rather than checked in. Every docx,
// odt and epub the reader suites read is assembled here from a few lines of
// XML, so a fixture is readable in the test that uses it and no binary file
// has to be trusted, diffed or regenerated.

const utf8 = (text: string) => new TextEncoder().encode(text);

export function zipOf(
  files: Record<string, string | Uint8Array>,
  mimetype?: string,
): Uint8Array {
  const zippable: Zippable = {};
  if (mimetype !== undefined)
    zippable.mimetype = [utf8(mimetype), { level: 0 }];
  for (const [path, data] of Object.entries(files))
    zippable[path] = typeof data === "string" ? utf8(data) : data;
  return zipSync(zippable, { level: 6 });
}

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

export interface DocxParts {
  /** The inside of `<w:body>`. */
  body: string;
  /** The inside of `<w:styles>`. */
  styles?: string;
  footnotes?: string;
  endnotes?: string;
  comments?: string;
  commentsExtended?: string;
  core?: { title?: string; creator?: string; language?: string };
  /** Replaces the namespace declarations, as for the Strict schema. */
  ns?: string;
}

export function docxOf(parts: DocxParts): Uint8Array {
  const ns = parts.ns ?? W;
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${ns}><w:body>${parts.body}</w:body></w:document>`,
  };
  if (parts.styles)
    files["word/styles.xml"] = `<w:styles ${ns}>${parts.styles}</w:styles>`;
  if (parts.footnotes)
    files["word/footnotes.xml"] =
      `<w:footnotes ${ns}>${parts.footnotes}</w:footnotes>`;
  if (parts.endnotes)
    files["word/endnotes.xml"] =
      `<w:endnotes ${ns}>${parts.endnotes}</w:endnotes>`;
  if (parts.comments)
    files["word/comments.xml"] =
      `<w:comments ${ns}>${parts.comments}</w:comments>`;
  if (parts.commentsExtended)
    files["word/commentsExtended.xml"] =
      `<w15:commentsEx ${ns}>${parts.commentsExtended}</w15:commentsEx>`;
  if (parts.core) {
    const { title, creator, language } = parts.core;
    files["docProps/core.xml"] =
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      (title ? `<dc:title>${title}</dc:title>` : "") +
      (creator ? `<dc:creator>${creator}</dc:creator>` : "") +
      (language ? `<dc:language>${language}</dc:language>` : "") +
      "</cp:coreProperties>";
  }
  return zipOf(files);
}

/** A docx paragraph: `<w:p>` with optional paragraph properties and runs. */
export function wp(runs: string, pPr = ""): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`;
}

/** A docx run: `<w:r>` with optional run properties. */
export function wr(text: string, rPr = ""): string {
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
}

const ODF =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';

export interface OdtParts {
  /** The inside of `<office:text>`. */
  text: string;
  /** The inside of `<office:automatic-styles>` in content.xml. */
  automatic?: string;
  /** The inside of `<office:styles>` in styles.xml. */
  styles?: string;
  meta?: { title?: string; creator?: string; language?: string };
}

export function odtOf(parts: OdtParts): Uint8Array {
  const files: Record<string, string> = {
    "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF}><office:automatic-styles>${parts.automatic ?? ""}</office:automatic-styles><office:body><office:text>${parts.text}</office:text></office:body></office:document-content>`,
    "META-INF/manifest.xml":
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>',
  };
  if (parts.styles)
    files["styles.xml"] =
      `<office:document-styles ${ODF}><office:styles>${parts.styles}</office:styles></office:document-styles>`;
  if (parts.meta) {
    const { title, creator, language } = parts.meta;
    files["meta.xml"] =
      `<office:document-meta ${ODF}><office:meta>` +
      (title ? `<dc:title>${title}</dc:title>` : "") +
      (creator ? `<dc:creator>${creator}</dc:creator>` : "") +
      (language ? `<dc:language>${language}</dc:language>` : "") +
      "</office:meta></office:document-meta>";
  }
  return zipOf(files, "application/vnd.oasis.opendocument.text");
}

export interface EpubChapter {
  /** The file name under `OEBPS/`. */
  file: string;
  /** The inside of `<body>`. */
  body: string;
  /** The nav's title for it; absent leaves it out of the nav. */
  navTitle?: string;
  linear?: boolean;
  /** `epub:type` on the body. */
  type?: string;
}

export interface EpubParts {
  chapters: EpubChapter[];
  title?: string;
  creator?: string;
  language?: string;
  /** An NCX instead of an EPUB 3 nav. */
  ncx?: boolean;
  /** Extra files, such as `META-INF/encryption.xml`. */
  extra?: Record<string, string>;
}

export function epubOf(parts: EpubParts): Uint8Array {
  const xhtml = (chapter: EpubChapter) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body${chapter.type ? ` epub:type="${chapter.type}"` : ""}>${chapter.body}</body></html>`;
  const manifest = parts.chapters
    .map(
      (c, i) =>
        `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`,
    )
    .join("");
  const spine = parts.chapters
    .map(
      (c, i) =>
        `<itemref idref="c${i}"${c.linear === false ? ' linear="no"' : ""}/>`,
    )
    .join("");
  const navItems = parts.chapters
    .filter((c) => c.navTitle)
    .map((c) => `<li><a href="${c.file}">${c.navTitle}</a></li>`)
    .join("");
  const files: Record<string, string> = {
    "META-INF/container.xml":
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    "OEBPS/content.opf":
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      (parts.title ? `<dc:title>${parts.title}</dc:title>` : "") +
      (parts.creator ? `<dc:creator>${parts.creator}</dc:creator>` : "") +
      (parts.language ? `<dc:language>${parts.language}</dc:language>` : "") +
      `</metadata><manifest>${manifest}` +
      (parts.ncx
        ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
        : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>') +
      `</manifest><spine${parts.ncx ? ' toc="ncx"' : ""}>${spine}</spine></package>`,
    ...parts.extra,
  };
  if (parts.ncx)
    files["OEBPS/toc.ncx"] =
      `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>` +
      parts.chapters
        .filter((c) => c.navTitle)
        .map(
          (c, i) =>
            `<navPoint id="n${i}"><navLabel><text>${c.navTitle}</text></navLabel><content src="${c.file}"/></navPoint>`,
        )
        .join("") +
      "</navMap></ncx>";
  else
    files["OEBPS/nav.xhtml"] =
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${navItems}</ol></nav></body></html>`;
  for (const chapter of parts.chapters)
    files[`OEBPS/${chapter.file}`] = xhtml(chapter);
  return zipOf(files, "application/epub+zip");
}
