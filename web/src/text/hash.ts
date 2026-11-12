// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Content hashing, shared by the project layer and the AI core so that a
// snapshot's `contentHash` and a summary's body hash are one function.
//
// The hash is over the string the app reads and writes, not over provider
// bytes. Canonicalization makes `\r\n` (Windows, Git) and `\n` the same edit
// and a leading BOM invisible, or the same prose written by two tools would
// always look changed.

/** SHA-256 hex of the exact UTF-8 bytes of `content`, with no folding. */
export async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonical form of a markdown file for hashing: `\r\n` and `\r` become
 * `\n`, and a leading UTF-8 BOM is stripped. A trailing newline still counts
 * (`"hello\n"` differs from `"hello"`), and no markdown is stripped: the hash
 * is of the source, not the counted view.
 */
export function canonicalize(content: string): string {
  let out = content;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  if (out.includes("\r")) out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return out;
}

/** A text's content hash: canonicalized, then SHA-256 hex. */
export async function hashOf(content: string): Promise<string> {
  return sha256Hex(canonicalize(content));
}
