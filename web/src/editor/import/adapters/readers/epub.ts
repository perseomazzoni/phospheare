// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  emptySource,
  mergeReports,
  type MatterKind,
  type ReadReport,
} from "../../domain/source";
import type { FormatReader } from "../../ports";
import { parseDocument } from "../../../../security/trustedHtml";
import { ReadRefused } from "../failure";
import { pacer } from "../flowBuilder";
import {
  linkComments,
  matterTypeOf,
  walkHtml,
  type CommentBody,
  type CommentRef,
} from "../htmlFlow";
import {
  attr,
  descendant,
  descendants,
  kid,
  kids,
  parseXml,
  resolvePath,
} from "../xml";
import { partText, unzipParts, zipNames } from "../zip";

// Reads EPUB: a published book, or one a writer made with a book formatter or
// a converter and wants back. The reading order is the spine (container.xml →
// the OPF → `<spine>`), never the zip's order. Each spine item becomes a flow
// carrying the title its table of contents gives it (the EPUB 3 nav, or the
// NCX of EPUB 2), what its `epub:type` says it is, and whether the spine
// marked it `linear="no"`, an aside the reader can skip, left out by default.
//
// Chapter files are XHTML and are parsed as XML first. One that does not
// parse (`&nbsp;` with no DTD, a missing close tag, which real epubs have) is
// parsed again as HTML, the forgiving way, rather than refused. Pictures are
// never inflated.
//
// DRM is refused with its own reason: an `encryption.xml` that encrypts
// anything but fonts (font obfuscation is not DRM, and many publishing tools
// apply it), or a DRM `rights.xml`.

const FONT_OBFUSCATION = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

const TEXT_PART = /\.(opf|ncx|xhtml|html|htm|xml)$/i;

function parseChapter(text: string): Document {
  try {
    return parseXml(text);
  } catch {
    return parseDocument(text, "text/html");
  }
}

function checkDrm(parts: Record<string, Uint8Array>, names: string[]): void {
  if (names.includes("META-INF/rights.xml")) throw new ReadRefused("drm");
  const encryption = partText(parts, "META-INF/encryption.xml");
  if (!encryption) return;
  const doc = parseXml(encryption);
  for (const method of descendants(doc, "EncryptionMethod")) {
    const algorithm = attr(method, "Algorithm") ?? "";
    if (!FONT_OBFUSCATION.has(algorithm))
      throw new ReadRefused("drm", algorithm);
  }
}

/** File → title from the EPUB 3 nav or EPUB 2 NCX; the first entry wins. */
function tableOfContents(
  parts: Record<string, Uint8Array>,
  navPath: string | undefined,
  ncxPath: string | undefined,
): Map<string, string> {
  const titles = new Map<string, string>();
  const add = (
    base: string,
    href: string | null,
    title: string | undefined,
  ) => {
    if (!href || !title?.trim()) return;
    const file = resolvePath(base, href);
    if (!titles.has(file)) titles.set(file, title.trim().replace(/\s+/g, " "));
  };
  const navText = navPath ? partText(parts, navPath) : null;
  if (navPath && navText) {
    const nav = parseChapter(navText);
    const toc =
      descendants(nav, "nav").find((el) =>
        Array.from(el.attributes).some(
          (a) => /(^|:)type$/.test(a.name) && /\btoc\b/.test(a.value),
        ),
      ) ?? descendant(nav, "nav");
    if (toc)
      for (const a of descendants(toc, "a"))
        add(navPath, attr(a, "href"), a.textContent ?? undefined);
  }
  const ncxText = ncxPath ? partText(parts, ncxPath) : null;
  if (ncxPath && ncxText && titles.size === 0) {
    const ncx = parseXml(ncxText);
    for (const point of descendants(ncx, "navPoint")) {
      const label =
        descendant(kid(point, "navLabel") ?? point, "text")?.textContent ??
        undefined;
      add(ncxPath, attr(kid(point, "content") ?? point, "src"), label);
    }
  }
  return titles;
}

export const epubReader: FormatReader = {
  format: "epub",
  async read(bytes, _name, ctx) {
    const doc = emptySource("epub");
    const names = zipNames(bytes);
    const parts = unzipParts(bytes, (n) => TEXT_PART.test(n));
    checkDrm(parts, names);

    const container = partText(parts, "META-INF/container.xml");
    if (!container) throw new ReadRefused("damaged", "no container.xml");
    const rootfile = descendant(parseXml(container), "rootfile");
    const opfPath = rootfile ? attr(rootfile, "full-path") : null;
    const opfText = opfPath ? partText(parts, opfPath) : null;
    if (!opfPath || !opfText)
      throw new ReadRefused("damaged", "no package document");
    const opf = parseXml(opfText);

    const metadata = descendant(opf, "metadata");
    if (metadata) {
      const text = (local: string) =>
        descendant(metadata, local)?.textContent?.trim() || undefined;
      const title = text("title");
      const author = text("creator");
      const language = text("language");
      if (title) doc.meta.title = title;
      if (author) doc.meta.author = author;
      if (language) doc.meta.language = language;
    }

    const manifest = new Map<
      string,
      { href: string; type: string; props: string }
    >();
    for (const item of descendants(opf, "item")) {
      const id = attr(item, "id");
      const href = attr(item, "href");
      if (id && href)
        manifest.set(id, {
          href: resolvePath(opfPath, href),
          type: attr(item, "media-type") ?? "",
          props: attr(item, "properties") ?? "",
        });
    }
    const spine = descendant(opf, "spine");
    if (!spine) throw new ReadRefused("damaged", "no spine");
    const navPath = [...manifest.values()].find((m) =>
      /\bnav\b/.test(m.props),
    )?.href;
    const ncxId = attr(spine, "toc");
    const ncxPath =
      (ncxId ? manifest.get(ncxId)?.href : undefined) ??
      [...manifest.values()].find((m) => m.type === "application/x-dtbncx+xml")
        ?.href;
    const titles = tableOfContents(parts, navPath, ncxPath);

    const pace = pacer(ctx);
    const refs: (CommentRef & { flow: number; file: string })[] = [];
    const bodies = new Map<string, CommentBody>();
    for (const itemref of kids(spine, "itemref")) {
      const item = manifest.get(attr(itemref, "idref") ?? "");
      if (!item) continue;
      const text = partText(parts, item.href);
      if (text === null) continue;
      await pace.tick();
      const page = parseChapter(text);
      const report: ReadReport = {};
      const walk = walkHtml(page, report);
      mergeReports(doc.report, report);
      const body = page.body ?? descendant(page, "body");
      const firstSection = body
        ? kids(body).find((el) => el.localName === "section")
        : undefined;
      const role: MatterKind | undefined =
        (body && matterTypeOf(body)) ||
        (firstSection && matterTypeOf(firstSection)) ||
        undefined;
      const flow = doc.flows.length;
      doc.flows.push({
        name: item.href,
        ...(titles.get(item.href) ? { navTitle: titles.get(item.href) } : {}),
        ...(role ? { role } : {}),
        ...(attr(itemref, "linear") === "no" ? { linear: false } : {}),
        blocks: walk.blocks,
      });
      for (const ref of walk.refs) refs.push({ ...ref, flow, file: item.href });
      for (const [id, body] of walk.bodies)
        bodies.set(`${item.href}#${id}`, body);
    }
    if (!doc.flows.length) throw new ReadRefused("damaged", "empty spine");

    // A reference may cite a note in another file ("notes.xhtml#n3").
    doc.comments = linkComments(refs, bodies, (ref) => {
      const { file } = ref as (typeof refs)[number];
      const [path, id] = ref.href.split("#");
      return `${path ? resolvePath(file, path) : file}#${id ?? ""}`;
    });
    return doc;
  },
};
