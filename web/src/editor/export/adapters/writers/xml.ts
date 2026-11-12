// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The text hygiene of all eight writers. Every XML-based format (EPUB, DOCX,
// ODT and the HTML file) puts the writer's words through `escapeXml`, and only
// through it. RTF and the PDF use `stripInvalidXml` alone, because their
// escaping is their own (`rtfText`) or there is none to do. TXT and Markdown
// use `stripInvalidText`. Two jobs:
//
// - Escape the five characters that would otherwise become markup: a
//   reference that contains `<script>` is text about a script, never a script.
// - Drop the characters XML 1.0 forbids (most `C0` controls, lone
//   surrogates, `U+FFFE`, `U+FFFF`). One stray control character pasted into
//   a chapter makes a whole EPUB fail validation ("PCDATA invalid char") and
//   a whole DOCX refuse to open, and it carries no meaning a reader could see.

const INVALID_XML =
  // eslint-disable-next-line no-control-regex
  /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export function stripInvalidXml(text: string): string {
  return text.replace(INVALID_XML, "");
}

/**
 * The same characters for the plain formats (TXT, Markdown), less one: a form
 * feed is plain text's page break (`txt.ts`), so it stays. A stray control
 * character in a submission form's text box is as meaningless as in an EPUB,
 * and some portals refuse the paste.
 */
const INVALID_TEXT =
  // eslint-disable-next-line no-control-regex
  /[^\u0009\u000A\u000C\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export function stripInvalidText(text: string): string {
  return text.replace(INVALID_TEXT, "");
}

export function escapeXml(text: string): string {
  return stripInvalidXml(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export const XML_DECLARATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;

/**
 * An ISO 8601 instant to the second, in UTC: `2026-10-01T14:32:05Z`. It is the
 * form an EPUB's `dcterms:modified` requires and a DOCX's `dcterms:created`
 * reads, so both write it through one function.
 */
export function isoSeconds(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}
