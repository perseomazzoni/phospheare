// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Inflate } from "fflate";
import {
  MAX_INFLATED_BYTES,
  MAX_PART_BYTES,
  MAX_ZIP_ENTRIES,
} from "../domain/limits";
import type { ZipProbe } from "../ports";
import { ReadRefused } from "./failure";

// Opens a zip package safely. docx, odt and epub are zips, and a zip is the
// oldest trick for taking a tab down: a few kilobytes that declare, or really
// hold, gigabytes. The central directory is read here, field for field, and
// the guards are all decided from it before a byte is copied or inflated:
//
//   1. the entry count: a directory of a million names is refused at the
//      ten-thousandth, before the millionth header is read;
//   2. the layout: every entry's bytes lie inside the file, before the
//      central directory, and apart from every other entry's. Two names
//      pointing at the same bytes would each be copied in full while the
//      directory counted the bytes once;
//   3. each wanted part's declared size, against `MAX_PART_BYTES`;
//   4. the sum of every wanted part's declared size, against the total cap;
//   5. a stored part's two sizes agree, so the declared size bounds what a
//      stored copy yields.
//
// The declaration is the attacker's to write, so it bounds nothing by itself:
// a deflate stream holds whatever its author put in, whatever its header
// says. A deflated part is inflated in steps of a few kilobytes of input,
// and the bytes that come out are counted as they come; the first step past
// the declared size refuses the package. What has been inflated when a lie
// is caught is one step's worth over the declaration, never the stream's
// whole length. After unpacking, every part's length and CRC-32 are checked
// against the directory, so a truncated or altered part is refused rather
// than read in part. Only the parts a reader asks for are unpacked at all;
// pictures never are.
//
// The streaming `Inflate` and not `unzipSync`: the synchronous unzip sizes
// its output from the declaration and clips what overflows, so a stream of
// gigabytes declaring a kilobyte returns a kilobyte, after decoding the
// gigabytes. Nor the async forms: they spread the work over Web Workers,
// which this hexagon does not start (`boundaries.test.ts`).

/** One central directory entry, as far as unpacking needs it. */
interface Entry {
  name: string;
  /** 0 is stored and 8 deflated; any other method is refused as damaged. */
  method: number;
  compressed: number;
  original: number;
  crc: number;
  /** Where the entry's bytes begin, past its local header. */
  start: number;
}

/** Every entry's name, without inflating anything. */
export function zipNames(bytes: Uint8Array): string[] {
  return guarded(() => readDirectory(bytes)).map((entry) => entry.name);
}

/**
 * The wanted parts, inflated, keyed by name. A part `want` refuses is never
 * inflated; a wanted part over the caps refuses the whole package.
 */
export function unzipParts(
  bytes: Uint8Array,
  want: (name: string) => boolean,
): Record<string, Uint8Array> {
  let total = 0;
  const wanted: Entry[] = [];
  for (const entry of guarded(() => readDirectory(bytes))) {
    if (!want(entry.name)) continue;
    if (entry.original > MAX_PART_BYTES)
      throw new ReadRefused("bomb", `${entry.name} declares ${entry.original}`);
    total += entry.original;
    if (total > MAX_INFLATED_BYTES)
      throw new ReadRefused("bomb", `parts declare ${total}`);
    if (entry.method !== 0 && entry.method !== 8)
      throw new ReadRefused(
        "damaged",
        `${entry.name} uses method ${entry.method}`,
      );
    if (entry.method === 0 && entry.compressed !== entry.original)
      throw new ReadRefused(
        "damaged",
        `${entry.name} stores ${entry.compressed} and declares ${entry.original}`,
      );
    wanted.push(entry);
  }

  const parts: Record<string, Uint8Array> = {};
  for (const entry of wanted) {
    const data = bytes.subarray(entry.start, entry.start + entry.compressed);
    // A stored part is copied out of the file's buffer, so a part kept by a
    // reader does not keep the whole package alive with it.
    const part =
      entry.method === 0 ? data.slice() : inflateBounded(data, entry);
    if (part.length !== entry.original)
      throw new ReadRefused(
        "damaged",
        `${entry.name} yields ${part.length} of ${entry.original}`,
      );
    if (crc32(part) !== entry.crc)
      throw new ReadRefused("damaged", `${entry.name} fails its checksum`);
    parts[entry.name] = part;
  }
  return parts;
}

/** Runs a step of the reader; anything it throws but a refusal is damage. */
function guarded<T>(step: () => T): T {
  try {
    return step();
  } catch (err) {
    if (err instanceof ReadRefused) throw err;
    throw new ReadRefused("damaged", err instanceof Error ? err.message : "");
  }
}

// ── Bounded inflation ────────────────────────────────────────────────────────

/**
 * Compressed bytes handed to the inflater per step. Deflate expands by at
 * most 1032 to 1, so one step yields about four megabytes at the most before
 * the count is checked against the declaration.
 */
const INFLATE_STEP = 4096;

/**
 * Inflates a deflated part, refusing it at the first step whose output
 * passes the declared size.
 */
function inflateBounded(data: Uint8Array, entry: Entry): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const inflater = new Inflate((chunk) => {
    length += chunk.length;
    if (length > entry.original)
      throw new ReadRefused(
        "bomb",
        `${entry.name} yields more than the ${entry.original} it declares`,
      );
    chunks.push(chunk);
  });
  guarded(() => {
    let at = 0;
    do {
      const end = Math.min(at + INFLATE_STEP, data.length);
      inflater.push(data.subarray(at, end), end === data.length);
      at = end;
    } while (at < data.length);
  });
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

let crcTable: Uint32Array | null = null;

/** The CRC-32 a zip directory records for an entry's uncompressed bytes. */
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── The central directory ────────────────────────────────────────────────────

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END = 0x06064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const SATURATED_32 = 0xffffffff;
const SATURATED_16 = 0xffff;
/** The general-purpose flag that says an entry's name is UTF-8. */
const UTF8_NAME = 0x800;

/**
 * Reads the central directory, refusing the layouts the header lists.
 *
 * Zip64 sizes and offsets are read from their extra field, so a large
 * package written by a tool that always uses zip64 still opens. The entry
 * count is checked before the records are walked. An entry's bytes begin
 * where its own local header says, and run for the length the directory
 * says: a writer that streams an entry leaves the local header's sizes
 * blank and fills the directory's.
 */
function readDirectory(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfDirectory(view);
  // A package is one disk, so the two counts in the record are one number.
  let count = view.getUint16(end + 8, true);
  if (count !== view.getUint16(end + 10, true))
    throw new ReadRefused("damaged", "entry counts disagree");
  let directorySize = view.getUint32(end + 12, true);
  let directoryStart = view.getUint32(end + 16, true);

  // A zip64 record is followed whenever its locator is there, saturated
  // fields or not; a locator whose offset needs the high half is out of
  // reach of a buffer in memory.
  const locator = end - 20;
  let zip64 = false;
  if (locator >= 0 && view.getUint32(locator, true) === ZIP64_LOCATOR) {
    if (view.getUint32(locator + 12, true) !== 0)
      throw new ReadRefused("damaged", "zip64 directory end out of reach");
    const zip64End = view.getUint32(locator + 8, true);
    zip64 =
      zip64End + 56 <= view.byteLength &&
      view.getUint32(zip64End, true) === ZIP64_END;
    if (zip64) {
      count = safeNumber(view, zip64End + 32);
      if (count !== safeNumber(view, zip64End + 24))
        throw new ReadRefused("damaged", "entry counts disagree");
      directorySize = safeNumber(view, zip64End + 40);
      directoryStart = safeNumber(view, zip64End + 48);
    }
  }
  if (
    !zip64 &&
    (count === SATURATED_16 ||
      directorySize === SATURATED_32 ||
      directoryStart === SATURATED_32)
  )
    throw new ReadRefused("damaged", "zip64 directory end missing");

  if (count > MAX_ZIP_ENTRIES)
    throw new ReadRefused("bomb", `more than ${MAX_ZIP_ENTRIES} entries`);
  if (directoryStart + directorySize > view.byteLength)
    throw new ReadRefused("damaged", "directory past the end");

  const entries: Entry[] = [];
  const spans: [number, number][] = [];
  let at = directoryStart;
  for (let i = 0; i < count; i++) {
    if (
      at + 46 > view.byteLength ||
      view.getUint32(at, true) !== DIRECTORY_ENTRY
    )
      throw new ReadRefused("damaged", `directory entry ${i} missing`);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    let compressed = view.getUint32(at + 20, true);
    let original = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let offset = view.getUint32(at + 42, true);

    if (
      compressed === SATURATED_32 ||
      original === SATURATED_32 ||
      offset === SATURATED_32
    ) {
      // Without a zip64 record a saturated field is a size nothing here can
      // hold, not a value.
      if (!zip64)
        throw new ReadRefused("damaged", `entry ${i} needs a zip64 record`);
      const wide = zip64Extra(view, at + 46 + nameLength, extraLength);
      // The fields appear in this order, each only when its 32-bit slot is
      // saturated (`APPNOTE.TXT` 4.5.3).
      let field = 0;
      const next = () => {
        if (field + 8 > wide.length)
          throw new ReadRefused("damaged", "zip64 field missing");
        const value = safeNumber(wide.view, wide.start + field);
        field += 8;
        return value;
      };
      if (original === SATURATED_32) original = next();
      if (compressed === SATURATED_32) compressed = next();
      if (offset === SATURATED_32) offset = next();
    }

    if (
      offset + 30 > directoryStart ||
      view.getUint32(offset, true) !== LOCAL_HEADER
    )
      throw new ReadRefused("damaged", `entry ${i} has no local header`);
    const start =
      offset +
      30 +
      view.getUint16(offset + 26, true) +
      view.getUint16(offset + 28, true);
    const dataEnd = start + compressed;
    if (dataEnd > directoryStart)
      throw new ReadRefused("damaged", `entry ${i} runs past its bytes`);
    spans.push([offset, dataEnd]);
    entries.push({
      name: entryName(bytes, at + 46, nameLength, flags),
      method,
      compressed,
      original,
      crc,
      start,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }

  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++)
    if (spans[i][0] < spans[i - 1][1])
      throw new ReadRefused("bomb", "entries share their bytes");
  return entries;
}

/**
 * An entry's name: UTF-8 when its flag says so, otherwise one character per
 * byte, which is how every zip reader treats a name without the flag.
 */
function entryName(
  bytes: Uint8Array,
  at: number,
  length: number,
  flags: number,
): string {
  const raw = bytes.subarray(at, at + length);
  if (flags & UTF8_NAME) return new TextDecoder("utf-8").decode(raw);
  let name = "";
  for (const byte of raw) name += String.fromCharCode(byte);
  return name;
}

/** The end-of-directory record, searched back over the longest comment. */
function findEndOfDirectory(view: DataView): number {
  const last = view.byteLength - 22;
  const first = Math.max(0, last - SATURATED_16);
  for (let at = last; at >= first; at--)
    if (view.getUint32(at, true) === END_OF_DIRECTORY) return at;
  throw new ReadRefused("damaged", "no end of directory");
}

/** The zip64 extended-information field among an entry's extra fields. */
function zip64Extra(
  view: DataView,
  start: number,
  length: number,
): { view: DataView; start: number; length: number } {
  let at = start;
  while (at + 4 <= start + length) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === 0x0001) return { view, start: at + 4, length: size };
    at += 4 + size;
  }
  throw new ReadRefused("damaged", "zip64 field missing");
}

/** A little-endian 64-bit field, refused past what a number holds exactly. */
function safeNumber(view: DataView, at: number): number {
  if (at < 0 || at + 8 > view.byteLength)
    throw new ReadRefused("damaged", "field past the end");
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ReadRefused("damaged", "field too large");
  return Number(value);
}

// ── Reading the parts ────────────────────────────────────────────────────────

/** A part's text as UTF-8, which every XML part of the three packages is. */
export function partText(
  parts: Record<string, Uint8Array>,
  name: string,
): string | null {
  const part = parts[name];
  return part ? new TextDecoder("utf-8").decode(part) : null;
}

/**
 * Which package a zip of unknown name is, from its insides: a docx has
 * `word/document.xml`; odt and epub say so in a stored `mimetype`; a .pages
 * file keeps an `Index/` of its own. Anything else is not a manuscript.
 */
export const probeZip: ZipProbe = async (bytes) => {
  let names: string[];
  try {
    names = zipNames(bytes);
  } catch (err) {
    if (err instanceof ReadRefused)
      return { kind: "refused", reason: err.reason };
    return { kind: "refused", reason: "damaged" };
  }
  const has = (name: string) => names.includes(name);
  if (has("word/document.xml")) return { kind: "format", format: "docx" };
  if (has("mimetype")) {
    const mime = partText(
      unzipParts(bytes, (n) => n === "mimetype"),
      "mimetype",
    )?.trim();
    if (mime === "application/epub+zip")
      return { kind: "format", format: "epub" };
    if (mime === "application/vnd.oasis.opendocument.text")
      return { kind: "format", format: "odt" };
  }
  if (has("META-INF/container.xml")) return { kind: "format", format: "epub" };
  if (names.some((n) => n.startsWith("Index/") || n === "index.xml"))
    return { kind: "refused", reason: "pages" };
  return { kind: "refused", reason: "unknown" };
};
