// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The one place that touches `navigator.clipboard`: the programmatic path the
// context menu needs, where there is no ClipboardEvent. Both directions
// degrade to plain text, and a denied read returns an empty payload rather
// than throwing.

export interface ClipboardPayload {
  plain: string;
  html: string;
}

/** Write both flavors; degrade to plain text when rich is unsupported. */
export async function writeClipboard(payload: ClipboardPayload): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([payload.plain], { type: "text/plain" }),
          "text/html": new Blob([payload.html], { type: "text/html" }),
        }),
      ]);
      return;
    }
  } catch {
    // A `text/html` write is not universal; fall through to plain.
  }
  try {
    await navigator.clipboard?.writeText(payload.plain);
  } catch {
    // No permission to write.
  }
}

/** Read both flavors; degrade to plain text, then to an empty payload. */
export async function readClipboard(): Promise<ClipboardPayload> {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      let html = "";
      let plain = "";
      for (const item of items) {
        if (html === "" && item.types.includes("text/html")) {
          html = await (await item.getType("text/html")).text();
        }
        if (plain === "" && item.types.includes("text/plain")) {
          plain = await (await item.getType("text/plain")).text();
        }
      }
      return { plain, html };
    }
  } catch {
    // `read()` can be denied where `readText()` is allowed.
  }
  try {
    const plain = (await navigator.clipboard?.readText()) ?? "";
    return { plain, html: "" };
  } catch {
    return { plain: "", html: "" };
  }
}
