// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Bytes to text. A text file does not say what encoding it is in, and a wrong
// guess is the "smart quotes came through as â€™" complaint. The order of
// evidence:
//
//   1. a byte-order mark, which is unambiguous;
//   2. a charset the file declares (an HTML `<meta>`, an RTF `\ansicpg`);
//   3. strict UTF-8, which almost never decodes text that is not UTF-8, so a
//      clean decode is strong evidence;
//   4. Windows-1252, the encoding older Western word processors saved in, and
//      a superset of Latin-1.

const BOMS: [number[], string][] = [
  [[0xef, 0xbb, 0xbf], "utf-8"],
  [[0xff, 0xfe], "utf-16le"],
  [[0xfe, 0xff], "utf-16be"],
];

/** The TextDecoder label for a Windows code page, or `null` when unknown. */
export function codepageLabel(codepage: number): string | null {
  if (codepage >= 1250 && codepage <= 1258) return `windows-${codepage}`;
  const named: Record<number, string> = {
    437: "ibm866",
    850: "windows-1252",
    866: "ibm866",
    874: "windows-874",
    932: "shift_jis",
    936: "gbk",
    949: "euc-kr",
    950: "big5",
    10000: "macintosh",
    20866: "koi8-r",
    28591: "iso-8859-1",
    28592: "iso-8859-2",
    28595: "iso-8859-5",
    28597: "iso-8859-7",
    65001: "utf-8",
  };
  return named[codepage] ?? null;
}

function tryDecode(
  label: string,
  bytes: Uint8Array,
  fatal: boolean,
): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Decodes a text file. `declared` is the charset the file names for itself,
 * when it names one; a label the platform does not know is ignored.
 */
export function decodeText(
  bytes: Uint8Array,
  declared?: string | null,
): string {
  for (const [mark, label] of BOMS)
    if (mark.every((byte, i) => bytes[i] === byte))
      return tryDecode(label, bytes.subarray(mark.length), false) ?? "";
  if (declared) {
    const label = declared.trim().toLowerCase();
    if (/^utf-?8$/.test(label)) return tryDecode("utf-8", bytes, false) ?? "";
    // A page that declares Latin-1 but is really UTF-8 is common enough that
    // a clean strict UTF-8 decode outranks a declared legacy charset.
    const utf8 = tryDecode("utf-8", bytes, true);
    if (utf8 !== null) return utf8;
    const text = tryDecode(label, bytes, false);
    if (text !== null) return text;
  }
  return (
    tryDecode("utf-8", bytes, true) ??
    tryDecode("windows-1252", bytes, false) ??
    ""
  );
}

/** The charset an HTML file declares in its first kilobytes, or `null`. */
export function htmlCharset(bytes: Uint8Array): string | null {
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 4096));
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head) ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w:.-]+)/i.exec(head);
  return meta ? meta[1] : null;
}
