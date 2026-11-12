// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { MAX_PART_BYTES, MAX_ZIP_ENTRIES, YIELD_EVERY } from "../domain/limits";
import { classRules, parseDeclarations } from "./css";
import { codepageLabel, decodeText, htmlCharset } from "./decode";
import { ReadRefused } from "./failure";
import { pacer } from "./flowBuilder";
import { manuscriptText } from "./manuscriptText";
import {
  attr,
  descendants,
  kid,
  kids,
  onOff,
  parseXml,
  resolvePath,
} from "./xml";
import { partText, probeZip, unzipParts, zipNames } from "./zip";
import {
  docxOf,
  epubOf,
  odtOf,
  wp,
  wr,
  zipOf,
} from "./readers/packages.fixture";

const refusal = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ReadRefused ? err.reason : `other: ${String(err)}`;
  }
};

/**
 * A zip whose central directory claims each entry inflates to `size` bytes:
 * the shape of a bomb, without building one. The uncompressed size sits at
 * offset 24 of every central directory header (signature `0x02014b50`).
 */
function forgeDeclaredSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i + 46 <= out.length; i++)
    if (view.getUint32(i, true) === 0x02014b50)
      view.setUint32(i + 24, size, true);
  return out;
}

describe("zip", () => {
  it("lists names and inflates only the parts asked for", () => {
    const zip = zipOf({ "a.xml": "<a/>", "b.png": new Uint8Array(10) });
    expect(zipNames(zip).sort()).toEqual(["a.xml", "b.png"]);
    const parts = unzipParts(zip, (name) => name.endsWith(".xml"));
    expect(Object.keys(parts)).toEqual(["a.xml"]);
    expect(partText(parts, "a.xml")).toBe("<a/>");
    expect(partText(parts, "missing")).toBeNull();
  });

  it("refuses a part that declares more than the cap, before inflating it", () => {
    const zip = forgeDeclaredSize(
      zipOf({ "a.xml": "<a/>" }),
      MAX_PART_BYTES + 1,
    );
    expect(refusal(() => unzipParts(zip, () => true))).toBe("bomb");
    // A part nobody asked for may declare what it likes.
    expect(refusal(() => unzipParts(zip, () => false))).toBeNull();
  });

  // The declaration bounds nothing: a deflate stream holds what its author
  // put in. A megabyte of one letter compresses to a kilobyte and declares
  // what it likes; the count of what comes out is the guard.
  it("refuses a deflated part that yields more than it declares", () => {
    const zip = forgeDeclaredSize(
      zipSync({ "a.xml": strToU8("x".repeat(1 << 20)) }, { level: 6 }),
      59,
    );
    expect(refusal(() => unzipParts(zip, () => true))).toBe("bomb");
  });

  // A part whose compressed bytes span many inflation steps must come out
  // whole and in order: the steps are the guard's granularity, not a seam
  // a reader can see.
  it("inflates a part of many steps whole", () => {
    let seed = 7;
    const words: string[] = [];
    for (let i = 0; i < 200_000; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      words.push(seed.toString(36));
    }
    const text = words.join(" ");
    const zip = zipSync({ "a.xml": strToU8(text) }, { level: 6 });
    expect(zip.length).toBeGreaterThan(256 * 1024);
    expect(
      partText(
        unzipParts(zip, () => true),
        "a.xml",
      ),
    ).toBe(text);
  });

  it("refuses a deflated part that yields less than it declares", () => {
    const zip = forgeDeclaredSize(zipOf({ "a.xml": "<a/>" }), 1024);
    expect(refusal(() => unzipParts(zip, () => true))).toBe("damaged");
  });

  // A flipped byte in a stored part changes neither size, so only the
  // checksum tells a part that is not the one the directory describes.
  it("refuses a part that fails its checksum", () => {
    const zip = zipSync({ "a.xml": strToU8("<a>hello</a>") }, { level: 0 });
    const view = new DataView(zip.buffer);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    zip[start + 3] ^= 0xff;
    expect(refusal(() => unzipParts(zip, () => true))).toBe("damaged");
  });

  it("reads a name as UTF-8 only when the entry says so", () => {
    const zip = zipOf({ "capítulo.xml": "<a/>" });
    expect(zipNames(zip)).toEqual(["capítulo.xml"]);
    const view = new DataView(zip.buffer);
    for (let i = 0; i + 46 <= zip.length; i++)
      if (view.getUint32(i, true) === 0x02014b50)
        view.setUint16(i + 8, view.getUint16(i + 8, true) & ~0x800, true);
    expect(zipNames(zip)).toEqual(["capÃ­tulo.xml"]);
  });

  it("refuses parts whose declared sizes add up past the total", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`p${i}.xml`] = "<a/>";
    const zip = forgeDeclaredSize(zipOf(files), MAX_PART_BYTES - 1);
    expect(refusal(() => unzipParts(zip, () => true))).toBe("bomb");
  });

  // Building a zip one entry past the cap is slow, not the refusal: under
  // coverage with the whole suite running it can exceed vitest's five
  // seconds, so this row gets a longer timeout.
  it("refuses a directory with more entries than any manuscript has", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) files[`e${i}`] = "";
    expect(refusal(() => zipNames(zipOf(files)))).toBe("bomb");
  }, 20_000);

  it("calls bytes that are not a zip damaged", () => {
    expect(refusal(() => zipNames(new Uint8Array([1, 2, 3])))).toBe("damaged");
  });

  // A stored part is copied by its stored size, so a part that stores 1,024
  // bytes and declares one would slip 1,023 past every cap.
  it("refuses a stored part whose two sizes disagree", () => {
    const zip = zipSync({ "a.xml": strToU8("x".repeat(1024)) }, { level: 0 });
    const view = new DataView(zip.buffer);
    view.setUint32(22, 1, true);
    for (let i = 0; i + 46 <= zip.length; i++)
      if (view.getUint32(i, true) === 0x02014b50)
        view.setUint32(i + 24, 1, true);
    expect(refusal(() => unzipParts(zip, () => true))).toBe("damaged");
  });

  /** `count` names over one stored entry's bytes. */
  function sharingBytes(count: number): Uint8Array {
    const zip = zipSync(
      { "a000.xml": strToU8("x".repeat(8192)) },
      { level: 0 },
    );
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    const centralStart = view.getUint32(end + 16, true);
    const header = zip.slice(centralStart, end);
    const crafted = new Uint8Array(centralStart + header.length * count + 22);
    crafted.set(zip.subarray(0, centralStart));
    const craftedView = new DataView(crafted.buffer);
    for (let i = 0; i < count; i++) {
      const offset = centralStart + header.length * i;
      crafted.set(header, offset);
      crafted.set(strToU8(`a${String(i).padStart(3, "0")}.xml`), offset + 46);
    }
    const newEnd = crafted.length - 22;
    crafted.set(zip.subarray(end), newEnd);
    craftedView.setUint16(newEnd + 8, count, true);
    craftedView.setUint16(newEnd + 10, count, true);
    craftedView.setUint32(newEnd + 12, header.length * count, true);
    return crafted;
  }

  /**
   * The same package with a zip64 directory end and its locator before the
   * classic one, its fields left unsaturated, as some tools always write.
   */
  function withZip64Record(zip: Uint8Array): Uint8Array {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    const count = view.getUint16(end + 8, true);
    const size = view.getUint32(end + 12, true);
    const start = view.getUint32(end + 16, true);
    const out = new Uint8Array(zip.length + 56 + 20);
    out.set(zip.subarray(0, end));
    const at = new DataView(out.buffer);
    at.setUint32(end, 0x06064b50, true);
    at.setBigUint64(end + 4, 44n, true);
    at.setBigUint64(end + 24, BigInt(count), true);
    at.setBigUint64(end + 32, BigInt(count), true);
    at.setBigUint64(end + 40, BigInt(size), true);
    at.setBigUint64(end + 48, BigInt(start), true);
    at.setUint32(end + 56, 0x07064b50, true);
    at.setBigUint64(end + 64, BigInt(end), true);
    at.setUint32(end + 72, 1, true);
    out.set(zip.subarray(end), end + 76);
    return out;
  }

  // Thirty-two names over one stored entry's bytes: each would be copied in
  // full while the directory counted them once.
  it("refuses entries that share their bytes", () => {
    const crafted = sharingBytes(32);
    expect(refusal(() => zipNames(crafted))).toBe("bomb");
    expect(refusal(() => unzipParts(crafted, () => true))).toBe("bomb");
  });

  // fflate walks the count of entries on this disk; a check that read the
  // other count could walk one record while fflate copied thirty-two.
  it("refuses a directory whose two entry counts disagree", () => {
    const crafted = sharingBytes(32);
    new DataView(crafted.buffer).setUint16(crafted.length - 22 + 10, 1, true);
    expect(refusal(() => unzipParts(crafted, () => true))).toBe("damaged");
  });

  // fflate follows a zip64 record whenever its locator is present, so the
  // check does too, and an honest package that carries one still opens.
  it("reads a zip64 directory end the way fflate does", () => {
    const honest = withZip64Record(zipOf({ "a.xml": "<a/>" }));
    expect(
      partText(
        unzipParts(honest, () => true),
        "a.xml",
      ),
    ).toBe("<a/>");
    expect(
      refusal(() => unzipParts(withZip64Record(sharingBytes(32)), () => true)),
    ).toBe("bomb");
  });
  it("refuses damaged zip64 locators, counts and directory bounds", () => {
    const original = withZip64Record(zipOf({ "a.xml": "<a/>" }));
    const classicEnd = original.length - 22;
    const wideEnd = classicEnd - 76;
    for (const corrupt of [
      (view: DataView) => view.setUint32(classicEnd - 8, 1, true),
      (view: DataView) => view.setBigUint64(wideEnd + 24, 2n, true),
      (view: DataView) =>
        view.setBigUint64(wideEnd + 40, BigInt(original.length), true),
      (view: DataView) =>
        view.setBigUint64(wideEnd + 48, BigInt(original.length), true),
    ]) {
      const bad = original.slice();
      corrupt(new DataView(bad.buffer));
      expect(refusal(() => zipNames(bad))).toBe("damaged");
    }
  });
  it("reads bounded zip64 entry fields and refuses missing or overflowing fields", () => {
    const zip = zipSync({ "a.xml": strToU8("<a/>") }, { level: 0 });
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    const start = view.getUint32(end + 16, true);
    const extraAt = start + 46 + view.getUint16(start + 28, true);
    const expanded = new Uint8Array(zip.length + 28);
    expanded.set(zip.subarray(0, extraAt));
    expanded.set(zip.subarray(extraAt), extraAt + 28);
    const fields = new DataView(expanded.buffer);
    fields.setUint16(extraAt, 1, true);
    fields.setUint16(extraAt + 2, 24, true);
    fields.setBigUint64(
      extraAt + 4,
      BigInt(view.getUint32(start + 24, true)),
      true,
    );
    fields.setBigUint64(
      extraAt + 12,
      BigInt(view.getUint32(start + 20, true)),
      true,
    );
    fields.setBigUint64(
      extraAt + 20,
      BigInt(view.getUint32(start + 42, true)),
      true,
    );
    for (const offset of [20, 24, 42])
      fields.setUint32(start + offset, 0xffffffff, true);
    fields.setUint16(start + 30, view.getUint16(start + 30, true) + 28, true);
    fields.setUint32(end + 28 + 12, view.getUint32(end + 12, true) + 28, true);
    const wide = withZip64Record(expanded);
    expect(
      partText(
        unzipParts(wide, () => true),
        "a.xml",
      ),
    ).toBe("<a/>");
    for (const corrupt of [
      (v: DataView) => v.setUint16(extraAt, 2, true),
      (v: DataView) => v.setUint16(extraAt + 2, 16, true),
      (v: DataView) => v.setBigUint64(extraAt + 4, 2n ** 60n, true),
    ]) {
      const bad = wide.slice();
      corrupt(new DataView(bad.buffer));
      expect(refusal(() => zipNames(bad))).toBe("damaged");
    }
  });
  it("refuses saturated classic records without a valid zip64 end", () => {
    const zip = zipOf({ "a.xml": "<a/>" });
    const end = zip.length - 22;
    new DataView(zip.buffer).setUint32(end + 12, 0xffffffff, true);
    expect(refusal(() => zipNames(zip))).toBe("damaged");
  });
  it("refuses missing central or local headers instead of accepting a partial package", () => {
    const zip = zipOf({ "a.xml": "<a/>" });
    const start = new DataView(zip.buffer).getUint32(
      zip.length - 22 + 16,
      true,
    );
    for (const offset of [start, 0]) {
      const bad = zip.slice();
      new DataView(bad.buffer).setUint32(offset, 0, true);
      expect(refusal(() => zipNames(bad))).toBe("damaged");
    }
  });

  it("refuses an entry whose bytes run into the directory", () => {
    const zip = zipSync({ "a.xml": strToU8("x".repeat(64)) }, { level: 0 });
    const view = new DataView(zip.buffer);
    for (let i = 0; i + 46 <= zip.length; i++)
      if (view.getUint32(i, true) === 0x02014b50)
        view.setUint32(i + 20, 4096, true);
    expect(refusal(() => zipNames(zip))).toBe("damaged");
  });

  it("opens a stored part whose sizes agree, as an EPUB's mimetype is", () => {
    const zip = zipSync(
      { mimetype: [strToU8("application/epub+zip"), { level: 0 }] },
      { level: 6 },
    );
    expect(
      partText(
        unzipParts(zip, () => true),
        "mimetype",
      ),
    ).toBe("application/epub+zip");
  });

  it("tells the packages apart by their insides", async () => {
    expect(await probeZip(docxOf({ body: wp(wr("x")) }))).toEqual({
      kind: "format",
      format: "docx",
    });
    expect(await probeZip(odtOf({ text: "" }))).toEqual({
      kind: "format",
      format: "odt",
    });
    expect(await probeZip(epubOf({ chapters: [] }))).toEqual({
      kind: "format",
      format: "epub",
    });
    expect(await probeZip(zipOf({ "Index/Document.iwa": "x" }))).toEqual({
      kind: "refused",
      reason: "pages",
    });
    expect(await probeZip(zipOf({ "photo.jpg": "x" }))).toEqual({
      kind: "refused",
      reason: "unknown",
    });
    expect(await probeZip(new Uint8Array([9, 9]))).toEqual({
      kind: "refused",
      reason: "damaged",
    });
  });
});

describe("xml", () => {
  it("refuses entity declarations — the billion laughs — before parsing", () => {
    const laughs =
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "ha"><!ENTITY b "&a;&a;">]><x>&b;</x>';
    expect(refusal(() => parseXml(laughs))).toBe("damaged");
  });

  it("calls XML that does not parse damaged", () => {
    expect(refusal(() => parseXml("<a><b></a>"))).toBe("damaged");
  });

  it("matches by local name whatever the prefix", () => {
    const doc = parseXml(
      '<w:body xmlns:w="urn:x" xmlns:q="urn:x"><w:p q:val="1"><w:t>a</w:t></w:p><q:p/><w:b/></w:body>',
    );
    const body = doc.documentElement;
    expect(kids(body, "p")).toHaveLength(2);
    expect(kids(body)).toHaveLength(3);
    expect(kid(body, "b")).not.toBeNull();
    expect(descendants(doc, "t")[0].textContent).toBe("a");
    expect(attr(kids(body, "p")[0], "val")).toBe("1");
  });

  it("reads OOXML on/off the way Word writes it", () => {
    const doc = parseXml(
      '<r xmlns:w="urn:x"><w:b/><w:i w:val="0"/><w:u w:val="false"/><w:caps w:val="1"/></r>',
    );
    const [b, i, u, caps] = kids(doc.documentElement);
    expect(onOff(b)).toBe(true);
    expect(onOff(i)).toBe(false);
    expect(onOff(u)).toBe(false);
    expect(onOff(caps)).toBe(true);
    expect(onOff(null)).toBeUndefined();
  });

  it("resolves package paths", () => {
    expect(resolvePath("OEBPS/nav.xhtml", "Text/ch1.xhtml#x")).toBe(
      "OEBPS/Text/ch1.xhtml",
    );
    expect(resolvePath("OEBPS/Text/a.xhtml", "../Images/i.png")).toBe(
      "OEBPS/Images/i.png",
    );
    expect(resolvePath("OEBPS/a.opf", "/root.xhtml")).toBe("root.xhtml");
    expect(resolvePath("OEBPS/a.opf", "My%20Chapter.xhtml")).toBe(
      "OEBPS/My Chapter.xhtml",
    );
  });
});

describe("decode", () => {
  const enc = (text: string) => new TextEncoder().encode(text);

  it("trusts a byte-order mark first", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toBe("a");
    expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe("a");
  });

  it("reads clean UTF-8 as UTF-8, and anything else as Windows-1252", () => {
    expect(decodeText(enc("’quoted’"))).toBe("’quoted’");
    // 0x92 is the right single quote in cp1252 and invalid alone in UTF-8.
    expect(decodeText(new Uint8Array([0x69, 0x74, 0x92, 0x73]))).toBe("it’s");
  });

  it("follows a declared legacy charset unless the bytes are clean UTF-8", () => {
    // 0xE8 is "č" in cp1250 and "è" in Latin-1, so the row uses 0x9A ("š").
    expect(decodeText(new Uint8Array([0x9a]), "windows-1250")).toBe("š");
    expect(decodeText(enc("è"), "iso-8859-1")).toBe("è");
    expect(decodeText(enc("è"), "utf-8")).toBe("è");
    expect(decodeText(new Uint8Array([0x9a]), "no-such-charset")).toBe("š");
  });

  it("finds an HTML page's declared charset", () => {
    expect(htmlCharset(enc('<meta charset="windows-1252">'))).toBe(
      "windows-1252",
    );
    expect(
      htmlCharset(
        enc(
          '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">',
        ),
      ),
    ).toBe("iso-8859-1");
    expect(htmlCharset(enc("<p>none</p>"))).toBeNull();
  });

  it("names the code pages RTF uses", () => {
    expect(codepageLabel(1252)).toBe("windows-1252");
    expect(codepageLabel(1250)).toBe("windows-1250");
    expect(codepageLabel(932)).toBe("shift_jis");
    expect(codepageLabel(1)).toBeNull();
  });
});

describe("manuscriptText", () => {
  it("writes the draft through the engine's own codec", () => {
    const plain = { bold: false, italic: false, monospace: false };
    expect(
      manuscriptText.serialize([
        {
          blockType: "h1",
          alignment: "left",
          runs: [{ text: "One", ...plain }],
        },
        {
          blockType: "paragraph",
          alignment: "left",
          runs: [
            { text: "She ", ...plain },
            { text: "ran", ...plain, italic: true },
            { text: ".", ...plain },
          ],
        },
        {
          blockType: "paragraph",
          alignment: "center",
          runs: [{ text: "* * *", ...plain }],
        },
        { blockType: "pagebreak", alignment: "left", runs: [] },
      ]),
    ).toBe("# One\n\nShe *ran*.\n\n{align:center}\\* \\* \\*\n\n{pagebreak}");
  });
});

describe("css", () => {
  it("reads the properties that carry meaning in a manuscript", () => {
    expect(
      parseDeclarations(
        "font-style: oblique; font-weight: 600; text-decoration: underline line-through; font-family: 'Courier New', monospace",
      ),
    ).toEqual({
      italic: true,
      bold: true,
      underline: true,
      strike: true,
      mono: true,
    });
    expect(
      parseDeclarations(
        "text-transform: uppercase; display: none; text-align: justify; page-break-before: always; break-after: page; mso-outline-level: 2",
      ),
    ).toEqual({
      caps: true,
      hidden: true,
      align: "justify",
      breakBefore: true,
      breakAfter: true,
      outlineLevel: 2,
    });
    expect(
      parseDeclarations("font-variant: small-caps; visibility: hidden"),
    ).toEqual({ caps: true, hidden: true });
    // `none` takes both lines off; a lowercase transform is no capitals.
    expect(
      parseDeclarations("text-decoration: none; text-transform: lowercase"),
    ).toEqual({ underline: false, strike: false, caps: false });
  });

  it("turns every font-size unit into points, and ignores what it cannot read", () => {
    const size = (value: string) =>
      parseDeclarations(`font-size: ${value}`).fontSizePt;
    expect(size("16px")).toBe(12);
    expect(size("1.5em")).toBe(18);
    expect(size("2rem")).toBe(24);
    expect(size("150%")).toBe(18);
    expect(size("14pt")).toBe(14);
    expect(size("14")).toBe(14);
    expect(size("large")).toBeUndefined();
    expect(size("0px")).toBeUndefined();
  });

  it("ignores what is not a declaration, and alignments it does not know", () => {
    expect(
      parseDeclarations(
        "garbage; text-align: start; break-before: auto; mso-outline-level: 9; color: red !important",
      ),
    ).toEqual({});
    expect(parseDeclarations("font-style: normal !important")).toEqual({
      italic: false,
    });
  });

  it("collects class rules, the last one winning, and nothing that is not a class", () => {
    const rules = classRules([
      ".c1{font-style:italic} p.c2, .c3 {font-weight:bold} /* .c5{font-style:italic} */ #id{font-style:italic} .c4:hover{font-style:italic}",
      "@media print { .c6{font-style:italic} } .c1{font-weight:700}",
    ]);
    expect(rules.get("c1")).toEqual({ italic: true, bold: true });
    expect(rules.get("c3")).toEqual({ bold: true });
    expect(rules.get("c2")).toEqual({ bold: true });
    expect([...rules.keys()].sort()).toEqual(["c1", "c2", "c3"]);
  });
});

describe("pacer", () => {
  it("hands the page a frame every few thousand paragraphs, and stops once the window has closed", async () => {
    let frames = 0;
    const controller = new AbortController();
    const pace = pacer({
      yield: async () => {
        frames += 1;
      },
      signal: controller.signal,
    });
    for (let n = 0; n < YIELD_EVERY; n++) await pace.tick();
    expect(frames).toBe(1);
    controller.abort();
    for (let n = 1; n < YIELD_EVERY; n++) await pace.tick();
    await expect(pace.tick()).rejects.toMatchObject({ name: "AbortError" });
  });
});
