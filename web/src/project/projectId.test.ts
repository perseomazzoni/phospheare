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

import { projectIdFor } from "./projectId";
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
const BOOK_B = "0a1b2c3d-0000-4000-8000-00000000000b";

const shelve = (id: string, provider: string, key: string) =>
  addToLibrary("u1", { id, provider, key, name: key });

// The one seam between an address and the book at it. Its contract is
// its two answers: a book, or nothing.
describe("projectIdFor", () => {
  it("names the book on the shelf at this address", () => {
    shelve(BOOK_A, "local", "a");
    shelve(BOOK_B, "drive", "b");

    expect(projectIdFor({ providerId: "drive", key: "b" })).toBe(BOOK_B);
  });

  it("answers nothing for an address the shelf does not hold", () => {
    shelve(BOOK_A, "local", "a");

    // The same key on another backend is another place: the caller must not
    // inherit the first book's pairing for the second one's folder.
    expect(projectIdFor({ providerId: "drive", key: "a" })).toBeNull();
    expect(projectIdFor({ providerId: "local", key: "z" })).toBeNull();
  });

  it("answers nothing when nobody is signed in", () => {
    // `getCurrentUserId` returns null both for nobody and for a session not
    // adopted yet (`auth/currentUser.ts`), and a reader below the
    // account boundary cannot tell them apart. Fail closed: an unnameable
    // project is unpaired and uncached, never another account's book.
    getCurrentUserId.mockReturnValue(null);
    expect(projectIdFor({ providerId: "local", key: "a" })).toBeNull();
  });
});
