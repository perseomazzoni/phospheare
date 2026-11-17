// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserId = vi.fn<() => string | null>();
vi.mock("../auth/currentUser", () => ({
  getCurrentUserId: () => getCurrentUserId(),
  // The purge latch and the merge schedule, imported through the module
  // graph, subscribe here; a no-op mock keeps the subscriptions inert.
  onUserChange: () => () => {},
}));

import { refForLog } from "./logRef";
import { addToLibrary } from "../profile/profileSync";

function storageStub(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", storageStub());
  getCurrentUserId.mockReturnValue("u1");
});

afterEach(() => {
  vi.unstubAllGlobals();
  getCurrentUserId.mockReset();
});

// The profile keys rows by the project uuid, and drops any other id.
const BOOK_A = "0a1b2c3d-0000-4000-8000-00000000000a";

describe("refForLog", () => {
  it("names the provider and the book, never the folder or the title", () => {
    addToLibrary("u1", {
      id: BOOK_A,
      provider: "local",
      key: "My Secret Novel",
      name: "My Secret Novel",
    });
    const fields = refForLog({ providerId: "local", key: "My Secret Novel" });
    expect(fields).toEqual({ provider: "local", project: BOOK_A });
    expect(refForLog({ providerId: "drive", key: "unknown" })).toEqual({
      provider: "drive",
    });
  });
});
