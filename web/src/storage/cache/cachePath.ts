// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { sha256Hex } from "../../text/hash";
import { StorageError } from "../types";

// Naming inside the working copy: what one project's directory is called, and
// how a project-relative path is walked into it.
//
// The project segment is the full SHA-256 hex of the project's own id,
// and inside it each remote the book is bound to has its own
// directory. A book keeps its copy for as long as it keeps its remote, and a
// book bound to a different remote starts an empty copy instead of reading
// the last one's.
//
// The id is digested although a uuid needs no sanitizing. It is read from
// `document-properties.json`, which the writer can hand-edit, so it is not
// guaranteed to be a uuid here. A digest lands inside the fail-closed
// `SAFE_ID` alphabet of `cacheRoot.ts` for any input, so there is no second,
// laxer sanitizer to drift from the first. `crypto.subtle` is available
// wherever OPFS is; both are secure-context APIs.
//
// The digest is neither truncated nor salted. No attacker chooses these ids,
// so preimage resistance is irrelevant, but collision resistance is not: a
// collision serves one book's bytes for another book's path, which corrupts a
// manuscript. A salt adds nothing, since the user id is already a level
// above, and would make a lost segment unreproducible.

/** The alphabet a segment uses: 64 lowercase hex characters, nothing else. */
export const SEGMENT_ALPHABET = /^[0-9a-f]{64}$/;

export async function segmentFor(projectId: string): Promise<string> {
  return sha256Hex(projectId);
}

/**
 * The directory inside a project's segment that holds its copy of one
 * remote, in the same alphabet as `segmentFor`.
 *
 * A book keeps its id when it moves, so a book moved off a remote and later
 * onto another one finds its segment again. The copy it left there describes
 * the old remote, and serving it would shadow the new one. Keying the copy by
 * the remote as well gives every destination its own copy, while the segment
 * stays the book's, which is what the budget evicts and the queue protects.
 */
export async function remoteSegmentFor(remote: {
  providerId: string;
  key: string;
}): Promise<string> {
  // A JSON pair, so no separator can make two different remotes spell the
  // same string.
  return sha256Hex(JSON.stringify([remote.providerId, remote.key]));
}

/**
 * Splits a project-relative path into the segments a handle walk consumes.
 *
 * Refuses and never normalizes: no `..` collapsing, no trimming, no percent
 * decoding. These paths come from `document-structure.yaml`, which a writer
 * can hand-edit, and a normalizer turns a refused path into an accepted one.
 *
 * Do not hand a slash-bearing string to `getFileHandle` or
 * `getDirectoryHandle`: a name that looks like a path fails and
 * opens traversal. Splitting first is what makes the refusal possible.
 *
 * A refusal throws a `StorageError` with `unusable-path` and the offending
 * segment.
 */
// The refusal has its own code on the source axis, so the drain stops on the
// first attempt instead of retrying a path that can never be spelled against
// a remote that is not the problem. It is the only source failure
// that stops at once, because every other one is about a moment and this one
// is about a name.
//
// It carries a `key` and the offending segment because the writer can act on
// it: the path is in `document-structure.yaml`, which they can hand-edit and
// which nothing else validates.
export function pathSegments(path: string): string[] {
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.length === 0) {
    throw new StorageError(
      `cachePath: refusing an empty path ("${path}")`,
      "unusable-path",
      "storage.unusablePath",
      { name: path },
    );
  }
  for (const part of parts) {
    if (
      part === "." ||
      part === ".." ||
      part.includes("\\") ||
      part.includes("\0")
    ) {
      throw new StorageError(
        `cachePath: refusing the path segment "${part}"`,
        "unusable-path",
        "storage.unusablePath",
        { name: part },
      );
    }
  }
  return parts;
}
