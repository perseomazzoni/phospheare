// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { probeZip } from "../adapters/zip";
import { loadReader } from "../adapters/readers";
import {
  docxOf,
  epubOf,
  wp,
  wr,
  zipOf,
} from "../adapters/readers/packages.fixture";
import { MAX_FILE_BYTES, MAX_FILES } from "../domain/limits";
import type { InputFile } from "../ports";
import { admit, mergeSources, readFile, type FileResult } from "./readFiles";

const ctx = { yield: async () => undefined };
const deps = { load: loadReader, probe: probeZip };
const file = (
  name: string,
  bytes: Uint8Array | string,
  size?: number,
): InputFile => {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return { name, size: size ?? data.length, bytes: async () => data };
};

describe("readFile", () => {
  it("reads a file by what it is, not what it is called", async () => {
    const docx = docxOf({ body: wp(wr("Hello there.")) });
    const result = await readFile(file("manuscript.zip", docx), deps, ctx);
    expect(result).toMatchObject({ status: "ok", format: "docx" });
  });

  it("refuses with a reason: too large, a PDF, an empty file, a damaged package", async () => {
    expect(
      await readFile(
        file("big.txt", "x", MAX_FILE_BYTES.package + 1),
        deps,
        ctx,
      ),
    ).toMatchObject({
      status: "refused",
      reason: "tooLarge",
    });
    expect(
      await readFile(file("a.pdf", "%PDF-1.7 ..."), deps, ctx),
    ).toMatchObject({ reason: "pdf" });
    expect(await readFile(file("a.txt", "   \n\n "), deps, ctx)).toMatchObject({
      reason: "empty",
    });
    expect(
      await readFile(file("a.docx", zipOf({ "x.xml": "<x/>" })), deps, ctx),
    ).toMatchObject({
      status: "refused",
      reason: "damaged",
    });
  });

  it("holds a text format to its own, smaller cap", async () => {
    const big = new Uint8Array(MAX_FILE_BYTES.text + 1).fill(0x61);
    expect(await readFile(file("a.txt", big), deps, ctx)).toMatchObject({
      reason: "tooLarge",
      format: "txt",
    });
  });

  it("calls a file that cannot be read failed, not the whole import", async () => {
    const broken: InputFile = {
      name: "a.txt",
      size: 3,
      bytes: () => Promise.reject(new Error("gone")),
    };
    expect(await readFile(broken, deps, ctx)).toMatchObject({
      status: "refused",
      reason: "damaged",
    });
  });
});

describe("admit and merge", () => {
  const ok = (name: string, format: "md" | "epub" = "md"): FileResult => ({
    status: "ok",
    name,
    size: 1,
    format,
    doc: {
      formats: [format],
      meta: { title: name, author: "Ada", language: "it" },
      flows: [
        {
          name,
          blocks: [
            {
              kind: "para",
              inlines: [{ text: name }],
              align: "left",
              signals: {},
            },
          ],
        },
      ],
      comments: [
        {
          sourceId: "1",
          anchor: {
            flow: 0,
            start: { block: 0, offset: 1 },
            end: { block: 0, offset: 1 },
          },
          body: [],
        },
      ],
      report: { italic: 2 },
    },
  });

  it("refuses an epub among other files, and files past the cap", () => {
    expect(
      admit([ok("a.md"), ok("b.epub", "epub")]).map(
        (r) => r.status === "refused" && r.reason,
      ),
    ).toEqual([false, "mixed"]);
    expect(admit([ok("only.epub", "epub")])[0].status).toBe("ok");
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => ok(`${i}.md`));
    expect(admit(many)[MAX_FILES]).toMatchObject({ reason: "tooMany" });
  });

  it("merges files into one source, one flow each, in the order given", () => {
    const merged = mergeSources([ok("one.md"), ok("two.md")]);
    expect(merged?.flows.map((f) => f.name)).toEqual(["one.md", "two.md"]);
    // Each file's comments keep pointing at their own file.
    expect(merged?.comments.map((n) => n.anchor?.flow)).toEqual([0, 1]);
    expect(merged?.report).toEqual({ italic: 4 });
    // A file's title is a chapter's, not the book's; the author is.
    expect(merged?.meta).toEqual({ author: "Ada", language: "it" });
    expect(mergeSources([])).toBeNull();
    expect(mergeSources([ok("solo.md")])?.meta.title).toBe("solo.md");
  });

  it("reads a real epub through the registry", async () => {
    const epub = epubOf({
      chapters: [{ file: "c.xhtml", body: "<p>Text.</p>", navTitle: "One" }],
    });
    expect(await readFile(file("book.epub", epub), deps, ctx)).toMatchObject({
      status: "ok",
      format: "epub",
    });
  });
});

describe("readFile", () => {
  it("a zip whose insides cannot be probed is refused, never thrown", async () => {
    // A zip under a name that is no package, so the probe looks inside,
    // whose `mimetype` entry declares a compression method fflate cannot
    // inflate. The method sits at offset 10 of each central directory header.
    const zip = zipOf({ mimetype: "application/epub+zip" }).slice();
    const view = new DataView(zip.buffer);
    for (let i = 0; i + 46 <= zip.length; i++)
      if (view.getUint32(i, true) === 0x02014b50)
        view.setUint16(i + 10, 99, true);
    await expect(
      readFile(file("book.zip", zip), deps, ctx),
    ).resolves.toMatchObject({ status: "refused", reason: "damaged" });
  });
});
