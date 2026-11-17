// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredLine } from "./application/logger";
import { localLineStash } from "./localStash";

const line = (message: string): StoredLine => ({
  entry: {
    at: 1,
    level: "info",
    area: "app",
    message,
    account: null,
    fields: {},
  },
  size: message.length,
});

beforeEach(() => localStorage.clear());

describe("the log's stash in localStorage", () => {
  it("gives back what was saved once, oldest first", () => {
    const stash = localLineStash();
    stash.save([line("one")]);
    stash.save([line("two")]);
    expect(stash.take().map((l) => l.entry.message)).toEqual(["one", "two"]);
    expect(stash.take()).toEqual([]);
  });

  it("gives back nothing for a damaged or foreign value", () => {
    const stash = localLineStash();
    localStorage.setItem("writer-log:unwritten", "{ not json");
    expect(stash.take()).toEqual([]);
    localStorage.setItem(
      "writer-log:unwritten",
      JSON.stringify([{ size: 1 }, line("kept"), "text"]),
    );
    expect(stash.take().map((l) => l.entry.message)).toEqual(["kept"]);
  });

  it("keeps the earlier lines when a save does not fit", () => {
    const stash = localLineStash();
    stash.save([line("earlier")]);
    const full = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    expect(() => stash.save([line("later")])).toThrow();
    full.mockRestore();
    expect(stash.take().map((l) => l.entry.message)).toEqual(["earlier"]);
  });
});
