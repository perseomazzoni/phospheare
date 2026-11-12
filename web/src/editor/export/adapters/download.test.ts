// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVOKE_AFTER_MS, downloadFile } from "./download";

// Pins the hand-off of the file to the browser. jsdom has no object URLs and
// does not navigate, so both ends are stubbed: the Blob carries the bytes and
// the type, the anchor carries the file name, the click happens once, and the
// URL is revoked well after the click. Revoked too soon, some browsers cancel
// the download while the toast says the file arrived.

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

let created: Blob[];
let revoked: string[];
let clicked: HTMLAnchorElement[];

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  revoked = [];
  clicked = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    return "blob:phospheare/1";
  });
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

/** A Blob's bytes, through `FileReader`, the one reader every jsdom has. */
function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe("downloadFile", () => {
  it("makes one object URL over the bytes, typed as the format", async () => {
    downloadFile(
      "once-dark.pdf",
      new Uint8Array([0x25, 0x00, 0xff]),
      "application/pdf",
    );
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("application/pdf");
    // jsdom's `FileReader` settles on a timer the fake clock would hold
    // forever. Leaving the fake clock discards the queued revoke unrun; the
    // last row watches it.
    vi.useRealTimers();
    expect(await bytesOf(created[0])).toEqual(
      new Uint8Array([0x25, 0x00, 0xff]),
    );
  });

  it("clicks one detached anchor that names the file", () => {
    downloadFile("Once Dark.epub", new Uint8Array([1]), "application/epub+zip");
    expect(clicked).toHaveLength(1);
    const [link] = clicked;
    expect(link.href).toBe("blob:phospheare/1");
    expect(link.download).toBe("Once Dark.epub");
    expect(link.rel).toBe("noopener");
    // Never in the document: the URL is a navigation the browser turns into
    // a save, not an element the page's policy has to allow.
    expect(link.isConnected).toBe(false);
  });

  it("revokes the URL well after the click, not before the file is read", () => {
    downloadFile("a.txt", new Uint8Array([0x61]), "text/plain");
    expect(clicked).toHaveLength(1);
    expect(revoked).toEqual([]);
    // The next turn is too soon for a large file in Firefox and Safari.
    vi.advanceTimersByTime(1_000);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(REVOKE_AFTER_MS);
    expect(revoked).toEqual(["blob:phospheare/1"]);
  });
});
