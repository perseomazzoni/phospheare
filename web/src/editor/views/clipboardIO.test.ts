// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboard, readClipboard } from "./clipboardIO";

// Pins the platform I/O seam: which `navigator.clipboard` call each path
// makes, and that every degradation falls back to plain text, or nothing,
// rather than throwing. The codec's contract suite pins rich-HTML
// correctness; this pins the wiring.

function installClipboard(over: Record<string, unknown>) {
  const clipboard = {
    write: undefined,
    writeText: undefined,
    read: undefined,
    readText: undefined,
    ...over,
  };
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
  return clipboard;
}

function installClipboardItem() {
  class FakeClipboardItem {
    types: string[];
    constructor(private data: Record<string, Blob>) {
      this.types = Object.keys(data);
    }
    getType(type: string) {
      return Promise.resolve(this.data[type]);
    }
  }
  Object.defineProperty(globalThis, "ClipboardItem", {
    value: FakeClipboardItem,
    configurable: true,
  });
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).ClipboardItem;
  delete (navigator as { clipboard?: unknown }).clipboard;
});

describe("writeClipboard", () => {
  it("writes both flavors when ClipboardItem is available", async () => {
    installClipboardItem();
    const write = vi.fn().mockResolvedValue(undefined);
    installClipboard({ write });

    await writeClipboard({ plain: "p", html: "<p>h</p>" });
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as { types: string[] };
    expect(item.types).toContain("text/plain");
    expect(item.types).toContain("text/html");
  });

  it("falls back to writeText when rich is unsupported", async () => {
    installClipboard({
      write: undefined,
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    const clipboard = navigator.clipboard as unknown as {
      writeText: ReturnType<typeof vi.fn>;
    };

    await writeClipboard({ plain: "p", html: "<p>h</p>" });
    expect(clipboard.writeText).toHaveBeenCalledWith("p");
  });

  it("swallows a rejected write", async () => {
    installClipboardItem();
    installClipboard({
      write: vi.fn().mockRejectedValue(new Error("denied")),
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    await expect(
      writeClipboard({ plain: "p", html: "<p>h</p>" }),
    ).resolves.toBeUndefined();
  });
});

describe("readClipboard", () => {
  it("reads both flavors", async () => {
    const getType = vi.fn((t: string) =>
      Promise.resolve(
        new Blob([t === "text/html" ? "<p>h</p>" : "p"], {
          type: "text/plain",
        }),
      ),
    );
    const read = vi
      .fn()
      .mockResolvedValue([{ types: ["text/html", "text/plain"], getType }]);
    installClipboard({ read });

    await expect(readClipboard()).resolves.toEqual({
      plain: "p",
      html: "<p>h</p>",
    });
  });

  it("falls back to readText when read is unavailable", async () => {
    const readText = vi.fn().mockResolvedValue("plain");
    installClipboard({ read: undefined, readText });

    await expect(readClipboard()).resolves.toEqual({
      plain: "plain",
      html: "",
    });
  });

  it("returns an empty payload when reading is denied", async () => {
    installClipboard({
      read: vi.fn().mockRejectedValue(new Error("denied")),
      readText: vi.fn().mockRejectedValue(new Error("denied")),
    });

    await expect(readClipboard()).resolves.toEqual({ plain: "", html: "" });
  });
});
