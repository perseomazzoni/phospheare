// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Hands the file to the browser as an object URL on a detached
// `<a download>`, clicked once and revoked later. The URL never reaches the
// document tree, an `img` or a frame; it is a navigation the browser turns
// into a save, so `img-src` and `frame-src` in `security/csp.ts` need no
// widening.

export function downloadFile(
  fileName: string,
  bytes: Uint8Array,
  mime: string,
): void {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.click();
  // Revoking synchronously cancels the download in some browsers, and so does
  // revoking on the next turn for a large file in Firefox and Safari, which
  // read the blob after the click returns; a novel's PDF is megabytes. The
  // URL holds only this file's bytes, so keeping it 40 s costs nothing.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export const REVOKE_AFTER_MS = 40_000;
